from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from .. import models, schemas
from ..core.database import get_session
from ..core import deps

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.post("/", response_model=schemas.TicketRead)
def create_ticket(
    payload: schemas.TicketCreate,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(deps.get_current_user),
):
    try:
        ticket_type = models.TicketType(payload.type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid ticket type") from exc
    try:
        priority = models.TicketPriority(payload.priority)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid priority") from exc
    subject = payload.subject.strip()
    existing = session.exec(
        select(models.Ticket)
        .where(models.Ticket.type == ticket_type)
        .where(models.Ticket.subject == subject)
        .where(models.Ticket.status != models.TicketStatus.resolved)
        .where(models.Ticket.requester_id == current_user.id)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="You already have an open ticket for this subject")
    ticket = models.Ticket(
        type=ticket_type,
        priority=priority,
        subject=subject,
        details=payload.details,
        requester_id=current_user.id,
        requester_name=current_user.full_name,
    )
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return _to_read(ticket)


@router.get("/", response_model=list[schemas.TicketRead])
def list_tickets(
    type: str | None = None,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    statement = select(models.Ticket).order_by(models.Ticket.created_at.desc())
    if type:
        try:
            ticket_type = models.TicketType(type)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid ticket type") from exc
        statement = statement.where(models.Ticket.type == ticket_type)
    tickets = session.exec(statement).all()
    return [_to_read(t) for t in tickets]


@router.patch("/{ticket_id}", response_model=schemas.TicketRead)
def update_ticket_status(
    ticket_id: int,
    payload: schemas.TicketUpdate,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    ticket = session.get(models.Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    try:
        ticket.status = models.TicketStatus(payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid status") from exc
    ticket.updated_at = datetime.utcnow()
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return _to_read(ticket)


@router.delete("/{ticket_id}")
def delete_ticket(
    ticket_id: int,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    ticket = session.get(models.Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    session.delete(ticket)
    session.commit()
    return {"status": "deleted"}


def _to_read(ticket: models.Ticket) -> schemas.TicketRead:
    return schemas.TicketRead(
        id=ticket.id,
        type=ticket.type.value,
        subject=ticket.subject,
        details=ticket.details,
        priority=ticket.priority.value,
        status=ticket.status.value,
        requester_name=ticket.requester_name,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )
