from __future__ import annotations

from io import BytesIO


def extract_pdf_text(content: bytes, max_pages: int = 4) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""

    try:
        reader = PdfReader(BytesIO(content))
        pages = reader.pages[:max_pages]
    except Exception:
        return ""

    text_parts: list[str] = []
    for page in pages:
        try:
            text_parts.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(text_parts)
