"""Find official websites for queued companies without Screener or search-engine scraping.

Candidates come from (1) sites.json entries already recorded (manual or WebSearch-found), (2) Wikidata
(official website by ISIN), and (3) domains derived from the company name. A candidate is accepted only if its
homepage carries the company's distinctive name tokens AND links to an investor section (SEBI LODR Reg 46 requires
listed companies to host investor disclosures on their website). Results go to sites.json with the reason.

Usage: python -I find_sites.py QUEUE.json [--workers N]
"""
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402
import fetch2  # noqa: E402

SITES = os.path.join(fetch.ROOT, "sites.json")


def candidates(name):
    toks = fetch2.core_tokens(name)
    words = re.findall(r"[a-z0-9]+", re.sub(r"\(.*?\)", " ", name.lower()).replace("&", " and "))
    words = [w for w in words if w not in ("ltd", "limited", "the", "and", "of", "co", "pvt")]
    stems = []
    for s in ("".join(toks), "".join(words), toks[0] if toks else "", "".join(toks[:2]), "".join(w[0] for w in words) if len(words) > 2 else "",
              "".join(toks) + "ltd", "".join(words) + "ltd", "".join(words) + "limited"):
        if len(s) >= 3 and s not in stems:
            stems.append(s)
    out = []
    for s in stems[:6]:
        for tld in (".com", ".in", ".co.in"):
            out.append(f"https://www.{s}{tld}/")
    return out


def check(url, name):
    try:
        final, page = fetch.get(url, timeout=12)
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}"
    title, desc = fetch.meta(page)
    text = title + " " + desc + " " + fetch.visible_text(page)[:10000]
    score, toks = fetch2.name_match(name, text, fetch2.host_of(final))
    investor = re.search(r"investor|shareholder|stock exchange|annual report|corporate governance", page, re.I)
    if score >= 0.67 and investor:
        return final, f"name tokens {toks} matched {score:.2f}; investor section linked"
    return None, f"name {score:.2f} investor {'yes' if investor else 'no'}"


def resolve(item):
    sym, name, wd = item
    tried = []
    for url in ([wd] if wd else []) + candidates(name):
        got, why = check(url, name)
        tried.append(f"{url} -> {why}")
        if got:
            p = fetch2.urllib.parse.urlparse(got)
            return sym, {"url": f"{p.scheme}://{p.netloc}/", "via": "wikidata" if url == wd else "name-derived domain", "why": why}, tried
    return sym, None, tried


def main():
    queue = json.load(open(sys.argv[1]))
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 24
    rows = {r["sym"]: r for r in json.load(open(os.path.join(fetch.ROOT, "universe.json"), encoding="utf-8"))}
    sites = json.load(open(SITES, encoding="utf-8")) if os.path.exists(SITES) else {}
    wd = json.load(open(os.path.join(os.environ.get("TEMP", "."), "wd_sites.json"))) if os.path.exists(os.path.join(os.environ.get("TEMP", "."), "wd_sites.json")) else {}
    todo = [(s, rows[s]["nm"], wd.get(s)) for s in queue if s in rows and s not in sites]
    print("to resolve", len(todo), flush=True)
    found = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (sym, hit, tried) in enumerate(pool.map(resolve, todo), 1):
            if hit:
                sites[sym] = hit
                found += 1
            if i % 50 == 0 or i == len(todo):
                json.dump(sites, open(SITES, "w", encoding="utf-8"), indent=1, sort_keys=True)  # checkpoint
                print(f"{i}/{len(todo)} found {found}", flush=True)
    json.dump(sites, open(SITES, "w", encoding="utf-8"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
