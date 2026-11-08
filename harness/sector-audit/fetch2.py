"""Concurrent, Screener-free evidence collector for the sector audit.

Takes each company's official website from sites.json (found by find_sites.py or by WebSearch, each with
the reason it was accepted), crawls the site's own investor pages for the latest investor presentation, then
downloads and extracts the text and writes
evidence/<SYM>.json in the same schema as fetch.py, plus a "discovery" block recording how each link was found
and why it was accepted.

Pipeline properties:
- bounded concurrency (worker pool) with a per-host semaphore and minimum gap per host
- retries with backoff on timeouts and 5xx; 403/429 or bot-challenge pages mark a host as blocked, so it is not retried
- an on-disk HTTP cache (temp dir) so reruns never refetch
- a checkpoint log (fetch2.log.jsonl) with one line per company, including the real failure reason

Resumable: companies that already have an evidence file are skipped unless named in --refresh.
Usage: python -I fetch2.py [--only SYM,SYM] [--refresh SYM,SYM] [--limit N] [--workers N]
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402  (reuses get, visible_text, meta, pdf_text, site_pages)

ROOT = fetch.ROOT
EVIDENCE = fetch.EVIDENCE
LOG = os.path.join(ROOT, "fetch2.log.jsonl")
CACHE = os.path.join(tempfile.gettempdir(), "sector-audit-cache")
os.makedirs(CACHE, exist_ok=True)

AGGREGATORS = re.compile(
    r"screener\.in|moneycontrol|economictimes|indiatimes|wikipedia|wikidata|linkedin|facebook|twitter|x\.com|instagram|"
    r"youtube|tickertape|trendlyne|zaubacorp|tofler|indiamart|justdial|marketscreener|reuters|bloomberg|livemint|"
    r"business-standard|financialexpress|thehindu|ndtv|investing\.com|tradingview|groww|zerodha|angelone|5paisa|upstox|"
    r"dhan\.co|icicidirect|kotaksecurities|hdfcsec|motilal|sharekhan|paytmmoney|smallcase|stockedge|marketsmojo|"
    r"equitymaster|valueresearch|morningstar|yahoo|google\.|bing\.|duckduckgo|glassdoor|ambitionbox|naukri|crunchbase|"
    r"zoominfo|dnb\.com|bizbaya|falconebiz|thecompanycheck|instafinancials|cleartax|indiainfoline|iifl|chittorgarh|"
    r"ipoplatform|ipocentral|investorgain|simplywall|stockanalysis|companiesmarketcap|macrotrends|finology|"
    r"capitalmarket|businesstoday|outlookbusiness|forbes|scribd|slideshare|pdfcoffee|dokumen|yumpu|issuu|"
    r"nseindia\.com|bseindia\.com|sebi\.gov|mca\.gov|amazon\.|flipkart|wsj\.com|cnbc|stockscans|financiallyfree|"
    r"icra\.in|crisil|careratings|indiaratings|brickwork|acuite|infomerics|kfintech|linkintime|bigshare|"
    r"researchgate|medium\.com|quora|reddit|pinterest|apple\.com|play\.google",
    re.I)
GENERIC = {"ltd", "limited", "india", "indian", "industries", "industry", "the", "and", "company", "corporation", "corp",
           "co", "pvt", "private", "of", "enterprises", "enterprise", "international", "group", "holdings", "global",
           "services", "solutions", "systems", "products", "technologies", "technology", "tech", "infra", "projects"}


# ---------------------------------------------------------------- HTTP layer
class Hosts:
    """Per-host concurrency cap, minimum gap between requests, and a blocked list."""

    def __init__(self):
        self.lock = threading.Lock()
        self.sems, self.last, self.blocked, self.strikes = {}, {}, {}, {}

    @staticmethod
    def gap(host):
        if "duckduckgo" in host or "bing.com" in host:
            return 2.0
        if "nseindia" in host or "bseindia" in host:
            return 0.5
        return 0.3

    def sem(self, host):
        with self.lock:
            return self.sems.setdefault(host, threading.Semaphore(1 if ("duckduckgo" in host or "bing" in host) else 2))

    def wait_turn(self, host):
        while True:
            with self.lock:
                now = time.time()
                due = self.last.get(host, 0) + self.gap(host)
                if now >= due:
                    self.last[host] = now
                    return
            time.sleep(due - now)

    def block(self, host, reason):
        with self.lock:
            self.blocked[host] = reason


HOSTS = Hosts()


class Blocked(Exception):
    pass


def http(url, binary=False, timeout=20, tries=3):
    key = hashlib.sha1(url.encode()).hexdigest()
    cpath = os.path.join(CACHE, key + (".bin" if binary else ".txt"))
    if os.path.exists(cpath):
        with open(cpath, "rb") as f:
            data = f.read()
        return url, (data if binary else data.decode("utf-8", "replace"))
    host = urllib.parse.urlparse(url).netloc.lower()
    if host in HOSTS.blocked:
        raise Blocked(f"{host} blocked earlier: {HOSTS.blocked[host]}")
    last = None
    for attempt in range(tries):
        with HOSTS.sem(host):
            HOSTS.wait_turn(host)
            try:
                final, data = fetch.get(url, timeout=timeout, binary=binary)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403, 451):
                    if any(h in host for h in ("duckduckgo", "bing", "nseindia", "bseindia")):
                        HOSTS.block(host, f"HTTP {e.code}")
                    raise Blocked(f"HTTP {e.code}")
                if e.code == 429:
                    HOSTS.block(host, "HTTP 429")
                    raise Blocked("HTTP 429")
                if e.code == 404:
                    raise
                last = e
            except Exception as e:  # noqa: BLE001 - timeouts, resets, TLS errors
                last = e
            else:
                text = data if binary else data
                if not binary and re.search(r"Checking your browser|cf-challenge|captcha|Access Denied</title>", text[:5000], re.I):
                    raise Blocked("bot challenge page")
                with open(cpath, "wb") as f:
                    f.write(data if binary else data.encode("utf-8"))
                return final, data
        time.sleep(2 * (attempt + 1))
    raise last


# ---------------------------------------------------------------- identity checks
def core_tokens(name):
    n = re.sub(r"\(.*?\)", " ", name.lower()).replace("&", " and ")
    toks = [t for t in re.findall(r"[a-z0-9]+", n) if t not in GENERIC and len(t) > 1]
    return toks or re.findall(r"[a-z0-9]+", n)[:1]


def name_match(name, text, domain=""):
    """Share of the company's distinctive name tokens found in the page text or domain."""
    toks = core_tokens(name)
    t = text.lower()
    d = domain.lower().replace("-", "")
    hits = [tok for tok in toks if re.search(r"\b" + re.escape(tok) + r"\b", t) or tok in d]
    joined = "".join(toks)
    if len(joined) >= 4 and (joined in d or joined in t.replace(" ", "")):
        return 1.0, toks
    return (len(hits) / len(toks) if toks else 0.0), toks


