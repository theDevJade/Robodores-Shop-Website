from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlmodel import Session, select
from .. import models, schemas
from ..core.database import get_session
from ..core import deps

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/items", response_model=list[schemas.InventoryItemRead])
def list_items(
    session: Session = Depends(get_session),
    q: str | None = Query(default=None, description="Search by name, sku, location, tags"),
    location: str | None = None,
    _: models.User = Depends(deps.get_current_user),
):
    statement = select(models.InventoryItem)
    if q:
        like = f"%{q}%"
        statement = statement.where(
            or_(
                models.InventoryItem.part_name.ilike(like),
                models.InventoryItem.sku.ilike(like),
                models.InventoryItem.location.ilike(like),
                models.InventoryItem.tags.ilike(like),
            )
        )
    if location:
        statement = statement.where(models.InventoryItem.location == location)
    items = session.exec(statement.order_by(models.InventoryItem.part_name)).all()
    return [
        schemas.InventoryItemRead(
            id=item.id,
            part_name=item.part_name,
            sku=item.sku,
            location=item.location,
            quantity=item.quantity,
            unit_cost=item.unit_cost,
            reorder_threshold=item.reorder_threshold,
            tags=item.tags,
            vendor_link=item.vendor_link,
            updated_at=item.updated_at,
        )
        for item in items
    ]


@router.post("/items", response_model=schemas.InventoryItemRead)
def create_item(
    payload: schemas.InventoryItemCreate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    item = models.InventoryItem(**payload.dict())
    session.add(item)
    session.commit()
    session.refresh(item)
    return schemas.InventoryItemRead(
        id=item.id,
        part_name=item.part_name,
        sku=item.sku,
        location=item.location,
        quantity=item.quantity,
        unit_cost=item.unit_cost,
        reorder_threshold=item.reorder_threshold,
        tags=item.tags,
        vendor_link=item.vendor_link,
        updated_at=item.updated_at,
    )


@router.patch("/items/{item_id}", response_model=schemas.InventoryItemRead)
def update_item(
    item_id: int,
    payload: schemas.InventoryItemUpdate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    item = session.get(models.InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(item, field, value)
    item.updated_at = datetime.utcnow()
    session.add(item)
    session.commit()
    session.refresh(item)
    return schemas.InventoryItemRead(
        id=item.id,
        part_name=item.part_name,
        sku=item.sku,
        location=item.location,
        quantity=item.quantity,
        unit_cost=item.unit_cost,
        reorder_threshold=item.reorder_threshold,
        tags=item.tags,
        vendor_link=item.vendor_link,
        updated_at=item.updated_at,
    )


@router.post("/items/{item_id}/adjust", response_model=schemas.InventoryItemRead)
def adjust_item(
    item_id: int,
    payload: schemas.InventoryAdjust,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    item = session.get(models.InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.quantity += payload.delta
    item.updated_at = datetime.utcnow()
    transaction = models.InventoryTransaction(
        item_id=item.id,
        delta=payload.delta,
        reason=models.InventoryReason(payload.reason),
        note=payload.note,
        performed_by=current.id,
    )
    session.add(item)
    session.add(transaction)
    session.commit()
    session.refresh(item)
    return schemas.InventoryItemRead(
        id=item.id,
        part_name=item.part_name,
        sku=item.sku,
        location=item.location,
        quantity=item.quantity,
        unit_cost=item.unit_cost,
        reorder_threshold=item.reorder_threshold,
        tags=item.tags,
        vendor_link=item.vendor_link,
        updated_at=item.updated_at,
    )


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    item = session.get(models.InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    session.delete(item)
    session.commit()
    return {"status": "deleted"}
