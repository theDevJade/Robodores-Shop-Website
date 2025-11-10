from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy import func, or_
from sqlmodel import Session, select
from .. import models, schemas
from ..core import deps
from ..core.database import get_session
from ..core.config import get_settings

router = APIRouter(prefix="/manufacturing", tags=["manufacturing"])
settings = get_settings()

STATUS_LABELS = {
    models.ManufacturingStatus.design_submitted: "Design Submitted",
    models.ManufacturingStatus.ready_for_manufacturing: "Ready for Manufacturing",
    models.ManufacturingStatus.in_progress: "In Progress",
    models.ManufacturingStatus.quality_check: "Quality Check",
    models.ManufacturingStatus.completed: "Completed",
}

STATUS_ORDER = {status: idx for idx, status in enumerate(STATUS_LABELS.keys())}

PRIORITY_WEIGHT = {
    models.ManufacturingPriority.urgent: 0,
    models.ManufacturingPriority.normal: 1,
    models.ManufacturingPriority.low: 2,
}

TYPE_REQUIRED_FIELDS = {
    models.ManufacturingType.cnc: ["cam_link", "cam_student", "cnc_operator", "material_stock"],
    models.ManufacturingType.printing: ["printer_assignment", "slicer_profile", "filament_type"],
    models.ManufacturingType.manual: ["tool_type", "dimensions", "responsible_student"],
}

STUDENT_TRANSITIONS = {
    models.ManufacturingStatus.design_submitted: {
        models.ManufacturingStatus.ready_for_manufacturing,
    },
    models.ManufacturingStatus.ready_for_manufacturing: {
        models.ManufacturingStatus.design_submitted,
        models.ManufacturingStatus.in_progress,
    },
    models.ManufacturingStatus.in_progress: {
        models.ManufacturingStatus.ready_for_manufacturing,
        models.ManufacturingStatus.quality_check,
    },
    models.ManufacturingStatus.quality_check: {
        models.ManufacturingStatus.in_progress,
        models.ManufacturingStatus.completed,
    },
    models.ManufacturingStatus.completed: {
        models.ManufacturingStatus.quality_check,
    },
}


def _require_text(value: str, label: str) -> str:
    if value is None:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    trimmed = value.strip()
    if not trimmed:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return trimmed


