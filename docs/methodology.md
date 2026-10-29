# Statistical and generation methods

## Workbook model

For mine m and day t, production is:

```text
output(m,t) = ROUND(MAX(0,
  smoothed_shock(m,t) * capacity(m) * weekday_factor(t)
  * (1 + daily_growth)^t * PRODUCT(event_factor(e,m,t))), 2)
```

The first day is t = 0. Dates are actual spreadsheet dates, formatted `yyyy-mm-dd`. Weekday multipliers use Monday through Sunday. All output is in metric tonnes/day.

Park-Miller integer states use modulus 2,147,483,647 and multiplier 16,807. Each mine has an independently seeded state stream. Each day consumes two states. Uniform innovations use minimum + (maximum - minimum) × U. Normal innovations use mean + SD × sqrt(-2 ln U1) × cos(2 pi U2). Zero SD is supported.

AR(1) smoothing centers on the innovation mean:

```text
S(0) = shock(0)
S(t) = mean + rho * (S(t-1) - mean)
       + sqrt(1 - rho^2) * (shock(t) - mean)
```

The square-root term preserves stationary variance for normal innovations. Setting rho = 0 produces independent innovations. Weekday patterns, growth, events and clipping subsequently change the observed distribution.

Each event draws one deterministic uniform membership value per mine/event and compares it to probability. A selected mine is affected for the entire duration. Within the event's inclusive daily span, the multiplicative factor is:

```text
1 + (peak_factor - 1) * exp(-0.5 * ((offset - (duration - 1)/2) / max(0.5, duration/4))^2)
```

Outside the span, the factor is 1. With an even duration the mathematical peak lies between dates. Factors multiply when events overlap.

## Backend execution

FastAPI performs ingestion, date filtering, fleet aggregation, statistics, detectors and polynomial fitting. NumPy supplies summaries and least squares; SciPy supplies the Student t inverse CDF. ReportLab renders PDF tables and vector charts from the same backend analysis. The frontend formats and renders returned results.

## Summary statistics

All summaries include all source observations in the selected date window. The fleet series is formed by summing mines day by day before computing its statistics; mine standard deviations are not added.

- Mean: sum / n.
- Sample standard deviation: square root of the sum of squared deviations divided by n - 1. Python uses an accurately summed mean and a scaled Euclidean residual norm to avoid tiny-value underflow; constant series explicitly have zero SD. Undefined for n = 1.
- Median and quartiles: sort values; interpolate at position (n - 1) × p, using p = 0.25, 0.5 and 0.75 (type 7).
- IQR: Q3 - Q1.

## Detectors

IQR flags values strictly below Q1 - k × IQR or strictly above Q3 + k × IQR. With IQR = 0, values different from the coincident fences can still be flagged.

Z-score flags abs(value - mean) / sample_SD > threshold. Flat series and n = 1 have no z-score flags.

Moving-average distance is abs(value - baseline) / abs(baseline) × 100. The baseline is the mean of the complete preceding window; it excludes the current day. No moving-average decisions are made during warm-up. Direct bounded-window summation avoids residue after zero-production windows. With baseline = 0, zero output has distance 0 and positive output has unbounded distance.

Grubbs tests only the observation with the largest absolute distance from the current mean on each pass:

```text
G = max(abs(x - mean)) / sample_SD
t = inverse_student_t(1 - alpha/(2n), df=n-2)
G_critical = (n-1)/sqrt(n) * sqrt(t^2 / (n-2+t^2))
flag if G > G_critical
```

At least three observations and positive SD are required. One pass is the default. A higher maximum repeats the single-outlier test on the remaining values and stops at the first non-significant candidate. Those temporary removals are used only for subsequent Grubbs passes, never for the report's descriptive statistics or trends. Repetition does not turn this into a joint multiple-outlier test. Grubbs assumes approximate normality and independence, which the generator's calendar effects and correlation can violate. Results on raw production are exploratory.

Reference: [NIST/SEMATECH e-Handbook, Grubbs' Test for Outliers](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h1.htm). The included eight-observation NIST fixture checks both the critical value and the identified observation.

## Trend fitting and anomaly labels

Polynomial least squares uses an intercept and degree 1–4 on time scaled to [-1, 1], solved by NumPy polynomial least squares with column scaling and an SVD solver. The degree is reduced to n - 1 for a short window. The fit is descriptive and includes anomalies.

An observation is included once in the anomaly log per series/day if any enabled test flags it. Its spike/drop direction compares output with the preceding moving-average baseline where available, otherwise the window's series mean. Each detector's own reference and threshold are retained separately. A statistical flag does not identify an operational cause or prove that a synthetic scheduled event caused it.
