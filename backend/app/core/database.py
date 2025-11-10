from sqlmodel import SQLModel, create_engine, Session, select
from sqlalchemy import text
from .config import get_settings
from ..models_config import AppConfig
from .. import models

settings = get_settings()
engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})

def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    recreated_attendance = False
    queue_backfill_needed = False
    with engine.begin() as conn:
        cols = conn.execute(text("PRAGMA table_info('user')")).fetchall()
        names = {row[1] for row in cols}
        if "student_id" not in names:
            conn.execute(text("ALTER TABLE user ADD COLUMN student_id VARCHAR"))
        attendance_cols = conn.execute(text("PRAGMA table_info('attendanceentry')")).fetchall()
        attendance_names = {row[1] for row in attendance_cols}
        user_col = next((row for row in attendance_cols if row[1] == "user_id"), None)
        needs_rebuild = bool(attendance_cols) and (
            "recorded_student_id" not in attendance_names
            or "recorded_barcode_id" not in attendance_names
            or (user_col and user_col[3] == 1)
        )
        if needs_rebuild:
            conn.execute(text("ALTER TABLE attendanceentry RENAME TO attendanceentry_old"))
            conn.execute(
                text(
                    """
                    CREATE TABLE attendanceentry (
                        id INTEGER NOT NULL PRIMARY KEY,
                        user_id INTEGER NULL REFERENCES user (id),
                        recorded_student_id VARCHAR,
                        recorded_barcode_id VARCHAR,
                        check_in DATETIME,
                        check_out DATETIME,
                        status VARCHAR(11) NOT NULL,
                        note VARCHAR
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO attendanceentry (
                        id, user_id, recorded_student_id, recorded_barcode_id,
                        check_in, check_out, status, note
                    )
                    SELECT id, user_id, NULL, NULL, check_in, check_out, status, note
                    FROM attendanceentry_old
                    """
                )
            )
            conn.execute(text("DROP TABLE attendanceentry_old"))
            recreated_attendance = True
        shop_cols = conn.execute(text("PRAGMA table_info('shopjob')")).fetchall()
        shop_names = {row[1] for row in shop_cols}
        if "queue_position" not in shop_names:
            conn.execute(text("ALTER TABLE shopjob ADD COLUMN queue_position INTEGER DEFAULT 0"))
            queue_backfill_needed = True
        if "claimed_by_id" not in shop_names:
            conn.execute(text("ALTER TABLE shopjob ADD COLUMN claimed_by_id INTEGER"))
        if "claimed_at" not in shop_names:
            conn.execute(text("ALTER TABLE shopjob ADD COLUMN claimed_at DATETIME"))
        inventory_cols = conn.execute(text("PRAGMA table_info('inventoryitem')")).fetchall()
        inventory_names = {row[1] for row in inventory_cols}
        if "vendor_link" not in inventory_names:
            conn.execute(text("ALTER TABLE inventoryitem ADD COLUMN vendor_link VARCHAR"))
        # New inventory fields added in UI overhaul
        if "part_type" not in inventory_names:
            conn.execute(text("ALTER TABLE inventoryitem ADD COLUMN part_type VARCHAR"))
            # Default existing rows to 'custom' to maintain compatibility
            conn.execute(text("UPDATE inventoryitem SET part_type = 'custom' WHERE part_type IS NULL"))
        if "vendor_name" not in inventory_names:
            conn.execute(text("ALTER TABLE inventoryitem ADD COLUMN vendor_name VARCHAR"))
        manuf_cols = conn.execute(text("PRAGMA table_info('manufacturingpart')")).fetchall()
        manuf_names = {row[1] for row in manuf_cols}
        if manuf_cols:
            if "student_eta_minutes" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN student_eta_minutes INTEGER"))
            if "eta_note" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN eta_note VARCHAR"))
            if "eta_updated_at" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN eta_updated_at DATETIME"))
            if "eta_by_id" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN eta_by_id INTEGER"))
            if "eta_target" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN eta_target DATETIME"))
            if "actual_start" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN actual_start DATETIME"))
            if "actual_complete" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN actual_complete DATETIME"))
            if "cad_file_name" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN cad_file_name VARCHAR"))
            if "cad_file_path" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN cad_file_path VARCHAR"))
            if "cam_file_name" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN cam_file_name VARCHAR"))
            if "cam_file_path" not in manuf_names:
                conn.execute(text("ALTER TABLE manufacturingpart ADD COLUMN cam_file_path VARCHAR"))
    if recreated_attendance:
        SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        if not session.get(AppConfig, 1):
            session.add(AppConfig(id=1, restrict_attendance_to_schedule=True))
            session.commit()
        if queue_backfill_needed:
            for shop in models.ShopType:
                jobs = session.exec(
                    select(models.ShopJob)
                    .where(models.ShopJob.shop == shop)
                    .order_by(models.ShopJob.created_at.asc())
                ).all()
                for idx, job in enumerate(jobs, start=1):
                    job.queue_position = idx
                    session.add(job)
            session.commit()

def get_session():
    with Session(engine) as session:
        yield session
