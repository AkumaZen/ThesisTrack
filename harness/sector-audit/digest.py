"""Print a reviewable digest of official-source evidence for the next unreviewed companies.

Each digest shows only text taken from the company's own website and latest investor
presentation, plus the source URLs. Companies already in ledger.jsonl are skipped.
Usage: python -I harness/sector-audit/digest.py [N] [--syms A,B]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
KEY = re.compile(r"manufactur|leading|largest|segment|product|revenue|business|engaged|provid|offer|we are|company is|"
                 r"portfolio|brand|customers|capacity|plant|services|solutions|lending|loan|aum|% of|share", re.I)


def ledger_syms():
    path = os.path.join(ROOT, "ledger.jsonl")
    if not os.path.exists(path):
        return set()
    return {json.loads(l)["sym"] for l in open(path, encoding="utf-8") if l.strip()}


def pick(text, budget):
    """Business-describing lines first, in document order, within a character budget."""
    lines = [l for l in text.splitlines() if len(l) > 25]
    keep = [l for l in lines if KEY.search(l)] or lines
    out, used = [], 0
    for l in keep:
        l = re.sub(r"\s{2,}", " | ", l)[:240]
        if used + len(l) > budget:
            break
        out.append(l)
        used += len(l)
    return "\n".join(out)


def digest(ev):
    parts = [f"### {ev['sym']} | {ev['name']} | now: {', '.join(ev['current_baskets'])}"]
    if ev.get("ppt"):
        parts.append(f"PPT ({ev.get('ppt_period')}) {ev['ppt_url']}\n{pick(ev["ppt"], 750)}")
    for p in (ev.get("website") or [])[:2]:
        if p.get("text"):
            head = " | ".join(x for x in (p.get("title"), p.get("description")) if x)
            parts.append(f"WEB {p['url']}\n{head[:220]}\n{pick(p["text"], 380)}")
    if len(parts) == 1:
        parts.append(f"NO SOURCE. website={ev.get('website_url')} ppt={ev.get('ppt_url')} errors={ev.get('errors')}")
    return "\n".join(parts)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    n = int(args[0]) if args and args[0].isdigit() else 30
    order = [r["sym"] for r in json.load(open(os.path.join(ROOT, "universe.json"), encoding="utf-8"))]
    if "--syms" in args:
        order = args[args.index("--syms") + 1].split(",")
    done = ledger_syms()
    shown = 0
    for sym in order:
        if sym in done and "--syms" not in args:
            continue
        path = os.path.join(ROOT, "evidence", f"{re.sub(r'[^A-Za-z0-9_-]', '_', sym)}.json")
        if not os.path.exists(path):
            continue
        print(digest(json.load(open(path, encoding="utf-8"))))
        print()
        shown += 1
        if shown >= n:
            break


if __name__ == "__main__":
    main()
