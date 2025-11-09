from __future__ import annotations
from datetime import datetime
from io import StringIO, BytesIO
import csv
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session
from ..core import deps
from ..core.database import get_session
from .. import models
from ..services.export_data import get_section_dataset

router = APIRouter(prefix="/exports", tags=["exports"])


def _safe_filename(section: models.SheetSection, provided: str | None) -> str:
    base = provided.strip() if provided and provided.strip() else f"{section.value}-{datetime.utcnow().date().isoformat()}"
    if not base.lower().endswith(".csv"):
        base += ".csv"
    return base.replace("\n", " ").replace("\r", " ")


@router.get("/{section}")
def export_section(
    section: models.SheetSection,
    filename: str | None = Query(None, max_length=100),
    session: Session = Depends(get_session),
    _: models.User = Depends(deps.get_current_user),
):
    title, headers, rows = get_section_dataset(section, session)
    csv_buffer = StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(headers)
    writer.writerows(rows)
    csv_buffer.seek(0)
    data = csv_buffer.getvalue().encode("utf-8")
    stream = BytesIO(data)
    safe_name = _safe_filename(section, filename or title)
    headers_resp = {"Content-Disposition": f'attachment; filename="{safe_name}"'}
    return StreamingResponse(stream, media_type="text/csv", headers=headers_resp)
