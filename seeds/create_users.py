"""One-off script to seed the two named users the human asked for.

Generates a random password per user and prints it ONCE - nothing else
stores the plaintext. Run once against whichever DATABASE_URL is active:

    python -m seeds.create_users
"""
import secrets
import sys

from app.db import SessionLocal
from app.services.user_auth import UserExistsError, create_user

USERS = ["rohit.negi@rdc.in", "siddhesh.dige@rdc.in"]


def main() -> None:
    db = SessionLocal()
    try:
        for email in USERS:
            password = secrets.token_urlsafe(12)
            try:
                create_user(db, email, password, role="read_write")
            except UserExistsError:
                print(f"{email}: already exists, skipped", file=sys.stderr)
                continue
            print(f"{email}: {password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
