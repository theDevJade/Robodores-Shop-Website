from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, or_
from sqlmodel import Session, select
import jwt
from .. import models, schemas
from ..core import security
from ..core.database import get_session
from ..core.config import get_settings
from ..core import deps

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=schemas.UserRead)
def register_user(
    payload: schemas.UserCreate,
    session: Session = Depends(get_session),
    current_user: models.User | None = Depends(deps.get_current_user_optional),
):
    first_user_exists = session.exec(select(models.User.id).limit(1)).first()
    if first_user_exists and (not current_user or current_user.role != models.Role.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin approval required")
    existing = session.exec(select(models.User).where(models.User.email == payload.email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    if payload.barcode_id:
        conflict = session.exec(select(models.User).where(models.User.barcode_id == payload.barcode_id)).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Barcode already registered")
    user = models.User(
        email=str(payload.email).lower(),
        full_name=payload.full_name,
        role=models.Role(payload.role),
        barcode_id=payload.barcode_id,
        student_id=payload.student_id,
        hashed_password=security.get_password_hash(payload.password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return schemas.UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        barcode_id=user.barcode_id,
        student_id=user.student_id,
        is_active=user.is_active,
    )


@router.post("/request", response_model=schemas.PendingUserRead)
def request_account(payload: schemas.PendingUserCreate, session: Session = Depends(get_session)):
    # prevent duplicates with existing users or pending entries
    email = str(payload.email).lower()
    if session.exec(select(models.User).where(models.User.email == email)).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    if session.exec(select(models.PendingUser).where(models.PendingUser.email == email)).first():
        raise HTTPException(status_code=409, detail="A request for this email already exists")
    pending = models.PendingUser(
        email=email,
        full_name=payload.full_name,
        password_hash=security.get_password_hash(payload.password),
        requested_role=models.Role(payload.requested_role),
    )
    session.add(pending)
    session.commit()
    session.refresh(pending)
    return schemas.PendingUserRead(
        id=pending.id,
        email=pending.email,
        full_name=pending.full_name,
        requested_role=pending.requested_role.value,
        created_at=pending.created_at,
    )


@router.get("/requests", response_model=list[schemas.PendingUserRead])
def list_requests(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    rows = session.exec(select(models.PendingUser).order_by(models.PendingUser.created_at.desc())).all()
    return [
        schemas.PendingUserRead(
            id=r.id,
            email=r.email,
            full_name=r.full_name,
            requested_role=r.requested_role.value,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/requests/{req_id}/approve", response_model=schemas.UserRead)
def approve_request(
    req_id: int,
    payload: schemas.ApprovePending,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    req = session.get(models.PendingUser, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if session.exec(select(models.User).where(models.User.email == req.email)).first():
        session.delete(req)
        session.commit()
        raise HTTPException(status_code=409, detail="Email already registered")
    user = models.User(
        email=req.email,
        full_name=req.full_name,
        role=models.Role(payload.role),
        hashed_password=req.password_hash,
        is_active=True,
    )
    session.add(user)
    session.delete(req)
    session.commit()
    session.refresh(user)
    return schemas.UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        barcode_id=user.barcode_id,
        student_id=user.student_id,
        is_active=user.is_active,
    )


@router.post("/requests/{req_id}/reject")
def reject_request(
    req_id: int,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    req = session.get(models.PendingUser, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    session.delete(req)
    session.commit()
    return {"status": "rejected"}


@router.post("/create", response_model=schemas.UserRead)
def create_user_as_admin(
    payload: schemas.UserCreate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    email = str(payload.email).lower()
    existing = session.exec(select(models.User).where(models.User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = models.User(
        email=email,
        full_name=payload.full_name,
        role=models.Role(payload.role),
        barcode_id=payload.barcode_id,
        student_id=payload.student_id,
        hashed_password=security.get_password_hash(payload.password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return schemas.UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        barcode_id=user.barcode_id,
        student_id=user.student_id,
        is_active=user.is_active,
    )


@router.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    statement = select(models.User).where(models.User.email == form_data.username.lower())
    user = session.exec(statement).first()
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    access = security.create_access_token(str(user.id), [user.role.value])
    refresh = security.create_refresh_token(str(user.id))
    return schemas.Token(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=schemas.Token)
def refresh(token: schemas.TokenRefresh, session: Session = Depends(get_session)):
    try:
        payload = jwt.decode(token.refresh_token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    user = session.get(models.User, int(subject))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    access = security.create_access_token(str(user.id), [user.role.value])
    refresh_token = security.create_refresh_token(str(user.id))
    return schemas.Token(access_token=access, refresh_token=refresh_token)


@router.get("/me", response_model=schemas.UserRead)
def read_me(current: models.User = Depends(deps.get_current_user)):
    return schemas.UserRead(
        id=current.id,
        email=current.email,
        full_name=current.full_name,
        role=current.role.value,
        barcode_id=current.barcode_id,
        student_id=current.student_id,
        is_active=current.is_active,
    )


@router.patch("/me", response_model=schemas.UserRead)
def update_me(
    payload: schemas.UserSelfUpdate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    user = session.get(models.User, current.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.barcode_id is not None:
        user.barcode_id = payload.barcode_id
    if payload.student_id is not None:
        user.student_id = payload.student_id
    if payload.password:
        user.hashed_password = security.get_password_hash(payload.password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return schemas.UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        barcode_id=user.barcode_id,
        student_id=user.student_id,
        is_active=user.is_active,
    )


@router.get("/users", response_model=list[schemas.UserRead])
def list_users(
    search: str | None = None,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    statement = select(models.User)
    if search:
        term = f"%{search.lower()}%"
        statement = statement.where(
            or_(
                func.lower(models.User.full_name).like(term),
                func.lower(models.User.email).like(term),
                func.lower(models.User.role).like(term),
                func.lower(models.User.barcode_id).like(term),
                func.lower(models.User.student_id).like(term),
            )
        )
    statement = statement.order_by(models.User.full_name.asc())
    users = session.exec(statement).all()
    return [
        schemas.UserRead(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role.value,
            barcode_id=user.barcode_id,
            student_id=user.student_id,
            is_active=user.is_active,
        )
        for user in users
    ]


@router.patch("/users/{user_id}", response_model=schemas.UserRead)
def update_user(
    user_id: int,
    payload: schemas.UserUpdate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    user = session.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.full_name:
        user.full_name = payload.full_name
    if payload.role:
        user.role = models.Role(payload.role)
    if payload.barcode_id is not None:
        user.barcode_id = payload.barcode_id
    if payload.student_id is not None:
        user.student_id = payload.student_id
    if payload.password:
        user.hashed_password = security.get_password_hash(payload.password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return schemas.UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        barcode_id=user.barcode_id,
        student_id=user.student_id,
        is_active=user.is_active,
    )


def _unlink_user_references(session: Session, user: models.User) -> None:
    entries = session.exec(
        select(models.AttendanceEntry).where(models.AttendanceEntry.user_id == user.id)
    ).all()
    for entry in entries:
        if not entry.recorded_student_id and user.student_id:
            entry.recorded_student_id = user.student_id
        if not entry.recorded_barcode_id and user.barcode_id:
            entry.recorded_barcode_id = user.barcode_id
        entry.user_id = None
        session.add(entry)

    jobs = session.exec(select(models.ShopJob).where(models.ShopJob.submitter_id == user.id)).all()
    for job in jobs:
        job.submitter_id = None
        session.add(job)

    orders = session.exec(
        select(models.OrderRequest).where(models.OrderRequest.requester_id == user.id)
    ).all()
    for order in orders:
        order.requester_id = None
        session.add(order)

    transactions = session.exec(
        select(models.InventoryTransaction).where(models.InventoryTransaction.performed_by == user.id)
    ).all()
    for txn in transactions:
        txn.performed_by = None
        session.add(txn)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    current_admin: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    if current_admin.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    user = session.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _unlink_user_references(session, user)
    session.delete(user)
    session.commit()