def host_of(u):
    return urllib.parse.urlparse(u).netloc.lower().split(":")[0].removeprefix("www.")


# ---------------------------------------------------------------- dates on documents
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def doc_date(url, label=""):
    """(sortable yyyymm, human string) from an exchange filename or a URL/label, else (0, None)."""
    m = re.search(r"/corporate/[A-Z0-9&_-]+?_(\d{2})(\d{2})(\d{4})\d{6}_", url)
    if m:
        d, mo, y = m.groups()
        return int(y) * 100 + int(mo), f"{y}-{mo}-{d}"
    s = (url + " " + label).lower()
    m = re.search(r"q([1-4])[\s_-]*fy[\s_-]*'?(20)?(\d{2})", s)
    if m:
        q, fy = int(m.group(1)), 2000 + int(m.group(3))
        # results month for each Indian fiscal quarter: Q1 Aug, Q2 Nov (prior calendar year), Q3 Feb, Q4 May
        y, mo = {1: (fy - 1, 8), 2: (fy - 1, 11), 3: (fy, 2), 4: (fy, 5)}[q]
        return y * 100 + mo, f"Q{q} FY{fy % 100}"
    m = re.search(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*(20\d{2})", s)
    if m:
        return int(m.group(2)) * 100 + MONTHS[m.group(1)], f"{m.group(1).title()} {m.group(2)}"
    m = re.search(r"fy[\s_-]*(20)?(\d{2})\b", s)
    if m:
        return (2000 + int(m.group(2))) * 100 + 4, f"FY{m.group(2)}"
    m = re.findall(r"(20[12]\d)", s)
    if m:
        return int(max(m)) * 100, max(m)
    return 0, None


def text_date(text):
    """Latest quarter/period stated on the first pages of a deck."""
    head = text[:4000]
    best = (0, None)
    for m in re.finditer(r"\b(Q[1-4]|H[12]|9M)\s*[-' ]?\s*FY\s*'?(20)?(\d{2})\b", head, re.I):
        fy = 2000 + int(m.group(3))
        p = m.group(1).upper()
        score = fy * 100 + {"Q1": 7, "H1": 10, "Q2": 10, "Q3": 13, "9M": 13, "Q4": 16, "H2": 16}[p]
        if score > best[0]:
            best = (score, f"{p} FY{fy % 100}")
    for m in re.finditer(r"\b(January|February|March|April|May|June|July|August|September|October|November|December)[ ,]+(\d{1,2}[ ,]+)?(20\d{2})\b", head):
        score = int(m.group(3)) * 100 + MONTHS[m.group(1)[:3].lower()]
        if score > best[0] - 3 and best[1] is None:
            best = (score, f"{m.group(1)} {m.group(3)}")
    return best[1]


# ---------------------------------------------------------------- discovery (company site and IR pages only)
SITES = os.path.join(ROOT, "sites.json")
LINK = re.compile(r'(?is)<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>')


def same_org(u, base):
    h = host_of(u)
    root = ".".join(base.split(".")[-3:]) if base.endswith((".co.in", ".com.au")) else ".".join(base.split(".")[-2:])
    return h == base or h.endswith("." + root) or h == root


def links(page, final):
    for href, label in LINK.findall(page):
        yield urllib.parse.urljoin(final, fetch.html.unescape(href.strip())), re.sub(r"<[^>]+>|\s+", " ", label).strip()


def ir_pdf_links(site, log):
    """Investor-presentation PDFs reachable within two hops of the homepage on the company's own domain."""
    out, seen = [], set()
    try:
        final, page = http(site)
    except Exception as e:  # noqa: BLE001
        log.append(f"IR crawl: homepage {type(e).__name__} {str(e)[:80]}")
        return out
    base = host_of(final)
    frontier = []
    for full, lab in links(page, final):
        key = (lab + " " + full).lower()
        if full.lower().split("?")[0].endswith(".pdf"):
            if re.search(r"present|ppt|investor[ _-]?deck", key):
                out.append((full, lab))
        elif re.search(r"investor|presentation|financial|shareholder|results|analyst", key) and same_org(full, base) and full not in frontier:
            frontier.append(full)
    hop2 = []
    for ir in frontier[:6]:
        if ir in seen:
            continue
        seen.add(ir)
        try:
            f2, p2 = http(ir)
        except Exception:  # noqa: BLE001
            continue
        for full, lab in links(p2, f2):
            key = (lab + " " + full).lower()
            if ".pdf" in full.lower() or "/attach" in full.lower() or "download" in full.lower():
                if re.search(r"present|ppt|investor[ _-]?deck", key):
                    out.append((full, lab))
            elif re.search(r"presentation|analyst|investor[ _-]?(meet|deck|update)|earnings", key) and same_org(full, base):
                hop2.append(full)
    for ir in hop2[:4]:
        if ir in seen:
            continue
        seen.add(ir)
        try:
            f3, p3 = http(ir)
        except Exception:  # noqa: BLE001
            continue
        for full, lab in links(p3, f3):
            key = (lab + " " + full).lower()
            if (".pdf" in full.lower() or "download" in full.lower()) and re.search(r"present|ppt|investor|q[1-4]|fy\s?\d", key):
                out.append((full, lab))
    log.append(f"IR crawl: {len(seen)} investor pages, {len(out)} presentation links")
    return out


def find_ppt(sym, name, site, log):
    cands = [(u, l, "company IR page") for u, l in ir_pdf_links(site, log)] if site else []
    seen, uniq = set(), []
    for c in cands:
        if c[0] not in seen:
            seen.add(c[0])
            uniq.append(c)
    uniq.sort(key=lambda c: doc_date(c[0], c[1])[0], reverse=True)
    log.append(f"ppt candidates {len(uniq)}: {[(c[1][:40], doc_date(c[0], c[1])[1]) for c in uniq[:5]]}")
    for url, label, how in uniq[:4]:
        try:
            text = pdf_text(url, sym)
        except Exception as e:  # noqa: BLE001
            log.append(f"ppt {url[:90]}: {type(e).__name__} {str(e)[:80]}")
            continue
        score, toks = name_match(name, text[:20000])
        if score < 0.5:
            log.append(f"ppt {url[:90]} rejected: name tokens {toks} matched {score:.2f}")
            continue
        if not re.search(r"presentation|investor|earnings|revenue|ebitda|highlights|business overview", text[:20000], re.I):
            log.append(f"ppt {url[:90]} rejected: not an investor presentation")
            continue
        period = text_date(text) or doc_date(url, label)[1]
        log.append(f"ppt accepted via {how}, period {period}, link label '{label[:60]}'")
        return url, text, period, how
    return None, None, None, None



def pdf_text(url, sym):
    _, data = http(url, binary=True, timeout=60)
    if not data.startswith(b"%PDF"):
        raise RuntimeError("not a pdf")
    path = os.path.join(fetch.PDF_DIR, f"{re.sub(r'[^A-Za-z0-9_-]', '_', sym)}.pdf")
    with open(path, "wb") as f:
        f.write(data)
    out = fetch.subprocess.run(["pdftotext", "-l", "16", "-layout", path, "-"], capture_output=True, timeout=120)
    text = out.stdout.decode("utf-8", "replace")
    lines = [re.sub(r"\s{2,}", "  ", l).strip() for l in text.splitlines()]
    return "\n".join(l for l in lines if len(l) > 2 and not fetch.NOISE.search(l))


def site_pages(url):
    _, page = http(url)
    title, desc = fetch.meta(page)
    final = url
    pages = [{"url": final, "title": title, "description": desc, "text": fetch.visible_text(page)[:6000]}]
    base = host_of(final)
    picks = []
    for href, label in re.findall(r'(?is)<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', page):
        lab = re.sub(r"<[^>]+>|\s+", " ", label).strip().lower()
        if re.search(r"about|business|product|what we do|services|solutions|overview|profile|segments|portfolio", lab + " " + href.lower()):
            full = urllib.parse.urljoin(final, href)
            if host_of(full) == base and full not in picks and not full.lower().endswith((".pdf", ".jpg", ".png")):
                picks.append(full)
    for sub in picks[:2]:
        try:
            _, p2 = http(sub)
            t2, d2 = fetch.meta(p2)
            pages.append({"url": sub, "title": t2, "description": d2, "text": fetch.visible_text(p2)[:6000]})
        except Exception as e:  # noqa: BLE001
            pages.append({"url": sub, "error": str(e)[:200]})
    return pages


# ---------------------------------------------------------------- per company
LOG_LOCK = threading.Lock()


def evpath(sym):
    return os.path.join(EVIDENCE, f"{re.sub(r'[^A-Za-z0-9_-]', '_', sym)}.json")


def collect(row, refresh=False):
    sym, name = row["sym"], row["nm"]
    path = evpath(sym)
    if os.path.exists(path) and not refresh:
        return sym, "cached", None
    log, errors = [], []
    ev = {"sym": sym, "name": name, "current_baskets": row["baskets"].split("|"),
          "fetched_at": time.strftime("%Y-%m-%d"), "website": None, "ppt": None, "errors": errors}
    old = None
    if os.path.exists(path):
        old = json.load(open(path, encoding="utf-8"))
        ev["extra"] = old.get("extra", [])
    sites = json.load(open(SITES, encoding="utf-8")) if os.path.exists(SITES) else {}
    rec = sites.get(sym) or {}
    site = rec.get("url") or (old or {}).get("website_url")
    if not site:
        # nothing official to examine yet: no evidence file, so the company stays in the queue
        with LOG_LOCK, open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"sym": sym, "status": "no-site", "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
        return sym, "no-site", None
    log.append(f"site {site} via {rec.get('via', 'earlier evidence')}: {rec.get('why', '')}")
    if site:
        try:
            ev["website"] = site_pages(site)
        except Exception as e:  # noqa: BLE001
            errors.append(f"website: {type(e).__name__} {e}"[:200])
    try:
        ppt, text, period, how = find_ppt(sym, name, site, log)
    except Exception as e:  # noqa: BLE001
        errors.append(f"ppt discovery: {e}"[:200])
        ppt, text, period, how = None, None, None, None
    ev["website_url"], ev["ppt_url"], ev["ppt_period"] = site, ppt, period
    ev["ppt"] = text[:12000] if text else None
    ev["discovery"] = {"tool": "fetch2", "ppt_via": how, "log": log}
    if not ev["ppt"] and not ev["website"]:
        errors.append("no official source found: " + "; ".join(log[-3:])[:300])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ev, f, ensure_ascii=False, indent=1)
    status = "ok" if ev["ppt"] and ev["website"] else ("partial" if ev["ppt"] or ev["website"] else "no-source")
    with LOG_LOCK, open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"sym": sym, "status": status, "site": site, "ppt": ppt, "period": period,
                            "ppt_via": how, "errors": errors, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
    return sym, status, errors


