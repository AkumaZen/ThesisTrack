from typing import Optional

from fastapi import Header, HTTPException, status

from app.config import API_KEY


def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or missing X-API-Key")
