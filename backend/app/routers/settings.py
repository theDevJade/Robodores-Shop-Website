from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from ..core.database import get_session
from ..core import deps
from .. import models
from ..models_config import AppConfig
from ..services.sheets import get_sheets_service, parse_spreadsheet_id, put_worksheet
from ..core.config import get_settings
import json
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError

router = APIRouter(prefix="/settings", tags=["settings"])

def _ensure_app_config(session: Session) -> AppConfig:
    config = session.get(AppConfig, 1)
    if not config:
        config = AppConfig(id=1, restrict_attendance_to_schedule=True)
        session.add(config)
        session.commit()
    return config


@router.get("/app")
def read_settings(session: Session = Depends(get_session)):
    config = _ensure_app_config(session)
    return {"restrict_attendance_to_schedule": config.restrict_attendance_to_schedule}

@router.post("/app")
def update_settings(
    payload: dict,
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.require_roles(models.Role.admin.value)),
):
    config = _ensure_app_config(session)
    value = payload.get("restrict_attendance_to_schedule")
    if value is None:
        raise HTTPException(status_code=422, detail="Missing restrict_attendance_to_schedule")
    config.restrict_attendance_to_schedule = bool(value)
    session.add(config)
    session.commit()
    return {"restrict_attendance_to_schedule": config.restrict_attendance_to_schedule}


def _blank_sheet_payload():
    return {section.value: None for section in models.SheetSection}


