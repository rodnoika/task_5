from __future__ import annotations

import csv
from io import StringIO
from pathlib import Path
import re
from urllib.parse import urlparse, parse_qs

import httpx

from .models import Dataset, Mine

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_ROOT = PROJECT_ROOT / "public"
MAX_BYTES = 4_000_000


def parse_csv(text: str, source: str) -> Dataset:
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("CSV exceeds the 4 MB limit.")
    try:
        rows = [
            row
            for row in csv.reader(StringIO(text.lstrip("\ufeff")), strict=True)
            if any(c.strip() for c in row)
        ]
    except csv.Error as error:
        raise ValueError(f"Malformed CSV: {error}") from error
    if len(rows) < 2:
        raise ValueError("CSV needs a header and at least one daily observation.")
    headers = [h.strip() for h in rows[0]]
    if not headers or headers[0].lower() != "date":
        raise ValueError("The first CSV column must be Date, formatted YYYY-MM-DD.")
    if sum(h.lower() == "total" for h in headers) > 1:
        raise ValueError(
            "Total is reserved for one aggregate column; choose another mine name."
        )
    columns = [
        (i, h) for i, h in enumerate(headers) if i and h and h.lower() != "total"
    ]
    if not 1 <= len(columns) <= 50:
        raise ValueError("Provide between 1 and 50 named mine columns.")
    dates: list[str] = []
    values: list[list[float]] = [[] for _ in columns]
    for row_number, row in enumerate(rows[1:], 2):
        dates.append(row[0].strip() if row else "")
        if any(
            value.strip() and (i >= len(headers) or not headers[i])
            for i, value in enumerate(row)
        ):
            raise ValueError(
                f"Row {row_number}: a populated output column has no name."
            )
        for j, (index, name) in enumerate(columns):
            raw = row[index].strip() if index < len(row) else ""
            if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", raw):
                raw = raw.replace(",", "")
            if not re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", raw):
                raise ValueError(
                    f"Row {row_number}, {name}: provide a nonnegative number; missing values are not zero."
                )
            values[j].append(float(raw))
    return Dataset(
        dates=dates,
        mines=[
            Mine(name=name, values=values[j]) for j, (_, name) in enumerate(columns)
        ],
        source=source,
    )


def sheet_reference(reference: str, override_gid: str | None = None) -> tuple[str, str]:
    reference = reference.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{20,150}", reference):
        return reference, override_gid or "0"
    url = urlparse(reference)
    if (
        url.scheme != "https"
        or url.hostname != "docs.google.com"
        or url.username
        or url.password
        or url.port not in (None, 443)
    ):
        raise ValueError(
            "Use an https://docs.google.com spreadsheet URL or a spreadsheet ID."
        )
    match = re.match(r"^/spreadsheets/d/([A-Za-z0-9_-]{20,150})(?:/|$)", url.path)
    if not match:
        raise ValueError("The spreadsheet ID is missing or invalid.")
    query, fragment = parse_qs(url.query), parse_qs(url.fragment)
    gid = override_gid or query.get("gid", fragment.get("gid", ["0"]))[0]
    if not re.fullmatch(r"\d{1,20}", gid):
        raise ValueError("The Data tab gid must contain digits only.")
    return match[1], gid


async def fetch_sheet(
    reference: str, gid: str | None, client: httpx.AsyncClient
) -> Dataset:
    spreadsheet, tab = sheet_reference(reference, gid)
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet}/export?format=csv&gid={tab}"
    async with client.stream("GET", url) as response:
        if response.status_code != 200:
            raise ValueError(
                f"Google Sheets returned {response.status_code}. Check link sharing and the Data tab gid."
            )
        if int(response.headers.get("content-length", "0")) > MAX_BYTES:
            raise ValueError("Export exceeds the 4 MB limit.")
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("Export exceeds the 4 MB limit.")
            chunks.append(chunk)
    try:
        text = b"".join(chunks).decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Google returned an invalid text export.") from error
    if text.lstrip().startswith("<"):
        raise ValueError(
            "Google returned a sign-in page. Check sharing: Anyone with the link, Editor."
        )
    return parse_csv(text, f"Google Sheets / {spreadsheet} / gid {tab}")
