from datetime import datetime, time
from collections import defaultdict
from dataclasses import dataclass
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from .. import models, schemas
from ..core.database import get_session
from ..core import deps
from ..models_config import AppConfig

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _current_block(ts: datetime, session: Session) -> models.ScheduleBlock | None:
    weekday = ts.weekday()
    query = select(models.ScheduleBlock).where(
        models.ScheduleBlock.weekday == weekday,
        models.ScheduleBlock.active == True,  # noqa: E712
    )
    for block in session.exec(query):
        if block.start_time <= ts.time() <= block.end_time:
            return block
    return None


def _restrict(session: Session) -> bool:
    config = session.get(AppConfig, 1)
    if not config:
        config = AppConfig(id=1, restrict_attendance_to_schedule=True)
        session.add(config)
        session.commit()
        session.refresh(config)
    return config.restrict_attendance_to_schedule


@dataclass
class ResolvedAttendee:
    user: models.User | None
    student_id: str | None
    barcode_id: str | None


def _resolve_attendee(payload: schemas.AttendanceScan, session: Session) -> ResolvedAttendee:
    barcode = payload.barcode_id.strip() if payload.barcode_id else None
    student_id = payload.student_id.strip() if payload.student_id else None

    user = None
    if barcode:
        user = session.exec(select(models.User).where(models.User.barcode_id == barcode)).first()
    if not user and student_id:
        user = session.exec(select(models.User).where(models.User.student_id == student_id)).first()

    recorded_student_id = student_id or (user.student_id if user else None)
    recorded_barcode_id = barcode or (user.barcode_id if user else None)

    if user:
        return ResolvedAttendee(user=user, student_id=recorded_student_id, barcode_id=recorded_barcode_id)

    if not student_id:
        raise HTTPException(status_code=404, detail="ID not registered")
    if not student_id.isdigit() or len(student_id) != 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="student_id must be a 6-digit number"
        )
    return ResolvedAttendee(user=None, student_id=recorded_student_id, barcode_id=recorded_barcode_id)


def _open_entry(session: Session, attendee: ResolvedAttendee) -> models.AttendanceEntry | None:
    statement = select(models.AttendanceEntry).where(models.AttendanceEntry.check_out.is_(None))
    if attendee.user:
        statement = statement.where(models.AttendanceEntry.user_id == attendee.user.id)
    elif attendee.student_id:
        statement = statement.where(models.AttendanceEntry.recorded_student_id == attendee.student_id)
    elif attendee.barcode_id:
        statement = statement.where(models.AttendanceEntry.recorded_barcode_id == attendee.barcode_id)
    else:
        return None
    statement = statement.order_by(models.AttendanceEntry.check_in.desc())
    return session.exec(statement).first()


def _to_read(entry: models.AttendanceEntry, student: models.User | None) -> schemas.AttendanceRead:
    identifier = entry.recorded_student_id
    if not identifier and student and student.student_id:
        identifier = student.student_id
    if not identifier and entry.recorded_barcode_id:
        identifier = entry.recorded_barcode_id
    display_name = student.full_name if student else (identifier or "Unassigned attendee")
    return schemas.AttendanceRead(
        id=entry.id,
        student_name=display_name,
        student_identifier=identifier,
        check_in=entry.check_in,
        check_out=entry.check_out,
        status=entry.status.value,
        note=entry.note,
    )