@router.get("/sheets")
def list_sheet_links(
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    payload = _blank_sheet_payload()
    rows = session.exec(select(models.SheetLink)).all()
    for row in rows:
        payload[row.section.value] = row.url
    return payload


@router.put("/sheets/{section}")
def upsert_sheet_link(
    section: models.SheetSection,
    payload: dict,
    session: Session = Depends(get_session),
    user: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    raw_url = payload.get("url")
    url = raw_url.strip() if isinstance(raw_url, str) else None
    if url and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="URL must start with http:// or https://")
    statement = select(models.SheetLink).where(models.SheetLink.section == section)
    link = session.exec(statement).first()
    if not url:
        if link:
            session.delete(link)
            session.commit()
        return {"section": section.value, "url": None}
    if not link:
        link = models.SheetLink(section=section, url=url, updated_by_id=user.id)
    else:
        link.url = url
        link.updated_by_id = user.id
        link.updated_at = datetime.utcnow()
    session.add(link)
    session.commit()
    session.refresh(link)
    return {"section": section.value, "url": link.url}


@router.post("/sheets/{section}/sync")
def sync_section_to_sheet(
    section: models.SheetSection,
    session: Session = Depends(get_session),
    user: models.User = Depends(deps.require_roles(models.Role.lead.value, models.Role.admin.value)),
):
    link = session.exec(select(models.SheetLink).where(models.SheetLink.section == section)).first()
    if not link or not link.url:
        raise HTTPException(status_code=404, detail="No sheet URL attached for this section")

    title_map = {
        models.SheetSection.attendance: "Attendance",
        models.SheetSection.cnc: "CNC",
        models.SheetSection.printing: "Printing",
        models.SheetSection.orders: "Orders",
        models.SheetSection.inventory: "Inventory",
        models.SheetSection.tickets_feature: "Feature Requests",
        models.SheetSection.tickets_issue: "Issues",
    }
    title = title_map[section]

    # Build rows per section
    headers: list[str]
    rows: list[list[str]]

    if section == models.SheetSection.attendance:
        entries = session.exec(select(models.AttendanceEntry).order_by(models.AttendanceEntry.check_in)).all()
        headers = ["ID", "StudentID", "Barcode", "CheckIn", "CheckOut", "Status", "Note"]
        rows = [
            [
                str(e.id),
                e.recorded_student_id or "",
                e.recorded_barcode_id or "",
                e.check_in.isoformat() if e.check_in else "",
                e.check_out.isoformat() if e.check_out else "",
                e.status.value,
                e.note or "",
            ]
            for e in entries
        ]
    elif section in (models.SheetSection.cnc, models.SheetSection.printing):
        shop = models.ShopType.cnc if section == models.SheetSection.cnc else models.ShopType.printing
        jobs = session.exec(select(models.ShopJob).where(models.ShopJob.shop == shop).order_by(models.ShopJob.queue_position)).all()
        headers = ["ID", "Part", "Owner", "Status", "QueuePos", "ClaimedBy", "CreatedAt", "Notes", "FileName"]
        rows = [
            [
                str(j.id),
                j.part_name,
                j.owner_name,
                j.status.value,
                str(j.queue_position),
                str(j.claimed_by_id or ""),
                j.created_at.isoformat(),
                j.notes or "",
                j.file_name,
            ]
            for j in jobs
        ]
    elif section == models.SheetSection.orders:
        orders = session.exec(select(models.OrderRequest).order_by(models.OrderRequest.created_at.desc())).all()
        headers = ["ID", "Requester", "Part", "PriceUSD", "Status", "VendorLink", "CreatedAt", "Justification"]
        rows = [
            [
                str(o.id),
                o.requester_name,
                o.part_name,
                f"{o.price_usd:.2f}",
                o.status.value,
                o.vendor_link,
                o.created_at.isoformat(),
                o.justification or "",
            ]
            for o in orders
        ]
    elif section == models.SheetSection.inventory:
        items = session.exec(select(models.InventoryItem).order_by(models.InventoryItem.part_name)).all()
        headers = ["ID", "Part", "SKU", "Location", "Qty", "UnitCost", "ReorderAt", "Tags", "VendorLink", "UpdatedAt"]
        rows = [
            [
                str(it.id),
                it.part_name,
                it.sku or "",
                it.location or "",
                str(it.quantity),
                "" if it.unit_cost is None else f"{it.unit_cost:.2f}",
                "" if it.reorder_threshold is None else str(it.reorder_threshold),
                it.tags or "",
                it.vendor_link or "",
                it.updated_at.isoformat(),
            ]
            for it in items
        ]
    elif section in (models.SheetSection.tickets_feature, models.SheetSection.tickets_issue):
        type_val = models.TicketType.feature if section == models.SheetSection.tickets_feature else models.TicketType.issue
        tickets = session.exec(select(models.Ticket).where(models.Ticket.type == type_val).order_by(models.Ticket.created_at.desc())).all()
        headers = ["ID", "Type", "Subject", "Priority", "Status", "Requester", "CreatedAt", "UpdatedAt", "Details"]
        rows = [
            [
                str(t.id),
                t.type.value,
                t.subject,
                t.priority.value,
                t.status.value,
                t.requester_name,
                t.created_at.isoformat(),
                t.updated_at.isoformat(),
                t.details,
            ]
            for t in tickets
        ]
    else:
        raise HTTPException(status_code=400, detail="Unsupported section")

    # If the link is an Apps Script Web App, POST JSON to it
    if "script.google.com/macros" in (link.url or ""):
        payload = {
            "sheet": title,
            "headers": headers,
            "rows": rows,
        }
        try:
            req = urlrequest.Request(
                link.url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlrequest.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
        except HTTPError as e:
            try:
                err_body = e.read().decode("utf-8", errors="ignore")
            except Exception:
                err_body = ""
            raise HTTPException(status_code=e.code, detail=f"Apps Script error: {e.reason or ''} {err_body}")
        except URLError as e:
            raise HTTPException(status_code=502, detail=f"Apps Script unreachable: {e.reason}")
        return {"synced": True, "section": section.value, "rows": len(rows), "target": "apps_script"}

    # Otherwise treat as a direct Google Sheet URL (service account mode)
    settings = get_settings()
    if not settings.google_service_account_file:
        raise HTTPException(status_code=500, detail="Service account file not configured on server")
    service = get_sheets_service(str(settings.google_service_account_file))
    spreadsheet_id = parse_spreadsheet_id(link.url)
    put_worksheet(service, spreadsheet_id, title, headers, rows)
    return {"synced": True, "section": section.value, "rows": len(rows), "target": "sheets_api"}
