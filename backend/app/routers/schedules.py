from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from datetime import time
from .. import models, schemas
from ..core.database import get_session
from ..core import deps

router = APIRouter(prefix="/schedules", tags=["schedules"])


@router.get("/", response_model=list[schemas.ScheduleBlockRead])
def list_blocks(session: Session = Depends(get_session)):
    blocks = list(session.exec(select(models.ScheduleBlock).order_by(models.ScheduleBlock.weekday)))
    return [
        schemas.ScheduleBlockRead(
            id=block.id,
            weekday=block.weekday,
            start_time=str(block.start_time),
            end_time=str(block.end_time),
            active=block.active,
        )
        for block in blocks
    ]


@router.post("/", response_model=schemas.ScheduleBlockRead)
def create_block(
    payload: schemas.ScheduleBlockCreate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    try:
        start = payload.start_time if isinstance(payload.start_time, time) else time.fromisoformat(str(payload.start_time))
        end = payload.end_time if isinstance(payload.end_time, time) else time.fromisoformat(str(payload.end_time))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid time format: {e}")
    block = models.ScheduleBlock(weekday=payload.weekday, start_time=start, end_time=end, active=payload.active)
    session.add(block)
    session.commit()
    session.refresh(block)
    return schemas.ScheduleBlockRead(id=block.id, weekday=block.weekday, start_time=str(block.start_time), end_time=str(block.end_time), active=block.active)


@router.delete("/{block_id}")
def delete_block(
    block_id: int,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    block = session.get(models.ScheduleBlock, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    session.delete(block)
    session.commit()
    return {"status": "deleted"}
