from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.config import ANALYST_NAME, API_KEY
from app.services.user_auth import decode_token


@dataclass
class Actor:
    """Who's making this request - either a logged-in user (JWT) or the
    machine-level static key (grandfathered, full read_write access)."""

    identity: str
    role: str
    source: str


def get_current_actor(
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> Actor:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
        try:
            payload = decode_token(token)
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token"
            ) from exc
        return Actor(identity=payload["sub"], role=payload.get("role", "read_write"), source="user")

    if x_api_key == API_KEY:
        return Actor(identity=ANALYST_NAME, role="read_write", source="api_key")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="provide a valid X-API-Key or Authorization: Bearer <token>",
    )


def require_write(actor: Actor = Depends(get_current_actor)) -> Actor:
    if actor.role != "read_write":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="read-only users cannot perform this action"
        )
    return actor
