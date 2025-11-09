from __future__ import annotations
from typing import Any
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from ..core.config import get_settings

settings = get_settings()


def append_order_to_sheet(values: list[Any]) -> str | None:
    if not (settings.google_service_account_file and settings.google_sheet_id):
        return None
    creds = Credentials.from_service_account_file(
        settings.google_service_account_file,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    service = build("sheets", "v4", credentials=creds)
    body = {"values": [values]}
    result = (
        service.spreadsheets()
        .values()
        .append(
            spreadsheetId=settings.google_sheet_id,
            range="Orders!A:G",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        )
        .execute()
    )
    return result.get("updates", {}).get("updatedRange")
