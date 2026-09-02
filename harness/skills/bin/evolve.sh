#!/usr/bin/env bash
# Assembles context for a Refiner pass (harness/refiner.md). Run it, then work
# through refiner.md's four passes by hand against the printed output.
#
# Created at the P0 phase boundary: assembling this context is a sequence
# that just succeeded once and will clearly recur at every future phase
# boundary (Refiner protocol §5 Pass 3 CREATE bar).
set -euo pipefail
cd "$(dirname "$0")/../../.."

WINDOW="${1:-40}"

echo "=== trajectory window: last ${WINDOW} entries ==="
tail -n "${WINDOW}" harness/journal/trajectory.jsonl

echo
echo "=== harness file listing ==="
find harness -type f | sort

echo
echo "=== git log since last evolution ==="
LAST_EVOLUTION=$(ls -1 harness/journal/evolutions/*.md 2>/dev/null | tail -1 || true)
if [ -n "${LAST_EVOLUTION}" ]; then
  LAST_COMMIT=$(git log -1 --format=%H -- "${LAST_EVOLUTION}" 2>/dev/null || true)
  if [ -n "${LAST_COMMIT}" ]; then
    git log --oneline "${LAST_COMMIT}..HEAD"
  else
    git log --oneline -20
  fi
else
  git log --oneline -20
fi

echo
echo "=== test status ==="
if [ -f .venv/Scripts/python.exe ]; then
  PY=.venv/Scripts/python.exe
else
  PY=.venv/bin/python
fi
"${PY}" -m pytest -q || true

echo
echo "=== prompt.md line count (cap: 120) ==="
wc -l < harness/prompt.md
