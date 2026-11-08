"""Grep a company's collected official-source text. Usage: grep_ev.py SYM regex [max]"""
import json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.abspath(__file__))
sym, pat = sys.argv[1], re.compile(sys.argv[2], re.I)
cap = int(sys.argv[3]) if len(sys.argv) > 3 else 12
ev = json.load(open(os.path.join(ROOT, "evidence", re.sub(r"[^A-Za-z0-9_-]", "_", sym) + ".json"), encoding="utf-8"))
blobs = [("ppt", ev.get("ppt") or "")] + [("web", p.get("text") or "") for p in ev.get("website") or []] + [("extra", x["text"]) for x in ev.get("extra", [])]
n = 0
for kind, text in blobs:
    for line in text.splitlines():
        if pat.search(line) and n < cap:
            print(f"[{kind}] {re.sub(r'\s{2,}', ' | ', line)[:230]}")
            n += 1
