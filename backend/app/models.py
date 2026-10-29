from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

TestName = Literal["IQR", "Z-score", "Moving average", "Grubbs"]
OutputValue = Annotated[float, Field(strict=True, ge=0, le=1e100)]


def mine_id(name: str) -> str:
    return "mine-" + "-".join(
        format(ord(c), "x") for c in unicodedata.normalize("NFC", name).lower()
    )


def iso_date(value: str) -> str:
    try:
        if len(value) != 10 or date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("Dates must be real ISO dates in YYYY-MM-DD format.") from None
    return value


class ApiModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        allow_inf_nan=False,
        alias_generator=to_camel,
        populate_by_name=True,
    )


class Mine(ApiModel):
    id: str = ""
    name: str = Field(min_length=1, max_length=80)
    values: list[OutputValue] = Field(max_length=3660)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip()
        if not value or value.lower() == "total":
            raise ValueError(
                "Mine names must be nonempty; Total is reserved for the aggregate column."
            )
        return value


class DatasetView(ApiModel):
    dates: list[str]
    mines: list[Mine]
    source: str = Field(max_length=512)


class Dataset(DatasetView):
    dates: list[str] = Field(min_length=1, max_length=3660)
    mines: list[Mine] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def canonicalize(self) -> "Dataset":
        for value in self.dates:
            iso_date(value)
        if len(set(self.dates)) != len(self.dates):
            raise ValueError("Duplicate dates are not allowed.")
        names: set[str] = set()
        order = sorted(range(len(self.dates)), key=lambda i: self.dates[i])
        for mine in self.mines:
            if len(mine.values) != len(self.dates):
                raise ValueError(
                    f"{mine.name}: provide one nonnegative output value for every date."
                )
            mine.id = mine_id(mine.name)
            if mine.id in names:
                raise ValueError("Mine names must be unique.")
            names.add(mine.id)
            mine.values = [mine.values[i] for i in order]
        self.dates = [self.dates[i] for i in order]
        if any(
            (date.fromisoformat(b) - date.fromisoformat(a)).days != 1
            for a, b in zip(self.dates, self.dates[1:])
        ):
            raise ValueError(
                "Dates must be consecutive daily observations. Fill missing dates in the source."
            )
        return self


class DetectorSettings(ApiModel):
    iqr_multiplier: float = Field(default=1.5, ge=0, le=10)
    z_threshold: float = Field(default=3, ge=0.1, le=10)
    ma_window: int = Field(default=7, ge=2, le=365, strict=True)
    ma_percent: float = Field(default=45, ge=0, le=1000)
    grubbs_alpha: float = Field(default=0.05, ge=0.001, le=0.2)
    grubbs_max: int = Field(default=1, ge=1, le=20, strict=True)
    enabled: list[TestName] = Field(
        default_factory=lambda: ["IQR", "Z-score", "Moving average", "Grubbs"],
        max_length=4,
    )

    @field_validator("enabled")
    @classmethod
    def unique_tests(cls, value: list[TestName]) -> list[TestName]:
        return list(dict.fromkeys(value))


class AnalysisRequest(ApiModel):
    dataset: Dataset
    settings: DetectorSettings = Field(default_factory=DetectorSettings)
    start_date: str | None = None
    end_date: str | None = None
    degree: int = Field(default=2, ge=1, le=4, strict=True)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def valid_filter(cls, value: str | None) -> str | None:
        return None if value is None or value == "" else iso_date(value)

    @model_validator(mode="after")
    def valid_window(self) -> "AnalysisRequest":
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("Start date must not be after end date.")
        return self


class ReportRequest(AnalysisRequest):
    mode: Literal["line", "bar", "stacked"] = "line"
    trend: bool = True
    snapshot_at: str | None = Field(default=None, max_length=80)


class CsvRequest(ApiModel):
    csv: str = Field(min_length=1, max_length=4_000_000)
    filename: str = Field(default="upload.csv", min_length=1, max_length=255)


class SheetRequest(ApiModel):
    reference: str = Field(min_length=1, max_length=512)
    gid: str | None = Field(default=None, pattern=r"^\d{1,20}$")


class SourceResponse(ApiModel):
    dataset: Dataset
    fetched_at: str


class Summary(ApiModel):
    n: int
    sum: float
    mean: float
    sd: float | None
    median: float
    q1: float
    q3: float
    iqr: float
    min: float
    max: float


class Evidence(ApiModel):
    test: TestName
    score: float | None
    threshold: float
    baseline: float
    detail: str
    unbounded: bool = False


class Anomaly(ApiModel):
    index: int
    value: float
    direction: Literal["spike", "drop"]
    baseline: float
    evidence: list[Evidence]
    stacked_value: float = 0
    deviation_percent: float | None = None
    deviation_label: str = "n/a"
    baseline_description: str = ""


class SeriesAnalysis(ApiModel):
    summary: Summary
    anomalies: list[Anomaly]
    moving_average: list[float | None]


class AnalyzedMine(ApiModel):
    id: str
    name: str
    values: list[float]
    trend: list[float]
    analysis: SeriesAnalysis


class AnalysisResponse(ApiModel):
    dataset: DatasetView
    series: list[AnalyzedMine]
    flagged_mine_days: int
    effective_degree: int
