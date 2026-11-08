"""Collect official-source evidence for every company in the sector rotation universe.

For each symbol this records the company's official website and its latest investor
presentation (the company's own PPT filed on the exchange), extracts readable text from
both, and writes evidence/<SYMBOL>.json. The company's Screener page is used only to
discover those two links; none of its descriptions are kept as evidence.

Resumable: symbols that already have an evidence file are skipped.
Usage: python -I harness/sector-audit/fetch.py [--limit N] [--only SYM,SYM]
"""
import gzip
import html
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
EVIDENCE = os.path.join(ROOT, "evidence")
PDF_DIR = os.path.join(tempfile.gettempdir(), "sector-audit-pdfs")  # untrusted downloads, kept out of the repo
os.makedirs(EVIDENCE, exist_ok=True)
os.makedirs(PDF_DIR, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
CTX = ssl.create_default_context()
SKIP_HOSTS = ("screener.in", "bseindia.com", "nseindia.com", "google.", "twitter.", "x.com", "facebook.", "linkedin.",
              "youtube.", "youtu.be", "instagram.", "icra.in", "crisil.com", "careratings.com", "indiaratings", "brickworkratings",
              "acuite.in", "infomerics", "razorpay", "apple.com", "play.google")
SCREENER_LOCK = threading.Lock()  # Screener lookups run one at a time with a gap, so the site is never hammered
SCREENER_GAP = 4.0
_last_screener = [0.0]
NOISE = re.compile(r"safe harbo|forward[- ]looking|disclaimer|cookie|all rights reserved|privacy policy", re.I)


def get(url, timeout=15, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        data = r.read(15_000_000)
        if r.headers.get("Content-Encoding", "").lower() == "gzip" or data[:2] == bytes([0x1F, 0x8B]):
            data = gzip.decompress(data)
        return r.geturl(), (data if binary else data.decode(r.headers.get_content_charset() or "utf-8", "replace"))


def visible_text(page):
    page = re.sub(r"(?is)<(script|style|noscript|svg|head)[^>]*>.*?</\1>", " ", page)
    page = re.sub(r"(?s)<!--.*?-->", " ", page)
    page = re.sub(r"(?i)<(br|/p|/div|/li|/h\d|/tr|/section)[^>]*>", "\n", page)
    text = html.unescape(re.sub(r"<[^>]+>", " ", page))
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.split("\n")]
    out, seen = [], set()
    for l in lines:
        if len(l) < 3 or l.lower() in seen or NOISE.search(l):
            continue
        seen.add(l.lower())
        out.append(l)
    return "\n".join(out)


def meta(page):
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    desc = re.search(r'(?is)<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', page) or \
        re.search(r'(?is)<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description', page)
    return (html.unescape(re.sub(r"\s+", " ", title.group(1))).strip() if title else "",
            html.unescape(desc.group(1)).strip() if desc else "")


def discover(sym):
    """Official website and latest investor presentation, read off the company's Screener page."""
    for attempt in range(6):
        try:
            with SCREENER_LOCK:
                wait = SCREENER_GAP - (time.time() - _last_screener[0])
                if wait > 0:
                    time.sleep(wait)
                try:
                    _, page = get(f"https://www.screener.in/company/{urllib.parse.quote(sym)}/")
                finally:
                    _last_screener[0] = time.time()
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 5:
                raise
            time.sleep(60 * (attempt + 1))
    site = None
    block = re.search(r'(?s)company-links.*?</div>', page)
    for href in re.findall(r'href="(https?://[^"]+)"', block.group(0) if block else page[:200000]):
        if not any(h in href.lower() for h in SKIP_HOSTS):
            site = href
            break
    ppt, ppt_label = None, None
    for m in re.finditer(r'(?s)<li class="flex flex-gap-8 flex-wrap[^"]*">(.*?)</li>', page):
        item = m.group(1)
        a = re.search(r'href="([^"]+)"[^>]*>\s*PPT\s*</a>', item)
        if a:
            label = re.search(r'<div class="ink-600[^"]*"[^>]*>\s*([^<]+?)\s*</div>', item)
            ppt, ppt_label = html.unescape(a.group(1)), (label.group(1) if label else None)
            break  # newest first
    return site, ppt, ppt_label


def pdf_text(url, sym):
    _, data = get(url, timeout=60, binary=True)
    if not data.startswith(b"%PDF"):
        raise RuntimeError("not a pdf")
    path = os.path.join(PDF_DIR, f"{sym}.pdf")
    with open(path, "wb") as f:
        f.write(data)
    out = subprocess.run(["pdftotext", "-l", "16", "-layout", path, "-"], capture_output=True, timeout=120)
    text = out.stdout.decode("utf-8", "replace")
    lines = [re.sub(r"\s{2,}", "  ", l).strip() for l in text.splitlines()]
    return "\n".join(l for l in lines if len(l) > 2 and not NOISE.search(l))


def site_pages(url):
    final, page = get(url)
    title, desc = meta(page)
    pages = [{"url": final, "title": title, "description": desc, "text": visible_text(page)[:6000]}]
    base = urllib.parse.urlparse(final)
    picks = []
    for href, label in re.findall(r'(?is)<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', page):
        lab = re.sub(r"<[^>]+>|\s+", " ", label).strip().lower()
        if re.search(r"about|business|product|what we do|services|solutions|overview|profile|segments|portfolio", lab + " " + href.lower()):
            full = urllib.parse.urljoin(final, href)
            p = urllib.parse.urlparse(full)
            if p.netloc.split(":")[0].removeprefix("www.") == base.netloc.split(":")[0].removeprefix("www.") and full not in picks and not full.lower().endswith((".pdf", ".jpg", ".png")):
                picks.append(full)
    for sub in picks[:2]:
        try:
            f2, p2 = get(sub)
            t2, d2 = meta(p2)
            pages.append({"url": f2, "title": t2, "description": d2, "text": visible_text(p2)[:6000]})
        except Exception as e:  # noqa: BLE001 - one bad subpage must not lose the rest
            pages.append({"url": sub, "error": str(e)[:200]})
    return pages


def collect(row):
    sym = row["sym"]
    path = os.path.join(EVIDENCE, f"{re.sub(r'[^A-Za-z0-9_-]', '_', sym)}.json")
    if os.path.exists(path):
        return sym, "cached"
    ev = {"sym": sym, "name": row["nm"], "current_baskets": row["baskets"].split("|"),
          "fetched_at": time.strftime("%Y-%m-%d"), "website": None, "ppt": None, "errors": []}
    try:
        site, ppt, label = discover(sym)
    except Exception as e:  # noqa: BLE001
        ev["errors"].append(f"discover: {e}"[:200])
        site, ppt, label = None, None, None
    ev["website_url"], ev["ppt_url"], ev["ppt_period"] = site, ppt, label
    if ppt:
        try:
            ev["ppt"] = pdf_text(ppt, sym)[:12000]
        except Exception as e:  # noqa: BLE001
            ev["errors"].append(f"ppt: {e}"[:200])
    if site:
        try:
            ev["website"] = site_pages(site)
        except Exception as e:  # noqa: BLE001
            ev["errors"].append(f"website: {e}"[:200])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ev, f, ensure_ascii=False, indent=1)
    return sym, ("ok" if ev["ppt"] or ev["website"] else "no-source")


def main():
    rows = json.load(open(os.path.join(ROOT, "universe.json"), encoding="utf-8"))
    args = sys.argv[1:]
    if "--only" in args:
        want = set(args[args.index("--only") + 1].split(","))
        rows = [r for r in rows if r["sym"] in want]
    if "--limit" in args:
        rows = rows[: int(args[args.index("--limit") + 1])]
    done = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        for sym, status in pool.map(collect, rows):
            done += 1
            print(f"{done}/{len(rows)} {sym} {status}", flush=True)


if __name__ == "__main__":
    main()