def _dedupe_ids(raw_ids: list[int] | None) -> list[int]:
    if not raw_ids:
        return []
    seen: set[int] = set()
    deduped: list[int] = []
    for value in raw_ids:
        if value is None:
            continue
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _validate_assignment_targets(
    session: Session,
    ids: list[int],
    allowed_roles: set[models.Role],
) -> None:
    if not ids:
        return
    rows = session.exec(select(models.User).where(models.User.id.in_(ids))).all()
    found = {row.id: row for row in rows}
    missing = [str(uid) for uid in ids if uid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Unknown assignee IDs: {', '.join(missing)}")
    for uid, user in found.items():
        if user.role not in allowed_roles:
            allowed_list = ", ".join(role.value for role in allowed_roles)
            raise HTTPException(
                status_code=422,
                detail=f"{user.full_name} must have one of roles: {allowed_list}",
            )

def _is_lead(user: models.User) -> bool:
    return user.role in (models.Role.lead, models.Role.admin)


def _status_from_value(value: str) -> models.ManufacturingStatus:
    try:
        return models.ManufacturingStatus(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid status") from exc


def _type_from_value(value: str) -> models.ManufacturingType:
    try:
        return models.ManufacturingType(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid manufacturing type") from exc


def _priority_from_value(value: str) -> models.ManufacturingPriority:
    try:
        return models.ManufacturingPriority(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid priority") from exc


def _ensure_positive_quantity(quantity: int | None) -> None:
    if quantity is not None and quantity < 1:
        raise HTTPException(status_code=422, detail="Quantity must be at least 1")


def _load_users_map(session: Session, parts: list[models.ManufacturingPart]) -> dict[int, models.User]:
    ids: set[int] = set()
    for part in parts:
        ids.add(part.created_by_id)
        if part.approved_by_id:
            ids.add(part.approved_by_id)
        if part.eta_by_id:
            ids.add(part.eta_by_id)
        for sid in part.assigned_student_ids or []:
            ids.add(sid)
        for lid in part.assigned_lead_ids or []:
            ids.add(lid)
    if not ids:
        return {}
    rows = session.exec(select(models.User).where(models.User.id.in_(ids))).all()
    return {row.id: row for row in rows if row}


def _manufacturing_upload_dir(part_id: int) -> Path:
    folder = settings.upload_root / "manufacturing" / str(part_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _file_url_from_path(path: str | None) -> str | None:
    if not path:
        return None


def _remove_part_files(part_id: int) -> None:
    folder = settings.upload_root / "manufacturing" / str(part_id)
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    try:
        rel = Path(path).resolve().relative_to(settings.upload_root.resolve())
        return f"/uploads/{rel.as_posix()}"
    except Exception:
        return None


def _assignment_from_user(user: models.User | None) -> schemas.ManufacturingAssignment | None:
    if not user:
        return None
    return schemas.ManufacturingAssignment(id=user.id, name=user.full_name, role=user.role.value)


def _assignments_from_ids(
    ids: list[int] | None,
    user_map: dict[int, models.User],
) -> list[schemas.ManufacturingAssignment]:
    if not ids:
        return []
    assignments: list[schemas.ManufacturingAssignment] = []
    for uid in ids:
        user = user_map.get(uid)
        if not user:
            continue
        assignments.append(
            schemas.ManufacturingAssignment(id=user.id, name=user.full_name, role=user.role.value)
        )
    return assignments


def _can_touch(part: models.ManufacturingPart, user: models.User) -> bool:
    if _is_lead(user):
        return True
    assignments = (part.assigned_student_ids or []) + (part.assigned_lead_ids or [])
    return part.created_by_id == user.id or user.id in assignments


def _next_lane_position(session: Session, status: models.ManufacturingStatus) -> int:
    result = session.exec(
        select(func.max(models.ManufacturingPart.lane_position)).where(
            models.ManufacturingPart.status == status
        )
    ).first()
    return (result or 0) + 1


def _update_status(
    session: Session,
    part: models.ManufacturingPart,
    status: models.ManufacturingStatus,
) -> None:
    if part.status == status:
        return
    part.status = status
    part.last_status_change = datetime.utcnow()
    part.lane_position = _next_lane_position(session, status)


def _validate_required_fields(part: models.ManufacturingPart) -> None:
    required = TYPE_REQUIRED_FIELDS.get(part.manufacturing_type, [])
    missing = [field for field in required if not getattr(part, field)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"{part.manufacturing_type.value.upper()} parts require {', '.join(missing)}",
        )


def _auto_promote_if_ready(session: Session, part: models.ManufacturingPart) -> None:
    if part.status != models.ManufacturingStatus.design_submitted:
        return
    has_base_details = bool(part.cad_link and part.material and part.quantity >= 1)
    if not has_base_details:
        return
    required = TYPE_REQUIRED_FIELDS.get(part.manufacturing_type, [])
    if all(getattr(part, field) for field in required):
        _update_status(session, part, models.ManufacturingStatus.ready_for_manufacturing)


def _apply_eta(
    part: models.ManufacturingPart,
    payload: schemas.ManufacturingClaimInput | schemas.ManufacturingEtaUpdate | None,
    current: models.User,
) -> None:
    if not payload:
        return
    eta_minutes = getattr(payload, "eta_minutes", None)
    eta_target = getattr(payload, "eta_target", None)
    now = datetime.utcnow()
    if eta_target is not None:
        target_dt = eta_target if isinstance(eta_target, datetime) else datetime.fromisoformat(str(eta_target))
        if target_dt.tzinfo is not None:
            target_dt = target_dt.astimezone(timezone.utc).replace(tzinfo=None)
        if target_dt <= now:
            raise HTTPException(status_code=422, detail="ETA target must be in the future")
        part.eta_target = target_dt
        eta_minutes = max(1, int((target_dt - now).total_seconds() // 60))
    elif eta_minutes is not None:
        part.eta_target = now + timedelta(minutes=eta_minutes)
    else:
        return
    part.student_eta_minutes = eta_minutes
    part.eta_note = getattr(payload, "eta_note", None)
    part.eta_updated_at = now
    part.eta_by_id = current.id


def _serialize_parts(
    parts: list[models.ManufacturingPart],
    session: Session,
    current: models.User,
) -> list[schemas.ManufacturingPartRead]:
    user_map = _load_users_map(session, parts)
    serialized: list[schemas.ManufacturingPartRead] = []
    for part in parts:
        created_by = _assignment_from_user(user_map.get(part.created_by_id))
        approved_by = _assignment_from_user(user_map.get(part.approved_by_id))
        assigned_students = _assignments_from_ids(part.assigned_student_ids, user_map)
        assigned_leads = _assignments_from_ids(part.assigned_lead_ids, user_map)
        can_assign = _is_lead(current)
        can_edit = can_assign or _can_touch(part, current)
        can_move = can_edit and (can_assign or not part.status_locked)
        eta_by = _assignment_from_user(user_map.get(part.eta_by_id)) if part.eta_by_id else None
        serialized.append(
            schemas.ManufacturingPartRead(
                id=part.id,
                part_name=part.part_name,
                subsystem=part.subsystem,
                material=part.material,
                quantity=part.quantity,
                manufacturing_type=part.manufacturing_type.value,
                cad_link=part.cad_link,
                cam_link=part.cam_link,
                cam_student=part.cam_student,
                cnc_operator=part.cnc_operator,
                material_stock=part.material_stock,
                printer_assignment=part.printer_assignment,
                slicer_profile=part.slicer_profile,
                filament_type=part.filament_type,
                tool_type=part.tool_type,
                dimensions=part.dimensions,
                responsible_student=part.responsible_student,
                notes=part.notes,
                priority=part.priority.value,
                status=part.status.value,
                status_label=STATUS_LABELS[part.status],
                status_locked=part.status_locked,
                lock_reason=part.lock_reason,
                created_at=part.created_at,
                updated_at=part.updated_at,
                last_status_change=part.last_status_change,
                created_by=created_by if created_by else schemas.ManufacturingAssignment(id=part.created_by_id, name=part.created_by_name, role="unknown"),
                approved_by=approved_by,
                assigned_students=assigned_students,
                assigned_leads=assigned_leads,
                can_edit=can_edit,
                can_move=can_move,
                can_assign=can_assign,
                student_eta_minutes=part.student_eta_minutes,
                eta_note=part.eta_note,
                eta_updated_at=part.eta_updated_at,
                eta_by=eta_by,
                eta_target=part.eta_target,
                actual_start=part.actual_start,
                actual_complete=part.actual_complete,
                cad_file_name=part.cad_file_name,
                cad_file_url=_file_url_from_path(part.cad_file_path),
                cam_file_name=part.cam_file_name,
                cam_file_url=_file_url_from_path(part.cam_file_path),
            )
        )
    return serialized


@router.get("/parts", response_model=list[schemas.ManufacturingPartRead])
def list_parts(
    status: str | None = Query(default=None),
    manufacturing_type: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=80),
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    statement = select(models.ManufacturingPart)
    if status:
        statement = statement.where(models.ManufacturingPart.status == _status_from_value(status))
    if manufacturing_type:
        statement = statement.where(
            models.ManufacturingPart.manufacturing_type == _type_from_value(manufacturing_type)
        )
    if priority:
        statement = statement.where(models.ManufacturingPart.priority == _priority_from_value(priority))
    if search:
        like = f"%{search.lower()}%"
        statement = statement.where(
            or_(
                func.lower(models.ManufacturingPart.part_name).like(like),
                func.lower(models.ManufacturingPart.subsystem).like(like),
                func.lower(models.ManufacturingPart.material).like(like),
            )
        )
    parts = session.exec(statement).all()
    parts.sort(
        key=lambda part: (
            STATUS_ORDER[part.status],
            PRIORITY_WEIGHT.get(part.priority, 1),
            part.lane_position,
            part.created_at,
        )
    )
    return _serialize_parts(parts, session, current)


@router.post("/parts", response_model=schemas.ManufacturingPartRead)
def create_part(
    payload: schemas.ManufacturingPartCreate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    _ensure_positive_quantity(payload.quantity)
    manufacturing_type = _type_from_value(payload.manufacturing_type)
    priority = _priority_from_value(payload.priority)
    part_name = _require_text(payload.part_name, "Part name")
    subsystem = _require_text(payload.subsystem, "Subsystem")
    material = _require_text(payload.material, "Material")
    cad_link = _require_text(payload.cad_link, "CAD link")
    if _is_lead(current):
        assigned_student_ids = _dedupe_ids(payload.assigned_student_ids)
        assigned_lead_ids = _dedupe_ids(payload.assigned_lead_ids)
        _validate_assignment_targets(session, assigned_student_ids, {models.Role.student})
        _validate_assignment_targets(session, assigned_lead_ids, {models.Role.lead, models.Role.admin})
        if current.id not in assigned_lead_ids:
            assigned_lead_ids.append(current.id)
    else:
        assigned_student_ids = [current.id]
        assigned_lead_ids = [] if current.role == models.Role.student else [current.id]
    lane_position = _next_lane_position(session, models.ManufacturingStatus.design_submitted)
    part = models.ManufacturingPart(
        part_name=part_name,
        subsystem=subsystem,
        material=material,
        quantity=payload.quantity,
        manufacturing_type=manufacturing_type,
        cad_link=cad_link,
        priority=priority,
        notes=payload.notes,
        material_stock=payload.material_stock,
        cam_link=payload.cam_link,
        cam_student=payload.cam_student,
        cnc_operator=payload.cnc_operator,
        printer_assignment=payload.printer_assignment,
        slicer_profile=payload.slicer_profile,
        filament_type=payload.filament_type,
        tool_type=payload.tool_type,
        dimensions=payload.dimensions,
        responsible_student=payload.responsible_student,
        created_by_id=current.id,
        created_by_name=current.full_name,
        assigned_student_ids=assigned_student_ids,
        assigned_lead_ids=assigned_lead_ids,
        lane_position=lane_position,
    )
    _validate_required_fields(part)
    _auto_promote_if_ready(session, part)
    part.updated_at = datetime.utcnow()
    session.add(part)
    session.commit()
    session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.patch("/parts/{part_id}", response_model=schemas.ManufacturingPartRead)
def update_part(
    part_id: int,
    payload: schemas.ManufacturingPartUpdate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    if not _can_touch(part, current) and not _is_lead(current):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    _ensure_positive_quantity(payload.quantity)
    if payload.part_name is not None:
        part.part_name = _require_text(payload.part_name, "Part name")
    if payload.subsystem is not None:
        part.subsystem = _require_text(payload.subsystem, "Subsystem")
    if payload.material is not None:
        part.material = _require_text(payload.material, "Material")
    if payload.quantity is not None:
        part.quantity = payload.quantity
    if payload.cad_link is not None:
        part.cad_link = _require_text(payload.cad_link, "CAD link")
    if payload.notes is not None:
        part.notes = payload.notes
    if payload.material_stock is not None:
        part.material_stock = payload.material_stock
    if payload.cam_link is not None:
        part.cam_link = payload.cam_link
    if payload.cam_student is not None:
        part.cam_student = payload.cam_student
    if payload.cnc_operator is not None:
        part.cnc_operator = payload.cnc_operator
    if payload.printer_assignment is not None:
        part.printer_assignment = payload.printer_assignment
    if payload.slicer_profile is not None:
        part.slicer_profile = payload.slicer_profile
    if payload.filament_type is not None:
        part.filament_type = payload.filament_type
    if payload.tool_type is not None:
        part.tool_type = payload.tool_type
    if payload.dimensions is not None:
        part.dimensions = payload.dimensions
    if payload.responsible_student is not None:
        part.responsible_student = payload.responsible_student
    if payload.priority and _is_lead(current):
        part.priority = _priority_from_value(payload.priority)
    if payload.manufacturing_type and _is_lead(current):
        part.manufacturing_type = _type_from_value(payload.manufacturing_type)
    if payload.status_locked is not None:
        if not _is_lead(current):
            raise HTTPException(status_code=403, detail="Only leads can lock workflow state")
        part.status_locked = payload.status_locked
        if not payload.status_locked:
            part.lock_reason = None
    if payload.lock_reason is not None:
        if not _is_lead(current):
            raise HTTPException(status_code=403, detail="Only leads can set lock reason")
        part.lock_reason = payload.lock_reason
        part.status_locked = True
    if payload.assigned_student_ids is not None:
        if not _is_lead(current):
            raise HTTPException(status_code=403, detail="Only leads can assign students")
        student_ids = _dedupe_ids(payload.assigned_student_ids)
        _validate_assignment_targets(session, student_ids, {models.Role.student})
        part.assigned_student_ids = student_ids
    if payload.assigned_lead_ids is not None:
        if not _is_lead(current):
            raise HTTPException(status_code=403, detail="Only leads can assign leads")
        lead_ids = _dedupe_ids(payload.assigned_lead_ids)
        _validate_assignment_targets(session, lead_ids, {models.Role.lead, models.Role.admin})
        part.assigned_lead_ids = lead_ids
    _validate_required_fields(part)
    _auto_promote_if_ready(session, part)
    part.updated_at = datetime.utcnow()
    session.add(part)
    session.commit()
    session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.post("/parts/{part_id}/status", response_model=schemas.ManufacturingPartRead)
def change_status(
    part_id: int,
    payload: schemas.ManufacturingStatusUpdate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    target = _status_from_value(payload.status)
    if part.status == target:
        return _serialize_parts([part], session, current)[0]
    if part.status_locked and not _is_lead(current):
        raise HTTPException(status_code=403, detail="This part is locked by a lead")
    if not _can_touch(part, current):
        raise HTTPException(status_code=403, detail="Insufficient permissions to move this part")
    if not _is_lead(current):
        allowed = STUDENT_TRANSITIONS.get(part.status, set())
        if target not in allowed:
            raise HTTPException(status_code=403, detail="Students can only move to adjacent stages")
    _update_status(session, part, target)
    if target == models.ManufacturingStatus.ready_for_manufacturing and _is_lead(current):
        part.approved_by_id = current.id
        part.approved_at = datetime.utcnow()
    if target == models.ManufacturingStatus.in_progress and part.actual_start is None:
        part.actual_start = datetime.utcnow()
    if target == models.ManufacturingStatus.completed:
        part.actual_complete = datetime.utcnow()
    part.updated_at = datetime.utcnow()
    session.add(part)
    session.commit()
    session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.post("/parts/{part_id}/claim", response_model=schemas.ManufacturingPartRead)
def claim_part(
    part_id: int,
    payload: schemas.ManufacturingClaimInput | None = None,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    assignments = part.assigned_student_ids or []
    if current.id not in assignments:
        assignments.append(current.id)
        part.assigned_student_ids = assignments
    _apply_eta(part, payload, current)
    part.updated_at = datetime.utcnow()
    session.add(part)
    session.commit()
    session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.post("/parts/{part_id}/unclaim", response_model=schemas.ManufacturingPartRead)
def unclaim_part(
    part_id: int,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    assignments = part.assigned_student_ids or []
    if current.id in assignments:
        part.assigned_student_ids = [uid for uid in assignments if uid != current.id]
        if part.eta_by_id == current.id:
            part.student_eta_minutes = None
            part.eta_note = None
            part.eta_updated_at = None
            part.eta_by_id = None
        part.updated_at = datetime.utcnow()
        session.add(part)
        session.commit()
        session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.post("/parts/{part_id}/eta", response_model=schemas.ManufacturingPartRead)
def update_eta(
    part_id: int,
    payload: schemas.ManufacturingEtaUpdate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    assignments = part.assigned_student_ids or []
    if not _is_lead(current) and current.id not in assignments:
        raise HTTPException(status_code=403, detail="Only assignees or leads can set ETA")
    _apply_eta(part, payload, current)
    part.updated_at = datetime.utcnow()
    session.add(part)
    session.commit()
    session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.post("/parts/{part_id}/files", response_model=schemas.ManufacturingPartRead)
async def upload_part_files(
    part_id: int,
    cad_file: UploadFile | None = File(None),
    cam_file: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    if not _can_touch(part, current) and not _is_lead(current):
        raise HTTPException(status_code=403, detail="Insufficient permissions to upload files")
    if not cad_file and not cam_file:
        raise HTTPException(status_code=422, detail="Upload at least one file")
    await _save_part_files(part, cad_file, cam_file)
    part.updated_at = datetime.utcnow()
    session.add(part)
    session.commit()
    session.refresh(part)
    return _serialize_parts([part], session, current)[0]


@router.delete("/parts/{part_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_part(
    part_id: int,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    part = session.get(models.ManufacturingPart, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    if not (_is_lead(current) or part.created_by_id == current.id):
        raise HTTPException(status_code=403, detail="Insufficient permissions to delete this part")
    session.delete(part)
    session.commit()
    _remove_part_files(part_id)
    return


@router.get("/summary", response_model=schemas.ManufacturingSummary)
def manufacturing_summary(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    counts = {status.value: 0 for status in models.ManufacturingStatus}
    urgent = 0
    total = 0
    rows = session.exec(
        select(models.ManufacturingPart.status, models.ManufacturingPart.priority)
    ).all()
    for status_value, priority_value in rows:
        status_enum = (
            status_value
            if isinstance(status_value, models.ManufacturingStatus)
            else models.ManufacturingStatus(status_value)
        )
        priority_enum = (
            priority_value
            if isinstance(priority_value, models.ManufacturingPriority)
            else models.ManufacturingPriority(priority_value)
        )
        counts[status_enum.value] += 1
        if priority_enum == models.ManufacturingPriority.urgent:
            urgent += 1
        total += 1
    return schemas.ManufacturingSummary(total=total, urgent=urgent, by_status=counts)


@router.get("/lookups", response_model=schemas.ManufacturingLookupResponse)
def manufacturing_lookups(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    users = session.exec(select(models.User).order_by(models.User.full_name)).all()
    payload = [
        schemas.ManufacturingLookupUser(id=user.id, name=user.full_name, role=user.role.value)
        for user in users
    ]
    return schemas.ManufacturingLookupResponse(users=payload)
async def _save_part_files(
    part: models.ManufacturingPart,
    cad_file: UploadFile | None,
    cam_file: UploadFile | None,
) -> None:
    folder = _manufacturing_upload_dir(part.id)
    if cad_file:
        dest = folder / f"cad_{cad_file.filename}"
        data = await cad_file.read()
        dest.write_bytes(data)
        part.cad_file_name = cad_file.filename
        part.cad_file_path = str(dest.resolve())
    if cam_file:
        dest = folder / f"cam_{cam_file.filename}"
        data = await cam_file.read()
        dest.write_bytes(data)
        part.cam_file_name = cam_file.filename
        part.cam_file_path = str(dest.resolve())
