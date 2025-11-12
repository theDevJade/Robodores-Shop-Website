from __future__ import annotations
from datetime import datetime, time
from enum import Enum
from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

class Role(str, Enum):
    student = "student"
    lead = "lead"
    admin = "admin"

class AttendanceStatus(str, Enum):
    ok = "ok"
    missing_in = "missing_in"
    missing_out = "missing_out"
    blocked = "blocked"
    unverified = "unverified"

class JobStatus(str, Enum):
    submitted = "submitted"
    in_review = "in_review"
    approved = "approved"
    rejected = "rejected"
    completed = "completed"

class ShopType(str, Enum):
    cnc = "cnc"
    printing = "printing"

class ManufacturingType(str, Enum):
    cnc = "cnc"
    printing = "printing"
    manual = "manual"

class ManufacturingStatus(str, Enum):
    design_submitted = "design_submitted"
    ready_for_manufacturing = "ready_for_manufacturing"
    in_progress = "in_progress"
    quality_check = "quality_check"
    completed = "completed"

class ManufacturingPriority(str, Enum):
    low = "low"
    normal = "normal"
    urgent = "urgent"

class OrderStatus(str, Enum):
    pending = "pending"
    ordered = "ordered"
    received = "received"
    cancelled = "cancelled"

class InventoryReason(str, Enum):
    manual = "manual"
    job = "job"
    correction = "correction"

class InventoryPartType(str, Enum):
    custom = "custom"
    cots = "cots"

class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    full_name: str
    role: Role = Field(default=Role.student, index=True)
    hashed_password: str
    barcode_id: str | None = Field(default=None, unique=True, index=True)
    student_id: str | None = Field(default=None, unique=True, index=True)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class PendingUser(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    full_name: str
    password_hash: str
    requested_role: Role = Field(default=Role.student)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ScheduleBlock(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    weekday: int = Field(index=True)
    start_time: time
    end_time: time
    active: bool = Field(default=True)

class AttendanceEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="user.id")
    recorded_student_id: str | None = Field(default=None, index=True)
    recorded_barcode_id: str | None = Field(default=None, index=True)
    check_in: datetime | None = Field(default=None, index=True)
    check_out: datetime | None = None
    status: AttendanceStatus = Field(default=AttendanceStatus.ok)
    note: str | None = None

class ShopJob(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    shop: ShopType = Field(index=True)
    part_name: str = Field(index=True)
    owner_name: str
    submitter_id: int | None = Field(default=None, foreign_key="user.id")
    notes: str | None = None
    file_name: str
    file_path: str
    status: JobStatus = Field(default=JobStatus.submitted, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    queue_position: int = Field(default=0, index=True)
    claimed_by_id: int | None = Field(default=None, foreign_key="user.id")
    claimed_at: datetime | None = None

class OrderRequest(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    requester_id: int | None = Field(default=None, foreign_key="user.id")
    requester_name: str
    part_name: str
    vendor_link: str
    price_usd: float
    justification: str | None = None
    status: OrderStatus = Field(default=OrderStatus.pending, index=True)
    sheet_row: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class InventoryItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    part_name: str
    sku: str | None = Field(default=None, index=True)
    part_type: InventoryPartType = Field(default=InventoryPartType.custom, index=True)
    location: str | None = Field(default=None, index=True)
    quantity: int = Field(default=0)
    unit_cost: float | None = None
    reorder_threshold: int | None = None
    tags: str | None = None
    vendor_name: str | None = None
    vendor_link: str | None = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class InventoryTransaction(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    item_id: int = Field(foreign_key="inventoryitem.id")
    delta: int
    reason: InventoryReason = Field(default=InventoryReason.manual)
    note: str | None = None
    performed_by: int | None = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ManufacturingPart(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    part_name: str = Field(index=True)
    subsystem: str = Field(index=True)
    material: str
    quantity: int = Field(default=1)
    manufacturing_type: ManufacturingType = Field(index=True)
    cad_link: str
    cam_link: str | None = None
    cam_student: str | None = None
    cnc_operator: str | None = None
    material_stock: str | None = None
    printer_assignment: str | None = None
    slicer_profile: str | None = None
    filament_type: str | None = None
    tool_type: str | None = None
    dimensions: str | None = None
    responsible_student: str | None = None
    notes: str | None = None
    priority: ManufacturingPriority = Field(default=ManufacturingPriority.normal, index=True)
    status: ManufacturingStatus = Field(default=ManufacturingStatus.design_submitted, index=True)
    created_by_id: int = Field(foreign_key="user.id")
    created_by_name: str
    approved_by_id: int | None = Field(default=None, foreign_key="user.id")
    approved_at: datetime | None = None
    status_locked: bool = Field(default=False, index=True)
    lock_reason: str | None = None
    lane_position: int = Field(default=0, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    last_status_change: datetime = Field(default_factory=datetime.utcnow)
    assigned_student_ids: list[int] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    assigned_lead_ids: list[int] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    student_eta_minutes: int | None = None
    eta_note: str | None = None
    eta_updated_at: datetime | None = None
    eta_by_id: int | None = Field(default=None, foreign_key="user.id")
    eta_target: datetime | None = None
    actual_start: datetime | None = None
    actual_complete: datetime | None = None
    cad_file_name: str | None = None
    cad_file_path: str | None = None
    cam_file_name: str | None = None
    cam_file_path: str | None = None


class TicketType(str, Enum):
    feature = "feature"
    issue = "issue"


class TicketPriority(str, Enum):
    low = "low"
    normal = "normal"
    high = "high"


class TicketStatus(str, Enum):
    open = "open"
    acknowledged = "acknowledged"
    resolved = "resolved"


class Ticket(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    type: TicketType = Field(index=True)
    priority: TicketPriority = Field(default=TicketPriority.normal, index=True)
    status: TicketStatus = Field(default=TicketStatus.open, index=True)
    subject: str
    details: str
    requester_id: int | None = Field(default=None, foreign_key="user.id")
    requester_name: str
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SheetSection(str, Enum):
    attendance = "attendance"
    manufacturing = "manufacturing"
    cnc = "cnc"
    printing = "printing"
    orders = "orders"
    inventory = "inventory"
    tickets_feature = "tickets_feature"
    tickets_issue = "tickets_issue"


class SheetLink(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    section: SheetSection = Field(index=True, unique=True)
    url: str
    updated_by_id: int | None = Field(default=None, foreign_key="user.id")
    updated_at: datetime = Field(default_factory=datetime.utcnow)
