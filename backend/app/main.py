from pathlib import Path
import sys
from datetime import datetime, timezone
from typing import AsyncIterator
import uvicorn
import httpx
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "app"

from .analysis import analyze_dataset
from .data import fetch_sheet, parse_csv
from .models import (
    AnalysisRequest,
    AnalysisResponse,
    CsvRequest,
    ReportRequest,
    SheetRequest,
    SourceResponse,
)

app = FastAPI(title="Weyland-Yutani Mining API", version="2.0.0")


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, error: RequestValidationError):

    detail = [
        {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
        for item in error.errors()[:50]
    ]
    return JSONResponse(status_code=422, content={"detail": detail})


@app.get("/api/health")
def health():
    return {"status": "ok", "backend": "FastAPI", "version": "2.0.0"}


def source_response(dataset) -> SourceResponse:
    return SourceResponse(
        dataset=dataset, fetched_at=datetime.now(timezone.utc).isoformat()
    )


@app.post("/api/datasets/csv", response_model=SourceResponse)
def csv_source(request: CsvRequest):
    try:
        return source_response(parse_csv(request.csv, "CSV / " + request.filename))
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, str(error)) from error


async def google_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        timeout=15, follow_redirects=True, max_redirects=5
    ) as client:
        yield client


@app.post("/api/datasets/sheets", response_model=SourceResponse)
async def sheets(
    request: SheetRequest, client: httpx.AsyncClient = Depends(google_client)
):
    try:
        return source_response(
            await fetch_sheet(request.reference, request.gid, client)
        )
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, str(error)) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            502,
            "Google Sheets could not be read. Check connectivity, sharing and the Data tab gid.",
        ) from error


@app.post("/api/analyze", response_model=AnalysisResponse)
def analysis(request: AnalysisRequest):
    return analyze_dataset(request)


@app.post("/api/reports/pdf", responses={200: {"content": {"application/pdf": {}}}})
def report(request: ReportRequest):
    from .report import build_report

    result = analyze_dataset(request)
    if not result.dataset.dates:
        raise HTTPException(
            422, "Choose a date window containing at least one daily observation."
        )
    document = build_report(result, request)
    filename = f"WY-extraction-{result.dataset.dates[0]}-{result.dataset.dates[-1]}.pdf"
    return Response(
        content=document,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir=str(Path(__file__).resolve().parents[1]),
        reload_dirs=[str(Path(__file__).resolve().parent)],
    )