def main():
    rows = json.load(open(os.path.join(ROOT, "universe.json"), encoding="utf-8"))
    args = sys.argv[1:]
    refresh = set(args[args.index("--refresh") + 1].split(",")) if "--refresh" in args else set()
    if "--only" in args:
        want = set(args[args.index("--only") + 1].split(","))
        rows = [r for r in rows if r["sym"] in want]
    rows = [r for r in rows if r["sym"] in refresh or not os.path.exists(evpath(r["sym"]))]
    if "--limit" in args:
        rows = rows[: int(args[args.index("--limit") + 1])]
    workers = int(args[args.index("--workers") + 1]) if "--workers" in args else 12
    print(f"queue {len(rows)}", flush=True)
    done, counts = 0, {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(collect, r, r["sym"] in refresh): r["sym"] for r in rows}
        for fu in as_completed(futs):
            done += 1
            try:
                sym, status, errs = fu.result()
            except Exception as e:  # noqa: BLE001
                sym, status, errs = futs[fu], "crash", [str(e)[:200]]
            counts[status] = counts.get(status, 0) + 1
            print(f"{done}/{len(rows)} {sym} {status} {'' if not errs else errs[0][:120]}", flush=True)
    print("summary", counts, "blocked hosts", HOSTS.blocked, flush=True)


if __name__ == "__main__":
    main()