@router.post("/scan", response_model=schemas.AttendanceRead)
def record_scan(
    payload: schemas.AttendanceScan,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    if not (payload.barcode_id or payload.student_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="barcode_id or student_id is required")
    attendee = _resolve_attendee(payload, session)
    student = attendee.user
    note_text = (payload.note or "").strip() or None

    now = payload.timestamp
    block = _current_block(now, session)
    restrict = _restrict(session)
    mode = (payload.mode or "in").lower()
    open_entry = _open_entry(session, attendee)

    is_admin_attendee = bool(student and student.role == models.Role.admin)
    flag_unverified = restrict and not block and not is_admin_attendee

    if mode == "out":
        if not open_entry:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot check out before checking in")
        open_entry.check_out = now
        if open_entry.check_out and open_entry.check_in and open_entry.check_out.date() != open_entry.check_in.date():
            open_entry.status = models.AttendanceStatus.missing_out
        if note_text:
            open_entry.note = note_text
        if flag_unverified and open_entry.status == models.AttendanceStatus.ok:
            open_entry.status = models.AttendanceStatus.unverified
        session.add(open_entry)
        session.commit()
        session.refresh(open_entry)
        return _to_read(open_entry, student)

    if open_entry:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already checked in; check out first")
    entry = models.AttendanceEntry(
        user_id=student.id if student else None,
        recorded_student_id=attendee.student_id,
        recorded_barcode_id=attendee.barcode_id,
        check_in=now,
        note=note_text,
        status=models.AttendanceStatus.unverified if flag_unverified else models.AttendanceStatus.ok,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _to_read(entry, student)


@router.get("/summary/today", response_model=schemas.AttendanceSummary)
def today_summary(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    today = datetime.utcnow().date()
    start = datetime.combine(today, time.min)
    end = datetime.combine(today, time.max)
    open_rows = session.exec(
        select(models.AttendanceEntry)
        .where(models.AttendanceEntry.check_in >= start)
        .where(models.AttendanceEntry.check_in <= end)
        .where(models.AttendanceEntry.check_out.is_(None))
    ).all()
    return schemas.AttendanceSummary(date=today.isoformat(), open_entries=len(open_rows))


@router.get("/today_logs", response_model=list[schemas.AttendanceLogItem])
def today_logs(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    today = datetime.utcnow().date()
    start = datetime.combine(today, time.min)
    end = datetime.combine(today, time.max)
    rows = (
        session.exec(
            select(models.AttendanceEntry)
            .where(models.AttendanceEntry.check_in >= start)
            .where(models.AttendanceEntry.check_in <= end)
            .order_by(models.AttendanceEntry.check_in.desc())
        )
        .all()
        or []
    )
    results: list[schemas.AttendanceLogItem] = []
    for entry in rows:
        student = session.get(models.User, entry.user_id) if entry.user_id else None
        display_name = student.full_name if student else (entry.recorded_student_id or entry.recorded_barcode_id or "Unknown")
        results.append(
            schemas.AttendanceLogItem(
                id=entry.id,
                student_name=display_name,
                check_in=entry.check_in,
                check_out=entry.check_out,
            )
        )
    return results


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: int,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    entry = session.get(models.AttendanceEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    session.delete(entry)
    session.commit()
    return {"status": "deleted"}


@router.patch("/entries/{entry_id}/status", response_model=schemas.AttendanceRead)
def update_entry_status(
    entry_id: int,
    payload: schemas.AttendanceStatusUpdate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    entry = session.get(models.AttendanceEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    try:
        new_status = models.AttendanceStatus(payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid status") from exc
    if new_status not in (models.AttendanceStatus.ok, models.AttendanceStatus.unverified):
        raise HTTPException(status_code=422, detail="Status can only be set to verified/unverified")
    entry.status = new_status
    session.add(entry)
    session.commit()
    session.refresh(entry)
    student = session.get(models.User, entry.user_id) if entry.user_id else None
    return _to_read(entry, student)


@router.get("/logs_by_date", response_model=list[schemas.AttendanceDay])
def logs_by_date(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    rows = session.exec(select(models.AttendanceEntry).order_by(models.AttendanceEntry.check_in)).all()
    grouped = defaultdict(list)
    for entry in rows:
        student = session.get(models.User, entry.user_id) if entry.user_id else None
        d = (entry.check_in or entry.check_out or datetime.utcnow()).date().isoformat()
        grouped[d].append(_to_read(entry, student))
    return [schemas.AttendanceDay(date=k, entries=v) for k, v in sorted(grouped.items(), key=lambda x: x[0], reverse=True)]
