"""Swappable LLM adapter (BUILD_PLAN.md §5: "one adapter interface... so the
provider is swappable"). Every call is logged to disk (model name, prompt
hash, raw response) per §5's instrumentation requirement.

No default silently degrades to a canned answer — get_llm_client() raises
clearly if unconfigured. A silently-fabricated "review" would be exactly the
kind of unverified content the constitution (rule 7) exists to keep out of
the system; tests inject FakeLLMClient explicitly instead.
"""
import hashlib
import json
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "llm_calls"


class LLMResponseError(Exception):
    """Raised when a provider response cannot be parsed as JSON."""


class LLMClient(ABC):
    model_name: str

    @abstractmethod
    def complete_json(self, system: str, user: str) -> dict:
        ...


def _log_call(model_name: str, system: str, user: str, raw_response: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    prompt_hash = hashlib.sha256((system + "\n" + user).encode("utf-8")).hexdigest()[:16]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    record = {
        "model_name": model_name,
        "prompt_hash": prompt_hash,
        "system": system,
        "user": user,
        "raw_response": raw_response,
    }
    (LOG_DIR / f"{timestamp}-{prompt_hash}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


def _parse_json_response(model_name: str, system: str, user: str, raw: str) -> dict:
    _log_call(model_name, system, user, raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMResponseError(f"non-JSON response from {model_name}: {raw[:300]!r}") from exc


class FakeLLMClient(LLMClient):
    """Deterministic client for tests — no network, no API key required."""

    def __init__(
        self,
        response: Optional[dict] = None,
        raw_text: Optional[str] = None,
        model_name: str = "fake-llm",
    ):
        self._response = response
        self._raw_text = raw_text
        self.model_name = model_name
        self.calls: list[tuple[str, str]] = []

    def complete_json(self, system: str, user: str) -> dict:
        self.calls.append((system, user))
        raw = self._raw_text if self._raw_text is not None else json.dumps(self._response)
        return _parse_json_response(self.model_name, system, user, raw)


class AnthropicLLMClient(LLMClient):
    def __init__(self, api_key: str, model: str = "claude-sonnet-5"):
        self.api_key = api_key
        self.model_name = model

    def complete_json(self, system: str, user: str) -> dict:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": self.model_name,
                "max_tokens": 1024,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw = resp.json()["content"][0]["text"]
        return _parse_json_response(self.model_name, system, user, raw)


def get_llm_client() -> LLMClient:
    """FastAPI dependency — override with a FakeLLMClient in tests."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set; no LLM provider is configured for /ai-review. "
            "(Tests should override app.llm.client.get_llm_client with a FakeLLMClient.)"
        )
    return AnthropicLLMClient(api_key=api_key, model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"))
