from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Query, Form
from sqlalchemy import func
from sqlmodel import Session, select
from .. import models, schemas
from ..core.database import get_session
from ..core.config import get_settings
from ..core import deps

router = APIRouter(prefix="/jobs", tags=["jobs"])
settings = get_settings()


def _file_url_from_path(p: str) -> str | None:
    try:
        rel = Path(p).resolve().relative_to(settings.upload_root.resolve())
        return f"/uploads/{rel.as_posix()}"
    except Exception:
        return None


@router.post("/")
async def submit_job(
    shop: str = Form(...),
    part_name: str = Form(...),
    owner_name: str = Form(...),
    notes: str | None = Form(None),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    try:
        shop_enum = models.ShopType(shop)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid shop type")
    folder = settings.upload_root / shop_enum.value
    folder.mkdir(parents=True, exist_ok=True)
    sanitized = part_name.replace(" ", "_")
    dest = folder / f"{sanitized}_{file.filename}"
    content = await file.read()
    dest.write_bytes(content)

    max_pos = session.exec(
        select(func.max(models.ShopJob.queue_position)).where(models.ShopJob.shop == shop_enum)
    ).first()
    next_position = (max_pos or 0) + 1

    job = models.ShopJob(
        shop=shop_enum,
        part_name=part_name,
        owner_name=owner_name,
        submitter_id=current.id,
        notes=notes,
        file_name=file.filename,
        file_path=str(dest.resolve()),
        queue_position=next_position,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return _job_to_dict(job, session)


@router.get("/")
def list_jobs(
    shop: str | None = Query(default=None),
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    statement = select(models.ShopJob).order_by(models.ShopJob.queue_position.asc(), models.ShopJob.created_at.asc())
    if shop:
        statement = statement.where(models.ShopJob.shop == models.ShopType(shop))
    jobs = session.exec(statement).all()
    return [_job_to_dict(job, session) for job in jobs]


@router.patch("/{job_id}")
def update_job_status(
    job_id: int,
    payload: dict,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    job = session.get(models.ShopJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current.role not in (models.Role.lead, models.Role.admin):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    try:
        job.status = models.JobStatus(payload.get("status"))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid status")
    note = payload.get("note")
    if note:
        job.notes = (job.notes or "") + f"\n{note}"
    session.add(job)
    session.commit()
    session.refresh(job)
    return _job_to_dict(job, session)


@router.delete("/{job_id}")
def delete_job(
    job_id: int,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    job = session.get(models.ShopJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current.role not in (models.Role.lead, models.Role.admin) and job.submitter_id != current.id:
        raise HTTPException(status_code=403, detail="Not allowed to remove this job")
    session.delete(job)
    session.commit()
    return {"status": "deleted"}


@router.post("/reorder")
def reorder_jobs(
    payload: schemas.JobReorder,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    try:
        shop_enum = models.ShopType(payload.shop)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid shop type") from exc
    ids = payload.ordered_ids
    if not ids:
        raise HTTPException(status_code=422, detail="ordered_ids cannot be empty")
    jobs = session.exec(select(models.ShopJob).where(models.ShopJob.id.in_(ids))).all()
    if len(jobs) != len(ids):
        raise HTTPException(status_code=404, detail="One or more jobs not found")
    for job in jobs:
        if job.shop != shop_enum:
            raise HTTPException(status_code=422, detail="All jobs must belong to the same shop")
        if job.claimed_by_id:
            raise HTTPException(status_code=422, detail="Cannot reorder claimed jobs")
    position = 1
    job_map = {job.id: job for job in jobs}
    for job_id in ids:
        job = job_map.get(job_id)
        if not job:
            continue
        job.queue_position = position
        session.add(job)
        position += 1
    session.commit()
    refreshed = session.exec(
        select(models.ShopJob)
        .where(models.ShopJob.shop == shop_enum)
        .order_by(models.ShopJob.queue_position.asc(), models.ShopJob.created_at.asc())
    ).all()
    return [_job_to_dict(job, session) for job in refreshed]


@router.post("/{job_id}/claim", response_model=schemas.ShopJobRead)
def claim_job(
    job_id: int,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    job = session.get(models.ShopJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.claimed_by_id:
        raise HTTPException(status_code=409, detail="Job already claimed")
    job.claimed_by_id = current.id
    job.claimed_at = datetime.utcnow()
    session.add(job)
    session.commit()
    session.refresh(job)
    return _job_to_dict(job, session)


@router.post("/{job_id}/unclaim", response_model=schemas.ShopJobRead)
def unclaim_job(
    job_id: int,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    job = session.get(models.ShopJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.claimed_by_id:
        raise HTTPException(status_code=409, detail="Job is not claimed")
    if current.role not in (models.Role.lead, models.Role.admin) and job.claimed_by_id != current.id:
        raise HTTPException(status_code=403, detail="Not allowed to unclaim this job")
    job.claimed_by_id = None
    job.claimed_at = None
    session.add(job)
    session.commit()
    session.refresh(job)
    return _job_to_dict(job, session)


def _job_to_dict(job: models.ShopJob, session: Session) -> dict:
    claimed_name = None
    if job.claimed_by_id:
        user = session.get(models.User, job.claimed_by_id)
        claimed_name = user.full_name if user else None
    return {
        "id": job.id,
        "shop": job.shop.value,
        "part_name": job.part_name,
        "owner_name": job.owner_name,
        "status": job.status.value,
        "notes": job.notes,
        "file_name": job.file_name,
        "created_at": job.created_at,
        "file_url": _file_url_from_path(job.file_path),
        "queue_position": job.queue_position,
        "claimed_by_id": job.claimed_by_id,
        "claimed_by_name": claimed_name,
        "claimed_at": job.claimed_at,
    }

