from datetime import datetime, timedelta, timezone
from typing import Any
import jwt
from passlib.context import CryptContext
from .config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_token(data: dict[str, Any], expires_minutes: int) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")

def create_access_token(subject: str, roles: list[str]) -> str:
    return create_token({"sub": subject, "roles": roles, "type": "access"}, settings.access_token_expire_minutes)

def create_refresh_token(subject: str) -> str:
    return create_token({"sub": subject, "type": "refresh"}, settings.refresh_token_expire_minutes)
