from typing import Annotated, Callable
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select
from .config import get_settings
from .database import get_session
from .. import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)
settings = get_settings()

TokenDep = Annotated[str, Depends(oauth2_scheme)]
OptionalTokenDep = Annotated[str | None, Depends(oauth2_scheme_optional)]
SessionDep = Annotated[Session, Depends(get_session)]


def _user_from_token(token: str, session: Session) -> models.User:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
    statement = select(models.User).where(models.User.id == int(user_id))
    user = session.exec(statement).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return user


def get_current_user(token: TokenDep, session: SessionDep) -> models.User:
    return _user_from_token(token, session)


def get_current_user_optional(token: OptionalTokenDep, session: SessionDep) -> models.User | None:
    if not token:
        return None
    return _user_from_token(token, session)


def require_roles(*roles: str) -> Callable[[models.User], models.User]:
    def dependency(user: Annotated[models.User, Depends(get_current_user)]) -> models.User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return dependency
