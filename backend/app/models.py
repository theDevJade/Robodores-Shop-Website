from __future__ import annotations
from datetime import datetime, time
from enum import Enum
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

class OrderStatus(str, Enum):
    pending = "pending"
    ordered = "ordered"
    received = "received"
    cancelled = "cancelled"

class InventoryReason(str, Enum):
    manual = "manual"
    job = "job"
    correction = "correction"

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
    location: str | None = Field(default=None, index=True)
    quantity: int = Field(default=0)
    unit_cost: float | None = None
    reorder_threshold: int | None = None
    tags: str | None = None
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
