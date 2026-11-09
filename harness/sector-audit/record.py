"""Append audit verdicts to ledger.jsonl.

Reads lines from stdin, one company per line, fields separated by " ~ ":
  SYMBOL ~ V|U ~ sources joined by "+" from ppt, web, extra (or "-") ~ basket_key[,basket_key] ~ business activities seen in the source ~ rationale
V = verified from the official source. U = UNVERIFIED (source missing or insufficient); basket may be "-".
Source URLs and document period are copied from the evidence file, so every row is traceable.
A symbol recorded again replaces its earlier row.
"""
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(ROOT, "ledger.jsonl")


def main():
    known = {}
    if os.path.exists(LEDGER):
        for l in open(LEDGER, encoding="utf-8"):
            if l.strip():
                row = json.loads(l)
                known[row["sym"]] = row
    added = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        f = [x.strip() for x in line.split(" ~ ")]
        if len(f) != 6 or f[1] not in ("V", "U") or not set(f[2].split("+")) <= {"ppt", "web", "extra", "-"}:
            sys.exit(f"bad line: {line.strip()}")
        sym, status, src, baskets, activities, rationale = f
        ev_path = os.path.join(ROOT, "evidence", f"{re.sub(r'[^A-Za-z0-9_-]', '_', sym)}.json")
        if not os.path.exists(ev_path):
            sys.exit(f"no evidence file for {sym}")
        ev = json.load(open(ev_path, encoding="utf-8"))
        kinds = set(src.split("+")) - {"-"}
        if status == "V" and not kinds:
            sys.exit(f"{sym}: a verified row needs a source")
        if "ppt" in kinds and not ev.get("ppt"):
            sys.exit(f"{sym}: ppt cited but no ppt text was collected")
        if "web" in kinds and not ev.get("website"):
            sys.exit(f"{sym}: website cited but no website text was collected")
        if "extra" in kinds and not ev.get("extra"):
            sys.exit(f"{sym}: extra page cited but none was collected")
        sources = []
        if "ppt" in kinds:
            sources.append({"type": "investor_presentation", "url": ev["ppt_url"], "period": ev.get("ppt_period")})
        if "web" in kinds:
            sources.append({"type": "official_website", "url": ev["website"][0]["url"], "fetched": ev["fetched_at"]})
        for x in ev.get("extra", []) if "extra" in kinds else []:
            sources.append({"type": "official_page", "url": x["url"]})
        prev = ev["current_baskets"]
        if isinstance(prev, str):  # some evidence stubs store the universe's pipe-joined string
            prev = [b for b in prev.split("|") if b]
        known[sym] = {"sym": sym, "name": ev["name"], "status": "VERIFIED" if status == "V" else "UNVERIFIED",
                      "baskets": [] if baskets == "-" else baskets.split(","), "previous_baskets": prev,
                      "sources": sources, "activities": activities, "rationale": rationale,
                      "reviewed_at": time.strftime("%Y-%m-%d")}
        added += 1
    with open(LEDGER, "w", encoding="utf-8") as out:
        for row in known.values():
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"recorded {added}; ledger has {len(known)} companies")


if __name__ == "__main__":
    main()
