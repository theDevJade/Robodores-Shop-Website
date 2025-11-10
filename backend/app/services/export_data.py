from __future__ import annotations
from typing import List, Tuple
from sqlmodel import Session, select
from .. import models

TITLE_MAP = {
    models.SheetSection.attendance: "Attendance",
    models.SheetSection.manufacturing: "Manufacturing",
    models.SheetSection.cnc: "CNC",
    models.SheetSection.printing: "Printing",
    models.SheetSection.orders: "Orders",
    models.SheetSection.inventory: "Inventory",
    models.SheetSection.tickets_feature: "Feature Requests",
    models.SheetSection.tickets_issue: "Issues",
}


def get_section_dataset(section: models.SheetSection, session: Session) -> Tuple[str, List[str], List[List[str]]]:
    title = TITLE_MAP[section]

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
    elif section == models.SheetSection.manufacturing:
        parts = session.exec(
            select(models.ManufacturingPart).order_by(models.ManufacturingPart.created_at.desc())
        ).all()
        user_ids: set[int] = set()
        for part in parts:
            user_ids.add(part.created_by_id)
            if part.approved_by_id:
                user_ids.add(part.approved_by_id)
            for sid in part.assigned_student_ids or []:
                user_ids.add(sid)
            for lid in part.assigned_lead_ids or []:
                user_ids.add(lid)
        user_map: dict[int, str] = {}
        if user_ids:
            assignments = session.exec(
                select(models.User).where(models.User.id.in_(user_ids))
            ).all()
            user_map = {user.id: user.full_name for user in assignments}
        headers = [
            "ID",
            "Part",
            "Subsystem",
            "Material",
            "Quantity",
            "Type",
            "Priority",
            "Status",
            "AssignedStudents",
            "AssignedLeads",
            "CADLink",
            "CAMLink",
            "CAMStudent",
            "CNCOoperator",
            "MaterialStock",
            "PrinterAssignment",
            "SlicerProfile",
            "FilamentType",
            "ToolType",
            "Dimensions",
            "ResponsibleStudent",
            "Notes",
            "CreatedBy",
            "ApprovedBy",
            "CreatedAt",
            "UpdatedAt",
            "EtaMinutes",
            "EtaTarget",
            "CadFileName",
            "CamFileName",
        ]
        rows = []
        for part in parts:
            student_names = [
                user_map.get(student_id, str(student_id)) for student_id in (part.assigned_student_ids or [])
            ]
            lead_names = [
                user_map.get(lead_id, str(lead_id)) for lead_id in (part.assigned_lead_ids or [])
            ]
            rows.append(
                [
                    str(part.id),
                    part.part_name,
                    part.subsystem,
                    part.material,
                    str(part.quantity),
                    part.manufacturing_type.value,
                    part.priority.value,
                    part.status.value,
                    "; ".join(student_names),
                    "; ".join(lead_names),
                    part.cad_link,
                    part.cam_link or "",
                    part.cam_student or "",
                    part.cnc_operator or "",
                    part.material_stock or "",
                    part.printer_assignment or "",
                    part.slicer_profile or "",
                    part.filament_type or "",
                    part.tool_type or "",
                    part.dimensions or "",
                    part.responsible_student or "",
                    part.notes or "",
                    user_map.get(part.created_by_id, part.created_by_name),
                    user_map.get(part.approved_by_id, "") if part.approved_by_id else "",
                    part.created_at.isoformat(),
                    part.updated_at.isoformat(),
                    "" if part.student_eta_minutes is None else str(part.student_eta_minutes),
                    part.eta_target.isoformat() if part.eta_target else "",
                    part.cad_file_name or "",
                    part.cam_file_name or "",
                ]
            )
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
                j.claimed_by_name or "",
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
    else:
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

    return title, headers, rows
