"""Multi-user login + RBAC, beyond BUILD_PLAN.md's v1 scope (ADR-016).
The original X-API-Key mechanism must keep working unchanged.
"""
import copy
import json
from pathlib import Path

import pytest

from app.services.user_auth import (
    InvalidCredentialsError,
    UserExistsError,
    authenticate,
    change_password,
    create_user,
    decode_token,
    issue_token,
    verify_password,
)
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"
_BASE_PAYLOAD = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_password_hash_roundtrip():
    from app.services.user_auth import hash_password

    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong password", hashed) is False


def test_create_user_and_authenticate(db_conn):
    db = _Session()
    try:
        create_user(db, "auth_test@rdc.in", "s3cret-password", role="read_write")
    finally:
        db.close()

    db = _Session()
    try:
        user = authenticate(db, "auth_test@rdc.in", "s3cret-password")
    finally:
        db.close()
    assert user.email == "auth_test@rdc.in"
    assert user.role == "read_write"
    assert user.last_login_at is not None


def test_authenticate_wrong_password_raises(db_conn):
    db = _Session()
    try:
        create_user(db, "auth_wrong@rdc.in", "correct-password")
    finally:
        db.close()

    db = _Session()
    try:
        with pytest.raises(InvalidCredentialsError):
            authenticate(db, "auth_wrong@rdc.in", "incorrect-password")
    finally:
        db.close()


def test_duplicate_user_raises(db_conn):
    db = _Session()
    try:
        create_user(db, "auth_dup@rdc.in", "pw")
        with pytest.raises(UserExistsError):
            create_user(db, "auth_dup@rdc.in", "pw2")
    finally:
        db.close()


def test_issued_token_decodes_to_matching_claims(db_conn):
    db = _Session()
    try:
        user = create_user(db, "auth_token@rdc.in", "pw", role="read_only")
    finally:
        db.close()
    token = issue_token(user)
    claims = decode_token(token)
    assert claims["sub"] == "auth_token@rdc.in"
    assert claims["role"] == "read_only"


def test_change_password_then_old_password_fails(db_conn):
    db = _Session()
    try:
        create_user(db, "auth_change@rdc.in", "old-password")
    finally:
        db.close()
    db = _Session()
    try:
        change_password(db, "auth_change@rdc.in", "old-password", "new-password-123")
    finally:
        db.close()

    db = _Session()
    try:
        with pytest.raises(InvalidCredentialsError):
            authenticate(db, "auth_change@rdc.in", "old-password")
        user = authenticate(db, "auth_change@rdc.in", "new-password-123")
    finally:
        db.close()
    assert user.email == "auth_change@rdc.in"


# ---------- HTTP-level: login flow, RBAC gating, X-API-Key still works ----------


def test_login_endpoint_issues_a_usable_token(client, db_conn):
    db = _Session()
    try:
        create_user(db, "http_login@rdc.in", "http-password", role="read_write")
    finally:
        db.close()

    resp = client.post("/api/auth/login", json={"email": "http_login@rdc.in", "password": "http-password"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    assert resp.json()["role"] == "read_write"

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["identity"] == "http_login@rdc.in"
    assert me.json()["source"] == "user"


def test_login_endpoint_rejects_wrong_password(client, db_conn):
    db = _Session()
    try:
        create_user(db, "http_login_bad@rdc.in", "right-password")
    finally:
        db.close()

    resp = client.post(
        "/api/auth/login", json={"email": "http_login_bad@rdc.in", "password": "wrong-password"}
    )
    assert resp.status_code == 401


def test_read_only_user_cannot_create_company(client, db_conn):
    db = _Session()
    try:
        create_user(db, "http_readonly@rdc.in", "ro-password", role="read_only")
    finally:
        db.close()

    login = client.post(
        "/api/auth/login", json={"email": "http_readonly@rdc.in", "password": "ro-password"}
    )
    token = login.json()["access_token"]

    resp = client.post(
        "/api/companies",
        json=copy.deepcopy(_BASE_PAYLOAD),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_read_only_user_can_still_read(client, db_conn):
    db = _Session()
    try:
        create_user(db, "http_readonly2@rdc.in", "ro-password", role="read_only")
    finally:
        db.close()
    login = client.post(
        "/api/auth/login", json={"email": "http_readonly2@rdc.in", "password": "ro-password"}
    )
    token = login.json()["access_token"]

    resp = client.get("/api/companies", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_api_key_still_works_unchanged(client):
    """The pre-existing X-API-Key mechanism (machine access, full
    read_write) must keep working exactly as before this feature landed."""
    resp = client.post("/api/companies", json=copy.deepcopy(_BASE_PAYLOAD))
    assert resp.status_code == 201, resp.text


def test_no_credentials_at_all_is_rejected(client):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anon_client:
        resp = anon_client.get("/api/companies")
    assert resp.status_code == 401
