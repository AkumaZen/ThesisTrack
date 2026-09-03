"""Multi-user login with RBAC - beyond BUILD_PLAN.md's v1 scope (§0 specifies
a single-analyst static API key). Built at the user's explicit request; see
ADR-016 in harness/memory/decisions.md. The original X-API-Key mechanism
(app/auth.py) still works unchanged for machine-to-machine access.
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-only-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24
PBKDF2_ITERATIONS = 260_000


class InvalidCredentialsError(Exception):
    pass


class UserExistsError(Exception):
    pass


class NotFoundError(Exception):
    pass


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, digest_hex = stored_hash.split("$")
    except ValueError:
        return False
    candidate = hash_password(password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(candidate, stored_hash)


def create_user(db: Session, email: str, password: str, role: str = "read_write") -> User:
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise UserExistsError(f"user '{email}' already exists")
    user = User(email=email, password_hash=hash_password(password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email, User.is_active.is_(True)))
    if user is None or not verify_password(password, user.password_hash):
        raise InvalidCredentialsError("invalid email or password")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def issue_token(user: User) -> str:
    payload = {
        "sub": user.email,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def change_password(db: Session, email: str, old_password: str, new_password: str) -> None:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise NotFoundError(f"user '{email}' not found")
    if not verify_password(old_password, user.password_hash):
        raise InvalidCredentialsError("current password is incorrect")
    user.password_hash = hash_password(new_password)
    db.commit()
