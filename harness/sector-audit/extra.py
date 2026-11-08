"""Add one more official page (company website or company-authored PDF) to a company's evidence.

Usage: python -I harness/sector-audit/extra.py SYMBOL URL [grep-regex]
Prints the page title and, if a regex is given, the matching lines (else the first 1500 chars).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sym, url = sys.argv[1], sys.argv[2]
    pattern = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 else None
    path = os.path.join(fetch.EVIDENCE, f"{re.sub(r'[^A-Za-z0-9_-]', '_', sym)}.json")
    ev = json.load(open(path, encoding="utf-8"))
    if url.lower().split("?")[0].endswith(".pdf") or "AnnPdfOpen" in url:
        text, title = fetch.pdf_text(url, sym + "_extra"), "(pdf)"
        final = url
    else:
        final, page = fetch.get(url)
        title = " | ".join(fetch.meta(page))
        text = fetch.visible_text(page)
    kept = text[:12000]
    if pattern:
        # Long filings put the business description past the first 12,000 chars; keep the matched lines too.
        tail = [ln for ln in text[12000:].splitlines() if pattern.search(ln)]
        if tail:
            kept += "\n[matched lines beyond 12,000 chars]\n" + "\n".join(tail)[:8000]
    ev.setdefault("extra", []).append({"url": final, "title": title, "text": kept})
    json.dump(ev, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(final, "|", title[:200])
    if pattern:
        for line in text.splitlines():
            if pattern.search(line):
                print(" -", line[:300])
    else:
        print(text[:1500])


if __name__ == "__main__":
    main()
