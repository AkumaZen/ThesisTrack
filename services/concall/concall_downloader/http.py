from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import PurePosixPath
from urllib.parse import urlparse

import requests

from concall_downloader.classify import DOWNLOAD_EXTENSIONS, extension_from_url
from concall_downloader.models import DownloadedFile
from concall_downloader.naming import filename_from_url

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
    "Connection": "keep-alive",
}


class DownloadError(RuntimeError):
    pass


@dataclass
class HttpClient:
    timeout: int = 30

    def __post_init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def get_json(self, url: str, **kwargs: object) -> object:
        response = self.session.get(url, timeout=self.timeout, **kwargs)
        response.raise_for_status()
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            preview = response.text[:160].replace("\n", " ").strip()
            raise DownloadError(f"Expected JSON from {response.url}; got {preview!r}") from exc

    def get_text(self, url: str, **kwargs: object) -> str:
        response = self.session.get(url, timeout=self.timeout, **kwargs)
        response.raise_for_status()
        return response.text

    def download(self, urls: list[str]) -> DownloadedFile:
        errors: list[str] = []
        for url in urls:
            if not url:
                continue
            try:
                response = self.session.get(url, timeout=self.timeout, allow_redirects=True)
                response.raise_for_status()
            except requests.RequestException as exc:
                errors.append(f"{url}: {exc}")
                continue

            content_type = response.headers.get("content-type", "").split(";")[0].lower()
            extension = _extension_from_response(response.url, content_type)
            if extension not in DOWNLOAD_EXTENSIONS:
                errors.append(f"{url}: unsupported content type {content_type or 'unknown'}")
                continue
            if not response.content:
                errors.append(f"{url}: empty response")
                continue
            return DownloadedFile(
                content=response.content,
                final_url=response.url,
                original_filename=filename_from_url(response.url),
                extension=extension,
                content_type=content_type,
            )

        joined = "; ".join(errors) if errors else "no usable URLs"
        raise DownloadError(joined)


def _extension_from_response(url: str, content_type: str) -> str:
    extension = extension_from_url(url)
    if extension:
        return extension
    if content_type == "application/pdf":
        return ".pdf"
    if content_type in {"application/vnd.ms-powerpoint", "application/powerpoint"}:
        return ".ppt"
    if content_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return ".pptx"
    return PurePosixPath(urlparse(url).path.lower()).suffix
