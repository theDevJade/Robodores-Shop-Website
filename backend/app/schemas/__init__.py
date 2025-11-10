from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, HttpUrl
from typing import Optional

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class TokenRefresh(BaseModel):
    refresh_token: str

class TokenPayload(BaseModel):
    sub: str | None = None
    roles: list[str] | None = None

class AppSettings(BaseModel):
    restrict_attendance_to_schedule: bool = True

class UserBaseIn(BaseModel):
    email: EmailStr
    full_name: str
    role: str
    barcode_id: str | None = None
    student_id: str | None = None

class UserCreate(UserBaseIn):
    password: str

class UserRead(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    barcode_id: str | None = None
    student_id: str | None = None
    is_active: bool

class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    barcode_id: str | None = None
    student_id: str | None = None
    password: str | None = None

class UserSelfUpdate(BaseModel):
    full_name: str | None = None
    barcode_id: str | None = None
    student_id: str | None = None
    password: str | None = None

class PendingUserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    requested_role: str = "student"

class PendingUserRead(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    requested_role: str
    created_at: datetime

class ApprovePending(BaseModel):
    role: str

class AttendanceScan(BaseModel):
    barcode_id: Optional[str] = None
    student_id: Optional[str] = None
    mode: Optional[str] = None
    timestamp: datetime
    note: Optional[str] = None

class AttendanceRead(BaseModel):
    id: int
    student_name: str
    student_identifier: str | None = None
    check_in: datetime | None
    check_out: datetime | None
    status: str
    note: str | None

class AttendanceDay(BaseModel):
    date: str
    entries: list[AttendanceRead]

class AttendanceStatusUpdate(BaseModel):
    status: str

class AttendanceSummary(BaseModel):
    date: str
    open_entries: int

class AttendanceLogItem(BaseModel):
    id: int
    student_name: str
    check_in: datetime | None
    check_out: datetime | None

class ScheduleBlockCreate(BaseModel):
    weekday: int
    start_time: str
    end_time: str
    active: bool = True

class ScheduleBlockRead(BaseModel):
    id: int
    weekday: int
    start_time: str
    end_time: str
    active: bool

class ShopJobCreate(BaseModel):
    shop: str
    part_name: str
    owner_name: str
    notes: str | None = None

class ShopJobRead(BaseModel):
    id: int
    shop: str
    part_name: str
    owner_name: str
    status: str
    notes: str | None
    file_name: str
    created_at: datetime
    file_url: Optional[str] = None
    queue_position: int
    claimed_by_id: int | None = None
    claimed_by_name: str | None = None
    claimed_at: datetime | None = None

class JobStatusUpdate(BaseModel):
    status: str
    note: str | None = None

class JobReorder(BaseModel):
    shop: str
    ordered_ids: list[int]

class OrderCreate(BaseModel):
    requester_name: str
    part_name: str
    vendor_link: HttpUrl
    price_usd: float
    justification: str | None = None

class OrderRead(OrderCreate):
    id: int
    status: str
    created_at: datetime

class OrderStatusUpdate(BaseModel):
    status: str

class InventoryItemCreate(BaseModel):
    part_name: str
    sku: str | None = None
    location: str | None = None
    quantity: int = 0
    unit_cost: float | None = None
    reorder_threshold: int | None = None
    tags: str | None = None
    vendor_link: Optional[str] = None

class InventoryItemUpdate(BaseModel):
    part_name: Optional[str] = None
    sku: Optional[str] = None
    location: Optional[str] = None
    unit_cost: Optional[float] = None
    reorder_threshold: Optional[int] = None
    tags: Optional[str] = None
    vendor_link: Optional[str] = None

class InventoryItemRead(BaseModel):
    id: int
    part_name: str
    sku: str | None
    location: str | None
    quantity: int
    unit_cost: float | None
    reorder_threshold: int | None
    tags: str | None
    vendor_link: str | None
    updated_at: datetime

class InventoryAdjust(BaseModel):
    delta: int
    reason: str = "manual"
    note: str | None = None

class InventoryTransactionRead(BaseModel):
    id: int
    item_id: int
    delta: int
    reason: str
    note: str | None
    performed_by: int | None
    created_at: datetime

class TicketCreate(BaseModel):
    type: str
    subject: str
    details: str
    priority: str = "normal"

class TicketRead(BaseModel):
    id: int
    type: str
    subject: str
    details: str
    priority: str
    status: str
    requester_name: str
    created_at: datetime
    updated_at: datetime

class TicketUpdate(BaseModel):
    status: str

class ManufacturingAssignment(BaseModel):
    id: int
    name: str
    role: str

class ManufacturingPartCreate(BaseModel):
    part_name: str
    subsystem: str
    material: str
    quantity: int = Field(gt=0)
    manufacturing_type: str
    cad_link: str
    priority: str = "normal"
    notes: str | None = None
    material_stock: str | None = None
    cam_link: str | None = None
    cam_student: str | None = None
    cnc_operator: str | None = None
    printer_assignment: str | None = None
    slicer_profile: str | None = None
    filament_type: str | None = None
    tool_type: str | None = None
    dimensions: str | None = None
    responsible_student: str | None = None
    assigned_student_ids: list[int] = Field(default_factory=list)
    assigned_lead_ids: list[int] = Field(default_factory=list)

class ManufacturingPartUpdate(BaseModel):
    part_name: str | None = None
    subsystem: str | None = None
    material: str | None = None
    quantity: int | None = None
    manufacturing_type: str | None = None
    cad_link: str | None = None
    priority: str | None = None
    notes: str | None = None
    material_stock: str | None = None
    cam_link: str | None = None
    cam_student: str | None = None
    cnc_operator: str | None = None
    printer_assignment: str | None = None
    slicer_profile: str | None = None
    filament_type: str | None = None
    tool_type: str | None = None
    dimensions: str | None = None
    responsible_student: str | None = None
    assigned_student_ids: list[int] | None = None
    assigned_lead_ids: list[int] | None = None
    status_locked: bool | None = None
    lock_reason: str | None = None

class ManufacturingStatusUpdate(BaseModel):
    status: str
    note: str | None = None

class ManufacturingPartRead(BaseModel):
    id: int
    part_name: str
    subsystem: str
    material: str
    quantity: int
    manufacturing_type: str
    cad_link: str
    cam_link: str | None
    cam_student: str | None
    cnc_operator: str | None
    material_stock: str | None
    printer_assignment: str | None
    slicer_profile: str | None
    filament_type: str | None
    tool_type: str | None
    dimensions: str | None
    responsible_student: str | None
    notes: str | None
    priority: str
    status: str
    status_label: str
    status_locked: bool
    lock_reason: str | None
    created_at: datetime
    updated_at: datetime
    last_status_change: datetime
    created_by: ManufacturingAssignment
    approved_by: ManufacturingAssignment | None
    assigned_students: list[ManufacturingAssignment]
    assigned_leads: list[ManufacturingAssignment]
    can_edit: bool
    can_move: bool
    can_assign: bool
    student_eta_minutes: int | None = None
    eta_note: str | None = None
    eta_updated_at: datetime | None = None
    eta_by: ManufacturingAssignment | None = None
    eta_target: datetime | None = None
    actual_start: datetime | None = None
    actual_complete: datetime | None = None
    cad_file_name: str | None = None
    cad_file_url: str | None = None
    cam_file_name: str | None = None
    cam_file_url: str | None = None

class ManufacturingSummary(BaseModel):
    total: int
    urgent: int
    by_status: dict[str, int]

class ManufacturingLookupUser(BaseModel):
    id: int
    name: str
    role: str

class ManufacturingLookupResponse(BaseModel):
    users: list[ManufacturingLookupUser]

class ManufacturingClaimInput(BaseModel):
    eta_minutes: int | None = Field(default=None, ge=0)
    eta_note: str | None = None
    eta_target: datetime | None = None

class ManufacturingEtaUpdate(BaseModel):
    eta_minutes: int = Field(ge=0)
    eta_note: str | None = None
    eta_target: datetime | None = None
