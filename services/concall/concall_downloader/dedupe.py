from __future__ import annotations

import hashlib
from pathlib import Path


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class Deduper:
    def __init__(self) -> None:
        self._seen: dict[str, Path] = {}

    def existing_path(self, digest: str) -> Path | None:
        return self._seen.get(digest)

    def remember(self, digest: str, path: Path) -> None:
        self._seen[digest] = path
