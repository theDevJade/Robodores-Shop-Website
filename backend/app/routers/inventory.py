import csv
import io
from datetime import datetime
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlmodel import Session, select
from .. import models, schemas
from ..core.database import get_session
from ..core import deps

router = APIRouter(prefix="/inventory", tags=["inventory"])

def _serialize_item(item: models.InventoryItem) -> schemas.InventoryItemRead:
    return schemas.InventoryItemRead(
        id=item.id,
        part_name=item.part_name,
        sku=item.sku,
        part_type=item.part_type.value if isinstance(item.part_type, models.InventoryPartType) else item.part_type,
        location=item.location,
        quantity=item.quantity,
        unit_cost=item.unit_cost,
        reorder_threshold=item.reorder_threshold,
        tags=item.tags,
        vendor_name=item.vendor_name,
        vendor_link=item.vendor_link,
        updated_at=item.updated_at,
    )

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
                 models.InventoryItem.vendor_name.ilike(like),
                models.InventoryItem.location.ilike(like),
                models.InventoryItem.tags.ilike(like),
            )
        )
    if location:
        statement = statement.where(models.InventoryItem.location == location)
    items = session.exec(statement.order_by(models.InventoryItem.part_name)).all()
    return [_serialize_item(item) for item in items]


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
    return _serialize_item(item)


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
    return _serialize_item(item)


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
    return _serialize_item(item)


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


@router.post("/items/import")
async def import_items(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    raw_bytes = await file.read()
    try:
        decoded = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be utf-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(decoded))
    required_columns = {"part_name", "part_type", "sku", "location", "quantity", "unit_cost", "reorder_threshold"}
    missing = required_columns.difference(reader.fieldnames or [])
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(sorted(missing))}")

    items_to_create: list[models.InventoryItem] = []
    for row_index, row in enumerate(reader, start=2):
        def cleaned(field: str) -> str:
            return (row.get(field) or "").strip()

        part_name = cleaned("part_name")
        part_type_raw = cleaned("part_type").lower()
        sku = cleaned("sku")
        location = cleaned("location")
        vendor_name = cleaned("vendor_name")

        if not part_name:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: part_name is required")
        if not part_type_raw:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: part_type is required")
        try:
            part_type = models.InventoryPartType(part_type_raw)
        except ValueError:
            valid = ", ".join([ptype.value for ptype in models.InventoryPartType])
            raise HTTPException(status_code=400, detail=f"Row {row_index}: invalid part_type '{part_type_raw}'. Expected: {valid}")
        if not sku:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: sku is required")
        if not location:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: location is required")
        if part_type == models.InventoryPartType.cots and not vendor_name:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: vendor_name required for COTS items")

        tags = cleaned("tags") or None
        vendor_link = cleaned("vendor_link") or None

        try:
            quantity = int(cleaned("quantity"))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: quantity must be an integer")

        unit_cost_raw = cleaned("unit_cost")
        try:
            unit_cost = float(unit_cost_raw) if unit_cost_raw else None
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: unit_cost must be a number")

        reorder_raw = cleaned("reorder_threshold")
        try:
            reorder_threshold = int(reorder_raw) if reorder_raw else None
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Row {row_index}: reorder_threshold must be an integer")

        item = models.InventoryItem(
            part_name=part_name,
            part_type=part_type,
            sku=sku,
            location=location,
            quantity=quantity,
            unit_cost=unit_cost,
            reorder_threshold=reorder_threshold,
            tags=tags,
            vendor_name=vendor_name or None,
            vendor_link=vendor_link,
        )
        items_to_create.append(item)

    if not items_to_create:
        raise HTTPException(status_code=400, detail="No rows parsed from CSV")

    session.add_all(items_to_create)
    session.commit()
    return {"inserted": len(items_to_create)}
