from datetime import date, timedelta
from io import BytesIO
import asyncio
import json

import httpx
import pytest
from pypdf import PdfReader
from PIL import Image

from app.data import PUBLIC_ROOT
from app.main import app


@pytest.fixture
def client():
    class ApiClient:
        def request(self, method, path, **kwargs):
            async def run():
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://testserver"
                ) as connection:
                    return await connection.request(method, path, **kwargs)

            return asyncio.run(run())

        def get(self, path, **kwargs):
            return self.request("GET", path, **kwargs)

        def post(self, path, **kwargs):
            return self.request("POST", path, **kwargs)

    return ApiClient()


def snapshot(values, name="Mine A", second=None):
    mines = [{"id": "untrusted-id", "name": name, "values": values}]
    if second is not None:
        mines.append({"id": "another-id", "name": "Mine B", "values": second})
    return {
        "dates": [
            (date(2099, 1, 1) + timedelta(days=i)).isoformat()
            for i in range(len(values))
        ],
        "mines": mines,
        "source": "Test fixture",
    }


def request(values, **options):
    return {"dataset": snapshot(values), **options}


def test_health_identifies_fastapi(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["backend"] == "FastAPI"


def test_demo_source_is_unavailable(client):
    assert client.get("/api/sample").status_code == 404


def test_overflowing_json_number_returns_safe_validation_error(client):
    body = json.dumps(request([1])).replace('"values": [1]', '"values": [1e999]')
    response = client.post(
        "/api/analyze", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert errors[0]["loc"][-1] == 0
    assert "input" not in errors[0]


def test_tiny_positive_outputs_retain_nonzero_sample_deviation(client):
    response = client.post(
        "/api/analyze",
        json=request(
            [0, 1e-200, 2e-200], settings={"enabled": ["Z-score"], "zThreshold": 0.5}
        ),
    )
    assert response.status_code == 200
    result = response.json()["series"][1]["analysis"]
    assert result["summary"]["sd"] / 1e-200 == pytest.approx(1)
    assert len(result["anomalies"]) == 2


def test_constant_decimal_series_has_zero_sd_and_no_z_score_flags(client):
    response = client.post(
        "/api/analyze",
        json=request(
            [1000.1] * 120, settings={"enabled": ["Z-score"], "zThreshold": 0.1}
        ),
    )
    result = response.json()["series"][1]["analysis"]
    assert result["summary"]["mean"] == 1000.1
    assert result["summary"]["sd"] == 0
    assert result["anomalies"] == []


@pytest.mark.parametrize("value", [False, 0, [], {}])
def test_date_filter_rejects_invalid_falsy_types(client, value):
    assert (
        client.post("/api/analyze", json=request([1, 2], startDate=value)).status_code
        == 422
    )


def test_server_returns_deviation_labels_and_stacked_marker_positions(client):
    result = client.post(
        "/api/analyze",
        json={
            "dataset": snapshot([1, 1, 1, 10], second=[2, 2, 2, 20]),
            "settings": {"enabled": ["Moving average"], "maWindow": 3, "maPercent": 30},
        },
    ).json()
    mine_a = result["series"][1]["analysis"]["anomalies"][0]
    mine_b = result["series"][2]["analysis"]["anomalies"][0]
    assert mine_a["deviationPercent"] == 900
    assert mine_a["deviationLabel"] == "+900.0%"
    assert mine_a["baselineDescription"] == "Previous 3-day average"
    assert mine_a["stackedValue"] == 10
    assert mine_b["stackedValue"] == 30


def test_stacked_pdf_handles_twelve_long_names_without_omitting_series(client):
    data = snapshot([1, 2])
    data["mines"] = [
        {
            "name": ("Outer colony production sector " * 3)[:75] + f" ID{i:02}",
            "values": [1, 2],
        }
        for i in range(1, 13)
    ]
    response = client.post(
        "/api/reports/pdf",
        json={"dataset": data, "mode": "stacked", "settings": {"enabled": []}},
    )
    assert response.status_code == 200
    page_texts = [
        page.extract_text() for page in PdfReader(BytesIO(response.content)).pages
    ]
    text = "\n".join(page_texts)
    provenance_page = next(page for page in page_texts if "SNAPSHOT PROVENANCE" in page)
    assert "Test fixture" in provenance_page
    for i in range(1, 13):
        assert f"ID{i:02}" in text


def test_descriptive_statistics_are_computed_on_server(client):
    response = client.post("/api/analyze", json=request([1, 2, 3, 4]))
    assert response.status_code == 200
    summary = response.json()["series"][0]["analysis"]["summary"]
    assert summary["mean"] == 2.5
    assert summary["sd"] == pytest.approx((5 / 3) ** 0.5)
    assert summary["median"] == 2.5
    assert summary["q1"] == 1.75
    assert summary["q3"] == 3.25
    assert summary["iqr"] == 1.5


def test_total_is_analyzed_after_daily_aggregation(client):
    response = client.post(
        "/api/analyze", json={"dataset": snapshot([1, 4], second=[4, 1])}
    )
    result = response.json()["series"][0]
    assert result["values"] == [5, 5]
    assert result["analysis"]["summary"]["sd"] == 0


def test_single_day_sd_is_json_null_not_nan(client):
    response = client.post("/api/analyze", json=request([4], degree=4))
    assert response.status_code == 200
    body = response.json()
    assert body["series"][0]["analysis"]["summary"]["sd"] is None
    assert body["series"][0]["trend"] == [4]
    assert body["effectiveDegree"] == 0
    assert "NaN" not in response.text


def test_grubbs_matches_nist_single_outlier_fixture(client):
    values = [199.31, 199.53, 200.19, 200.82, 201.92, 201.95, 202.18, 245.57]
    response = client.post(
        "/api/analyze", json=request(values, settings={"enabled": ["Grubbs"]})
    )
    flags = response.json()["series"][0]["analysis"]["anomalies"]
    assert [f["index"] for f in flags] == [7]
    assert flags[0]["evidence"][0]["threshold"] == pytest.approx(2.1266, abs=0.0001)
    assert flags[0]["evidence"][0]["score"] == pytest.approx(2.4688, abs=0.001)


def test_grubbs_single_pass_does_not_classify_every_large_z(client):
    response = client.post(
        "/api/analyze",
        json=request(
            [0, 1, 0, 1, 0, 1, 0, 1, 40, 200], settings={"enabled": ["Grubbs"]}
        ),
    )
    assert [
        f["index"] for f in response.json()["series"][0]["analysis"]["anomalies"]
    ] == [9]


def test_moving_average_excludes_current_observation(client):
    response = client.post(
        "/api/analyze",
        json=request(
            [10, 10, 10, 10, 100],
            settings={"enabled": ["Moving average"], "maWindow": 3, "maPercent": 30},
        ),
    )
    analysis = response.json()["series"][0]["analysis"]
    assert analysis["movingAverage"] == [None, None, None, 10, 10]
    assert [a["index"] for a in analysis["anomalies"]] == [4]
    assert analysis["anomalies"][0]["evidence"][0]["score"] == 900


def test_zero_window_does_not_retain_decimal_residue(client):
    response = client.post(
        "/api/analyze",
        json=request(
            [0.1, 0.2, 0.3] + [0] * 12, settings={"enabled": ["Moving average"]}
        ),
    )
    analysis = response.json()["series"][0]["analysis"]
    assert analysis["movingAverage"][10:] == [0] * 5
    assert not [a for a in analysis["anomalies"] if a["index"] >= 10]


def test_unbounded_percent_distance_has_valid_json_representation(client):
    response = client.post(
        "/api/analyze",
        json=request(
            [0, 0, 0, 5], settings={"enabled": ["Moving average"], "maWindow": 3}
        ),
    )
    assert response.status_code == 200
    evidence = response.json()["series"][0]["analysis"]["anomalies"][0]["evidence"][0]
    assert evidence["score"] is None
    assert evidence["unbounded"] is True
    assert (
        response.json()["series"][0]["analysis"]["anomalies"][0]["deviationLabel"]
        == "+∞%"
    )
    assert "Infinity" not in response.text


def test_disabling_all_detectors_keeps_summary_without_flags(client):
    result = client.post(
        "/api/analyze", json=request([0, 0, 0, 100], settings={"enabled": []})
    ).json()
    assert result["flaggedMineDays"] == 0
    assert result["series"][0]["analysis"]["summary"]["mean"] == 25


def test_polynomial_degree_four_recovers_known_curve(client):
    values = [
        400 + 2 * i - 0.1 * i * i + 0.002 * i**3 - 0.00001 * i**4 for i in range(70)
    ]
    response = client.post("/api/analyze", json=request(values, degree=4))
    assert response.json()["series"][0]["trend"] == pytest.approx(values, abs=1e-7)


def test_dates_are_filtered_on_backend(client):
    result = client.post(
        "/api/analyze",
        json=request([1, 2, 3, 4], startDate="2099-01-02", endDate="2099-01-03"),
    ).json()
    assert result["dataset"]["dates"] == ["2099-01-02", "2099-01-03"]
    assert result["series"][0]["analysis"]["summary"]["mean"] == 2.5


def test_empty_date_window_returns_explicit_empty_result(client):
    result = client.post(
        "/api/analyze", json=request([1, 2], startDate="2099-02-01")
    ).json()
    assert result["dataset"]["dates"] == []
    assert result["series"] == []
    assert result["flaggedMineDays"] == 0


@pytest.mark.parametrize(
    "override",
    [
        {"maWindow": 0},
        {"maWindow": 2.5},
        {"grubbsAlpha": 0},
        {"enabled": ["Fake test"]},
    ],
)
def test_invalid_detector_settings_are_rejected(client, override):
    assert (
        client.post(
            "/api/analyze", json=request([1, 2, 3], settings=override)
        ).status_code
        == 422
    )


def test_invalid_date_window_is_rejected(client):
    assert (
        client.post(
            "/api/analyze",
            json=request([1, 2], startDate="2099-01-02", endDate="2099-01-01"),
        ).status_code
        == 422
    )


def test_csv_parses_names_and_recomputes_untrusted_total(client):
    response = client.post(
        "/api/datasets/csv",
        json={
            "csv": 'Date,Total,"Mine, A",B,\r\n2099-01-01,999,10,20,\r\n2099-01-02,999,11,21,\r\n,,,,\r\n',
            "filename": "test.csv",
        },
    )
    assert response.status_code == 200
    data = response.json()["dataset"]
    assert data["mines"][0]["name"] == "Mine, A"
    result = client.post("/api/analyze", json={"dataset": data}).json()
    assert result["series"][0]["values"] == [30, 32]


def test_mine_identity_survives_reordered_columns(client):
    a = client.post(
        "/api/datasets/csv", json={"csv": "Date,A,B\n2099-01-01,1,2"}
    ).json()["dataset"]
    b = client.post(
        "/api/datasets/csv", json={"csv": "Date,B,A\n2099-01-01,2,1"}
    ).json()["dataset"]
    assert a["mines"][1]["id"] == b["mines"][0]["id"]


@pytest.mark.parametrize(
    "csv",
    [
        "Date,A\n2099-02-30,2",
        "Date,A\n2099-01-01,-2",
        "Date,A\n2099-01-01,",
        "Date,A\n2099-01-01,2\n2099-01-01,3",
        "Date,A,A\n2099-01-01,2,3",
        "Date,A\n2099-01-01,=2+3",
        "Date,A\n2099-01-01,1e155",
        "Date,A\n2099-01-01,1e999",
        "Date,Total,Total,A\n2099-01-01,6,4,2",
        "Date,A\n2099-01-01,1\n2099-01-03,2",
    ],
)
def test_csv_rejects_invalid_inputs(client, csv):
    assert client.post("/api/datasets/csv", json={"csv": csv}).status_code == 422


def test_json_dataset_is_validated_independently_of_csv(client):
    data = snapshot([1, 2], second=[3])
    assert client.post("/api/analyze", json={"dataset": data}).status_code == 422
    assert client.post("/api/analyze", json=request([1e308])).status_code == 422
    assert client.post("/api/analyze", json=request([True])).status_code == 422


def test_invalid_sheet_url_is_rejected_before_network(client):
    response = client.post(
        "/api/datasets/sheets",
        json={
            "reference": "https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_123456789/edit"
        },
    )
    assert response.status_code == 422


def test_server_pdf_contains_all_statistics_and_individual_anomalies(client):
    response = client.post(
        "/api/reports/pdf",
        json=request(
            [10, 10, 10, 10, 100],
            settings={"enabled": ["Moving average"], "maWindow": 3, "maPercent": 30},
            mode="bar",
            degree=2,
            trend=True,
        ),
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")
    pdf = PdfReader(BytesIO(response.content))
    text = "\n".join(page.extract_text() for page in pdf.pages)
    assert "Mine A" in text and "Fleet total" in text
    assert "Moving average" in text and "900.000%" in text
    assert text.count("SPIKE / 2099-01-05") == 2


def test_pdf_handles_single_day_and_escaped_unicode_names(client):
    response = client.post(
        "/api/reports/pdf",
        json={
            "dataset": snapshot([4], name="Шахта <A> & North"),
            "mode": "stacked",
            "degree": 4,
        },
    )
    assert response.status_code == 200
    text = "\n".join(
        p.extract_text() for p in PdfReader(BytesIO(response.content)).pages
    )
    assert "Шахта <A> & North" in text
    assert "n/a" in text


def test_empty_window_report_is_rejected(client):
    assert (
        client.post(
            "/api/reports/pdf", json=request([1, 2], startDate="2099-03-01")
        ).status_code
        == 422
    )


def test_report_embeds_the_supplied_logo_and_section_bookmarks(client):
    response = client.post(
        "/api/reports/pdf", json=request([1, 2, 3], settings={"enabled": []})
    )
    assert response.status_code == 200
    pdf = PdfReader(BytesIO(response.content))
    with Image.open(PUBLIC_ROOT / "branding" / "weyland-yutani.png") as supplied:
        expected = supplied.convert("RGB")
        assert any(
            embedded.image.size == expected.size
            and embedded.image.convert("RGB").tobytes() == expected.tobytes()
            for embedded in pdf.pages[0].images
        )

    def titles(items):
        result = []
        for item in items:
            result.extend(titles(item) if isinstance(item, list) else [item.title])
        return result

    outline = titles(pdf.outline)
    assert "Summary statistics" in outline
    assert "Mine profiles" in outline
    assert "Anomaly appendix" in outline
