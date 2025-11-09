from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from .. import models, schemas
from ..core.database import get_session
from ..core import deps
from ..services.google_sheets import append_order_to_sheet

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("/", response_model=schemas.OrderRead)
def create_order(
    payload: schemas.OrderCreate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    existing = session.exec(
        select(models.OrderRequest)
        .where(models.OrderRequest.requester_name == payload.requester_name)
        .where(models.OrderRequest.part_name == payload.part_name)
        .where(models.OrderRequest.status == models.OrderStatus.pending)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A pending order for this part already exists")
    order = models.OrderRequest(
        requester_id=current.id,
        requester_name=payload.requester_name,
        part_name=payload.part_name,
        vendor_link=str(payload.vendor_link),
        price_usd=payload.price_usd,
        justification=payload.justification,
    )
    session.add(order)
    session.commit()
    session.refresh(order)
    sheet_range = append_order_to_sheet(
        [
            order.created_at.isoformat(),
            order.requester_name,
            order.part_name,
            order.vendor_link,
            order.price_usd,
            order.justification or "",
            order.status.value,
        ]
    )
    if sheet_range:
        order.sheet_row = sheet_range
        session.add(order)
        session.commit()
        session.refresh(order)
    return schemas.OrderRead(
        id=order.id,
        requester_name=order.requester_name,
        part_name=order.part_name,
        vendor_link=order.vendor_link,
        price_usd=order.price_usd,
        justification=order.justification,
        status=order.status.value,
        created_at=order.created_at,
    )


@router.get("/", response_model=list[schemas.OrderRead])
def list_orders(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    orders = session.exec(select(models.OrderRequest).order_by(models.OrderRequest.created_at.desc())).all()
    return [
        schemas.OrderRead(
            id=order.id,
            requester_name=order.requester_name,
            part_name=order.part_name,
            vendor_link=order.vendor_link,
            price_usd=order.price_usd,
            justification=order.justification,
            status=order.status.value,
            created_at=order.created_at,
        )
        for order in orders
    ]


@router.patch("/{order_id}", response_model=schemas.OrderRead)
def update_order(
    order_id: int,
    status_update: schemas.OrderStatusUpdate,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    order = session.get(models.OrderRequest, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if current.role not in (models.Role.lead, models.Role.admin):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    order.status = models.OrderStatus(status_update.status)
    session.add(order)
    session.commit()
    session.refresh(order)
    return schemas.OrderRead(
        id=order.id,
        requester_name=order.requester_name,
        part_name=order.part_name,
        vendor_link=order.vendor_link,
        price_usd=order.price_usd,
        justification=order.justification,
        status=order.status.value,
        created_at=order.created_at,
    )


@router.delete("/{order_id}")
def delete_order(
    order_id: int,
    session: Session = Depends(get_session),
    current: models.User = Depends(deps.get_current_user),
):
    order = session.get(models.OrderRequest, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if current.role not in (models.Role.lead, models.Role.admin) and order.requester_id != current.id:
        raise HTTPException(status_code=403, detail="Not allowed to remove this order")
    session.delete(order)
    session.commit()
    return {"status": "deleted"}
