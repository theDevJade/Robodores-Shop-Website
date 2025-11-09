from __future__ import annotations
import re
from typing import Any, Iterable
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build


SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
]


def _spreadsheet_id_from_url(url: str) -> str | None:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url)
    return m.group(1) if m else None


def get_sheets_service(service_account_file: str):
    creds = Credentials.from_service_account_file(service_account_file, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)


def put_worksheet(
    service: Any,
    spreadsheet_id: str,
    title: str,
    headers: Iterable[str],
    rows: Iterable[Iterable[Any]],
):
    sheets = service.spreadsheets()
    # Ensure sheet exists; try to add then ignore if exists
    try:
        requests = [{"addSheet": {"properties": {"title": title}}}]
        sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()
    except Exception:
        # Probably already exists; continue
        pass
    # Clear then update
    header_row = [list(headers)]
    values = header_row + [list(r) for r in rows]
    range_name = f"{title}!A1"
    sheets.values().clear(spreadsheetId=spreadsheet_id, range=title).execute()
    sheets.values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="RAW",
        body={"values": values},
    ).execute()


def parse_spreadsheet_id(url: str) -> str:
    sid = _spreadsheet_id_from_url(url)
    if not sid:
        raise ValueError("Invalid Google Sheet URL")
    return sid
