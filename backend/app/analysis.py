from __future__ import annotations

import math
import numpy as np
from scipy.stats import t as student_t

from .models import (
    AnalysisRequest,
    AnalysisResponse,
    AnalyzedMine,
    Anomaly,
    DatasetView,
    DetectorSettings,
    Evidence,
    Mine,
    SeriesAnalysis,
    Summary,
)


def summarize(values: list[float]) -> Summary:
    array = np.asarray(values, dtype=np.float64)
    q1, median, q3 = np.quantile(array, [0.25, 0.5, 0.75], method="linear")
    total = math.fsum(values)
    low, high = min(values), max(values)
    mean = low if low == high else total / len(values)

    sd = (
        math.hypot(*(value - mean for value in values)) / math.sqrt(len(values) - 1)
        if len(values) > 1
        else None
    )
    return Summary(
        n=len(values),
        sum=total,
        mean=mean,
        sd=sd,
        median=float(median),
        q1=float(q1),
        q3=float(q3),
        iqr=float(q3 - q1),
        min=low,
        max=high,
    )


def polynomial(values: list[float], degree: int) -> list[float]:
    if len(values) <= degree + 1:
        return list(values)
    x = np.linspace(-1, 1, len(values))
    coefficients = np.polynomial.polynomial.polyfit(x, np.asarray(values), degree)
    return np.polynomial.polynomial.polyval(x, coefficients).tolist()


def analyze_series(values: list[float], settings: DetectorSettings) -> SeriesAnalysis:
    summary = summarize(values)
    baseline = [
        (
            math.fsum(values[i - settings.ma_window : i]) / settings.ma_window
            if i >= settings.ma_window
            else None
        )
        for i in range(len(values))
    ]
    evidence: dict[int, list[Evidence]] = {}

    def add(index: int, item: Evidence):
        evidence.setdefault(index, []).append(item)

    for i, value in enumerate(values):
        if "IQR" in settings.enabled:
            lower = summary.q1 - settings.iqr_multiplier * summary.iqr
            upper = summary.q3 + settings.iqr_multiplier * summary.iqr
            if value < lower or value > upper:
                add(
                    i,
                    Evidence(
                        test="IQR",
                        score=value,
                        threshold=lower if value < lower else upper,
                        baseline=summary.median,
                        detail=f"Outside [{lower:.2f}, {upper:.2f}] t/day",
                    ),
                )
        if "Z-score" in settings.enabled and summary.sd is not None and summary.sd > 0:
            score = abs(value - summary.mean) / summary.sd
            if score > settings.z_threshold:
                add(
                    i,
                    Evidence(
                        test="Z-score",
                        score=score,
                        threshold=settings.z_threshold,
                        baseline=summary.mean,
                        detail=f"Absolute z {score:.3f} > {settings.z_threshold:g}",
                    ),
                )
        if "Moving average" in settings.enabled and baseline[i] is not None:
            prior = baseline[i]
            distance = (
                abs(value - prior) / abs(prior) * 100
                if prior
                else (0 if value == 0 else math.inf)
            )
            if distance > settings.ma_percent:
                unbounded = not math.isfinite(distance)
                label = "Unbounded" if unbounded else f"{distance:.1f}"
                add(
                    i,
                    Evidence(
                        test="Moving average",
                        score=None if unbounded else distance,
                        unbounded=unbounded,
                        threshold=settings.ma_percent,
                        baseline=prior,
                        detail=f"{label}% from previous {settings.ma_window}-day mean ({prior:.2f} t/day)",
                    ),
                )
    if "Grubbs" in settings.enabled:
        remaining = list(range(len(values)))
        for iteration in range(settings.grubbs_max):
            n = len(remaining)
            if n < 3:
                break
            current = summarize([values[i] for i in remaining])
            if current.sd is None or current.sd <= 0:
                break
            index = max(remaining, key=lambda i: abs(values[i] - current.mean))
            score = abs(values[index] - current.mean) / current.sd
            t = float(student_t.ppf(1 - settings.grubbs_alpha / (2 * n), n - 2))
            critical = (n - 1) / math.sqrt(n) * math.sqrt(t * t / (n - 2 + t * t))
            if score <= critical:
                break
            add(
                index,
                Evidence(
                    test="Grubbs",
                    score=score,
                    threshold=critical,
                    baseline=current.mean,
                    detail=f"G {score:.3f} > {critical:.3f}; n={n}, alpha={settings.grubbs_alpha:g}, pass={iteration+1}",
                ),
            )
            remaining.remove(index)
    flags = []
    for index, items in sorted(evidence.items()):
        comparison = baseline[index] if baseline[index] is not None else summary.mean
        percent = (values[index] / comparison - 1) * 100 if comparison else None
        label = (
            f"{percent:+,.1f}%"
            if percent is not None and math.isfinite(percent)
            else ("+∞%" if percent is not None or values[index] > 0 else "0.0%")
        )
        flags.append(
            Anomaly(
                index=index,
                value=values[index],
                direction="spike" if values[index] >= comparison else "drop",
                baseline=comparison,
                evidence=items,
                stacked_value=values[index],
                deviation_percent=(
                    percent if percent is not None and math.isfinite(percent) else None
                ),
                deviation_label=label,
                baseline_description=(
                    f"Previous {settings.ma_window}-day average"
                    if baseline[index] is not None
                    else "Series mean (moving-average warm-up)"
                ),
            )
        )
    return SeriesAnalysis(summary=summary, anomalies=flags, moving_average=baseline)


def analyze_dataset(request: AnalysisRequest) -> AnalysisResponse:
    data = request.dataset
    indices = [
        i
        for i, day in enumerate(data.dates)
        if (not request.start_date or day >= request.start_date)
        and (not request.end_date or day <= request.end_date)
    ]
    filtered = DatasetView(
        dates=[data.dates[i] for i in indices],
        mines=[
            Mine(id=m.id, name=m.name, values=[m.values[i] for i in indices])
            for m in data.mines
        ],
        source=data.source,
    )
    if not indices:
        return AnalysisResponse(
            dataset=filtered, series=[], flagged_mine_days=0, effective_degree=0
        )
    totals = [
        math.fsum(m.values[i] for m in filtered.mines) for i in range(len(indices))
    ]
    series = []
    for identifier, name, values in [("total", "Fleet total", totals)] + [
        (m.id, m.name, m.values) for m in filtered.mines
    ]:
        series.append(
            AnalyzedMine(
                id=identifier,
                name=name,
                values=values,
                trend=polynomial(values, request.degree),
                analysis=analyze_series(values, request.settings),
            )
        )
    cumulative = [0.0] * len(indices)
    for mine in series[1:]:
        cumulative = [a + b for a, b in zip(cumulative, mine.values)]
        for flag in mine.analysis.anomalies:
            flag.stacked_value = cumulative[flag.index]
    return AnalysisResponse(
        dataset=filtered,
        series=series,
        flagged_mine_days=sum(len(m.analysis.anomalies) for m in series[1:]),
        effective_degree=min(request.degree, len(indices) - 1),
    )
