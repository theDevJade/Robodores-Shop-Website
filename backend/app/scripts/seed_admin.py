from __future__ import annotations
import argparse
from sqlmodel import Session, select
from app.core.database import engine, init_db
from app.core.security import get_password_hash
from app import models


def main():
    parser = argparse.ArgumentParser(description="Seed initial admin user")
    parser.add_argument("email")
    parser.add_argument("password")
    parser.add_argument("full_name")
    args = parser.parse_args()

    init_db()
    with Session(engine) as session:
        existing = session.exec(select(models.User).where(models.User.email == args.email.lower())).first()
        if existing:
            print("User already exists:", existing.email)
            return
        user = models.User(
            email=args.email.lower(),
            full_name=args.full_name,
            role=models.Role.admin,
            hashed_password=get_password_hash(args.password),
            is_active=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        print("Created admin:", user.id, user.email)


if __name__ == "__main__":
    main()
