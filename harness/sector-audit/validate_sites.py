"""Re-check every sites.json entry with the strict identity test; move failures to sites_rejected.json.

A site passes when its homepage domain carries the full distinctive name, or the homepage states the legal name
("X Limited"/"X Ltd"). Failing entries are removed from sites.json (with the reason kept in sites_rejected.json)
and any fetch2 evidence built from them is deleted so the company returns to the queue.
Usage: python -I validate_sites.py [--dry]
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402
import fetch2  # noqa: E402
import strict  # noqa: E402

SITES = os.path.join(fetch.ROOT, "sites.json")
REJ = os.path.join(fetch.ROOT, "sites_rejected.json")


def judge(item):
    sym, rec, name = item
    if rec.get("via") in ("manual", "websearch", "strict-checked"):
        return sym, True, rec.get("via")
    host = fetch2.host_of(rec["url"])
    try:
        final, page = fetch2.http(rec["url"], timeout=15)
    except Exception as e:  # noqa: BLE001
        return sym, False, f"homepage unreachable on recheck: {type(e).__name__}"
    if fetch2.host_of(final) != host:
        return sym, False, f"homepage redirects off-domain to {fetch2.host_of(final)}"
    title, desc = fetch.meta(page)
    text = " ".join((title, desc, fetch.visible_text(page)[:20000], page[:200000]))
    ok, why = strict.strict_ok(name, text, fetch2.host_of(final), fetch2.core_tokens(name))
    return sym, ok, f"{why} [title: {title[:70]}]"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry" in sys.argv
    names = {r["sym"]: r["nm"] for r in json.load(open(os.path.join(fetch.ROOT, "universe.json"), encoding="utf-8"))}
    sites = json.load(open(SITES, encoding="utf-8"))
    rej = json.load(open(REJ, encoding="utf-8")) if os.path.exists(REJ) else {}
    ledger = {json.loads(l)["sym"] for l in open(os.path.join(fetch.ROOT, "ledger.jsonl"), encoding="utf-8") if l.strip()}
    items = [(s, r, names[s]) for s, r in sites.items() if s in names]
    bad = []
    with ThreadPoolExecutor(16) as pool:
        for sym, ok, why in pool.map(judge, items):
            if ok:
                sites[sym]["strict"] = why
            else:
                bad.append((sym, why))
    for sym, why in sorted(bad):
        print(f"REJECT {sym:12} {names[sym][:40]:40} {sites[sym]['url']:45} {why}")
    print(f"{len(items) - len(bad)} pass, {len(bad)} reject")
    if dry:
        return
    for sym, why in bad:
        rej[sym] = dict(sites.pop(sym), rejected=why)
        ev = fetch2.evpath(sym)
        if sym not in ledger and os.path.exists(ev) and json.load(open(ev, encoding="utf-8")).get("discovery"):
            os.remove(ev)
    json.dump(sites, open(SITES, "w", encoding="utf-8"), indent=1, sort_keys=True)
    json.dump(rej, open(REJ, "w", encoding="utf-8"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
