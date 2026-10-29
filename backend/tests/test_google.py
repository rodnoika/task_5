import asyncio

import httpx
import pytest

from app.data import fetch_sheet, sheet_reference

SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz_123456789"


def test_google_request_uses_fixed_export_host_and_validates_csv():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(
            200, text="Date,Total,A\n2099-01-01,999,4\n2099-01-02,999,5"
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_sheet(
                f"https://docs.google.com/spreadsheets/d/{SHEET}/edit#gid=27",
                None,
                client,
            )

    data = asyncio.run(run())
    assert calls == [
        f"https://docs.google.com/spreadsheets/d/{SHEET}/export?format=csv&gid=27"
    ]
    assert data.mines[0].values == [4, 5]


@pytest.mark.parametrize(
    "reference",
    [
        "https://evil.example/spreadsheets/d/" + SHEET + "/edit",
        "../../secret",
        "http://docs.google.com/spreadsheets/d/" + SHEET + "/edit",
    ],
)
def test_invalid_sheet_references_cannot_initiate_requests(reference):
    with pytest.raises(ValueError):
        sheet_reference(reference)


@pytest.mark.parametrize(
    "response,message",
    [
        (httpx.Response(403), "sharing"),
        (httpx.Response(200, text="<html>Sign in</html>"), "sign-in"),
        (httpx.Response(200, headers={"content-length": "5000000"}), "4 MB"),
    ],
)
def test_unusable_exports_have_explanatory_errors(response, message):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: response)
        ) as client:
            return await fetch_sheet(SHEET, "0", client)

    with pytest.raises(ValueError, match=message):
        asyncio.run(run())
