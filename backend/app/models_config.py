from sqlmodel import Field, SQLModel

class AppConfig(SQLModel, table=True):
    id: int | None = Field(default=1, primary_key=True)
    restrict_attendance_to_schedule: bool = Field(default=True)
