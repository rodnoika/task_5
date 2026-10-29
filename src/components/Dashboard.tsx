"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  Layers,
  LayoutDashboard,
  LineChart,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import SourceDialog from "./SourceDialog";
import ProductionChart, { type ChartSeries } from "./ProductionChart";
import Modal from "./Modal";
import { requestPdf } from "@/lib/api";
import { useMiningData } from "@/lib/useMiningData";
import {
  DEFAULT_SETTINGS,
  seriesColor,
  type DetectorSettings,
  type ChartMode,
  type TestName,
  type Anomaly,
} from "@/lib/types";

const number = (v: number | null, digits = 0) =>
  v === null || Number.isNaN(v)
    ? "n/a"
    : !Number.isFinite(v)
      ? "∞"
      : v.toLocaleString("en", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
const shortDate = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const testNames: TestName[] = ["IQR", "Z-score", "Moving average", "Grubbs"];

const detectorDescriptions: Record<TestName, string> = {
  IQR: "Flags values below Q1 − k × IQR or above Q3 + k × IQR. Increase the multiplier for wider limits.",
  "Z-score":
    "Flags values more than the chosen number of sample standard deviations from the mean.",
  "Moving average":
    "Compares each day with the average of the previous N days. Flags percentage differences above your limit.",
  Grubbs:
    "Tests the most extreme value for an outlier. Assumes independent, approximately normal data; extra passes repeat the test.",
};
function Numeric({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="numeric-control form-label">
      <span>{label}</span>
      <input
        className="form-control form-control-sm"
        type="number"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = Number(draft);
          if (
            draft !== "" &&
            Number.isFinite(v) &&
            v >= min &&
            v <= max &&
            (step < 1 || Number.isInteger(v))
          )
            onChange(v);
          else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function Sparkline({
  values,
  color = "#206bc4",
}: {
  values: number[];
  color?: string;
}) {
  const lo = Math.min(...values),
    hi = Math.max(...values),
    span = hi - lo || 1;
  return (
    <svg viewBox="0 0 116 30" aria-hidden="true" className="sparkline">
      <polyline
        points={values
          .map(
            (v, i) =>
              `${(i / Math.max(1, values.length - 1)) * 116},${27 - ((v - lo) / span) * 23}`,
          )
          .join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
      />
    </svg>
  );
}
export default function Dashboard() {
  const [sourceOpen, setSourceOpen] = useState(false),
    [reportError, setReportError] = useState("");
  const [activeHelp, setActiveHelp] = useState<TestName | null>(null);
  const [menuOpen, setMenuOpen] = useState(false),
    [activeSection, setActiveSection] = useState("overview");
  const [settings, setSettings] = useState<DetectorSettings>(DEFAULT_SETTINGS),
    [mode, setMode] = useState<ChartMode>("line"),
    [degree, setDegree] = useState(2),
    [trend, setTrend] = useState(true),
    [mine, setMine] = useState("total");
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [method, setMethod] = useState("all"),
    [page, setPage] = useState(0),
    [reporting, setReporting] = useState(false);
  const [detail, setDetail] = useState<{
    series: ChartSeries;
    anomaly: Anomaly;
    date: string;
  } | null>(null);
  const closeSource = useCallback(() => setSourceOpen(false), []),
    closeDetail = useCallback(() => setDetail(null), []);
  const resetView = useCallback(() => {
    setMine("total");
    setStart("");
    setEnd("");
    setDetail(null);
  }, []);
  const backend = useMiningData(settings, start, end, degree, resetView);
  const {
    dataset,
    connection,
    refreshed,
    refreshing,
    poll,
    setPoll,
    analyzing,
  } = backend;
  const error = reportError || backend.error;
  const filtered = backend.analysis?.dataset ?? {
    dates: [],
    mines: [],
    source: dataset.source,
  };
  const series = backend.analysis?.series ?? [];
  const refresh = useCallback(async () => {
    setReportError("");
    if (!backend.kind || backend.kind === "csv") {
      setSourceOpen(true);
      return;
    }
    await backend.refresh().catch(() => {});
  }, [backend.kind, backend.refresh]);
  useEffect(() => setPage(0), [settings, start, end, mine, method, dataset]);
  useEffect(() => {
    if (
      mine !== "total" &&
      mine !== "all" &&
      dataset.mines.length &&
      !dataset.mines.some((m) => m.id === mine)
    )
      setMine("total");
  }, [dataset, mine]);
  const shown = useMemo(
    () =>
      mine === "all" ? series.slice(1) : series.filter((s) => s.id === mine),
    [series, mine],
  );
  const anomalies = useMemo(
    () =>
      shown
        .flatMap((s) =>
          s.analysis.anomalies.map((a) => ({
            series: s,
            anomaly: a,
            date: filtered.dates[a.index],
          })),
        )
        .filter(
          (x) =>
            method === "all" ||
            x.anomaly.evidence.some((e) => e.test === method),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            a.series.name.localeCompare(b.series.name),
        ),
    [shown, method, filtered.dates],
  );
  const flaggedMineDays = backend.analysis?.flaggedMineDays ?? 0,
    summary = series[0]?.analysis.summary;
  const update = (key: keyof DetectorSettings, value: number) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const toggle = (test: TestName) =>
    setSettings((s) => ({
      ...s,
      enabled: s.enabled.includes(test)
        ? s.enabled.filter((t) => t !== test)
        : [...s.enabled, test],
    }));
  async function exportReport() {
    setReporting(true);
    setReportError("");
    try {
      const blob = await requestPdf({
        dataset,
        settings,
        startDate: start || null,
        endDate: end || null,
        degree,
        mode,
        trend,
        snapshotAt: refreshed,
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `WY-extraction-${filtered.dates[0]}-${filtered.dates.at(-1)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      setReportError(
        error instanceof Error ? error.message : "Unable to generate report.",
      );
    } finally {
      setReporting(false);
    }
  }
  return (
    <div className="page">
      <a className="skip-link" href="#main">
        Skip to dashboard
      </a>
      <aside
        className="navbar navbar-vertical navbar-expand-lg app-sidebar"
        data-bs-theme="dark"
      >
        <div className="container-fluid">
          <button
            className="navbar-toggler"
            type="button"
            aria-label="Toggle navigation"
            aria-controls="sidebar-menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="navbar-toggler-icon" />
          </button>
          <a
            className="navbar-brand navbar-brand-autodark"
            href="#overview"
            aria-label="Weyland-Yutani home"
          >
            <img
              src="/branding/weyland-yutani.png"
              alt="Weyland-Yutani Corporation"
              width={224}
              height={105}
              className="brand-logo"
            />
          </a>
          <div
            className={`collapse navbar-collapse ${menuOpen ? "show" : ""}`}
            id="sidebar-menu"
          >
            <ul
              className="navbar-nav pt-lg-3"
              aria-label="Dashboard navigation"
            >
              {[
                { id: "overview", label: "Overview", icon: LayoutDashboard },
                { id: "anomalies", label: "Anomaly log", icon: TriangleAlert },
                { id: "statistics", label: "Mine statistics", icon: BarChart3 },
              ].map(({ id, label, icon: Icon }) => (
                <li
                  key={id}
                  className={`nav-item ${activeSection === id ? "active" : ""}`}
                >
                  <a
                    className="nav-link"
                    href={`#${id}`}
                    aria-current={activeSection === id ? "location" : undefined}
                    onClick={() => {
                      setActiveSection(id);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="nav-link-icon">
                      <Icon size={20} />
                    </span>
                    <span className="nav-link-title">{label}</span>
                    {id === "anomalies" && (
                      <span className="badge nav-count ms-auto">
                        {flaggedMineDays}
                      </span>
                    )}
                  </a>
                </li>
              ))}
              <li className="nav-item mt-lg-3">
                <span className="nav-link text-secondary small">
                  DATA SOURCE
                </span>
              </li>
              <li className="nav-item">
                <a className="nav-link" href="/generator.xlsx" download>
                  <span className="nav-link-icon">
                    <FileSpreadsheet size={20} />
                  </span>
                  <span className="nav-link-title flex-grow-1">
                    Generator workbook
                  </span>
                  <Download size={15} className="ms-auto flex-shrink-0" />
                </a>
              </li>
              <li className="nav-item">
                <button
                  className="nav-link w-100"
                  onClick={() => {
                    setSourceOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  <span className="nav-link-icon">
                    <Database size={20} />
                  </span>
                  <span className="nav-link-title text-start">
                    Manage source
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
      <div className="page-wrapper">
        <div
          className="page-header d-print-none operations-header"
          id="overview"
        >
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h1 className="page-title">Mining operations</h1>
              </div>
              <div className="col-auto ms-auto">
                <div className="btn-list">
                  <button
                    className="btn"
                    onClick={refresh}
                    disabled={refreshing}
                    aria-label={
                      refreshing
                        ? "Refreshing…"
                        : !backend.kind
                          ? "Connect source"
                          : backend.kind === "csv"
                            ? "Replace CSV"
                            : "Refresh data"
                    }
                  >
                    {!backend.kind ? (
                      <Database size={17} />
                    ) : (
                      <RefreshCw
                        size={17}
                        className={refreshing ? "spin" : ""}
                      />
                    )}
                    <span className="d-none d-sm-inline">
                      {refreshing
                        ? "Refreshing…"
                        : !backend.kind
                          ? "Connect source"
                          : backend.kind === "csv"
                            ? "Replace CSV"
                            : "Refresh data"}
                    </span>
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={exportReport}
                    aria-label={reporting ? "Building report…" : "Export PDF"}
                    disabled={
                      reporting ||
                      refreshing ||
                      analyzing ||
                      Boolean(backend.analysisError) ||
                      !summary
                    }
                  >
                    <Download size={17} />
                    <span className="d-none d-sm-inline">
                      {reporting ? "Building report…" : "Export PDF"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <main className="page-body" id="main">
          <div className="container-xl d-flex flex-column gap-3">
            <section
              className="card source-card"
              aria-label="Source and date range"
            >
              <div className="card-body py-3">
                <div className="row g-3 align-items-center">
                  <div className="col-auto">
                    <span className="avatar source-icon">
                      <Database size={22} />
                    </span>
                  </div>
                  <div className="col source-description">
                    <div className="fw-semibold">
                      {!dataset.dates.length
                        ? refreshing
                          ? "Loading data…"
                          : "No source connected"
                        : connection
                          ? "Google Sheets connected"
                          : "CSV snapshot"}
                    </div>
                    <div className="text-secondary small source-name">
                      {dataset.mines.length} mines · {dataset.dates.length} days
                      {dataset.source ? ` · ${dataset.source}` : ""}
                    </div>
                  </div>
                  <div className="col-auto source-actions">
                    {refreshed && (
                      <span className="text-secondary small">
                        Updated{" "}
                        {new Date(refreshed).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {connection && (
                      <label className="form-check form-switch m-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={poll}
                          onChange={(e) => setPoll(e.target.checked)}
                        />
                        <span className="form-check-label small">
                          Auto refresh / 60s
                        </span>
                      </label>
                    )}
                    <button
                      className="btn btn-sm"
                      onClick={() => setSourceOpen(true)}
                    >
                      Manage source
                    </button>
                  </div>
                </div>
              </div>
              <div className="card-body py-3 border-top">
                <div className="analysis-filters">
                  <div className="text-secondary d-flex align-items-center gap-2">
                    <SlidersHorizontal size={17} />
                    <span>Analysis window</span>
                  </div>
                  <label className="date-filter">
                    <span className="text-secondary">From</span>
                    <input
                      className="form-control form-control-sm"
                      type="date"
                      aria-label="Start date"
                      disabled={!dataset.dates.length}
                      min={dataset.dates[0]}
                      max={dataset.dates.at(-1)}
                      value={start || dataset.dates[0] || ""}
                      onChange={(e) => {
                        setStart(e.target.value);
                        if (end && e.target.value > end) setEnd(e.target.value);
                      }}
                    />
                  </label>
                  <label className="date-filter">
                    <span className="text-secondary">To</span>
                    <input
                      className="form-control form-control-sm"
                      type="date"
                      aria-label="End date"
                      disabled={!dataset.dates.length}
                      min={dataset.dates[0]}
                      max={dataset.dates.at(-1)}
                      value={end || dataset.dates.at(-1) || ""}
                      onChange={(e) => {
                        setEnd(e.target.value);
                        if (start && e.target.value < start)
                          setStart(e.target.value);
                      }}
                    />
                  </label>
                  <button
                    className="btn btn-sm"
                    disabled={!dataset.dates.length}
                    onClick={() => {
                      setStart("");
                      setEnd("");
                    }}
                  >
                    Full range
                  </button>
                  <div
                    className="analysis-status text-secondary small ms-lg-auto"
                    role="status"
                    aria-live="polite"
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw size={14} className="spin" />
                        Updating analysis…
                      </>
                    ) : backend.analysisError ? (
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={backend.retryAnalysis}
                      >
                        Retry analysis
                      </button>
                    ) : backend.analysis ? (
                      <>
                        <Check size={15} className="text-success" />
                        Analysis up to date
                      </>
                    ) : (
                      "Choose a data source"
                    )}
                  </div>
                </div>
              </div>
            </section>
            {error && (
              <div className="alert alert-danger mb-0" role="alert">
                <TriangleAlert size={20} className="me-2 flex-shrink-0" />
                {error}
              </div>
            )}
            {!summary ? (
              <div className="card">
                <div className="empty">
                  <div className="empty-icon">
                    <Database size={40} />
                  </div>
                  <h2 className="empty-title">
                    {analyzing
                      ? "Analyzing data…"
                      : !dataset.dates.length
                        ? refreshing
                          ? "Loading data…"
                          : "Connect a data source"
                        : "No observations in this window"}
                  </h2>
                  {dataset.dates.length > 0 && !analyzing && (
                    <p className="empty-subtitle text-secondary">
                      Choose dates within the source range.
                    </p>
                  )}
                  <div className="empty-action">
                    <button
                      className="btn btn-primary"
                      disabled={refreshing || analyzing}
                      onClick={() => {
                        if (!dataset.dates.length) setSourceOpen(true);
                        else {
                          setStart("");
                          setEnd("");
                        }
                      }}
                    >
                      {!dataset.dates.length ? "Manage source" : "Reset dates"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="row row-deck g-3">
                  {[
                    {
                      label: "Fleet extraction",
                      value: number(summary.sum / 1000, 1),
                      unit: "kt",
                      icon: Layers,
                    },
                    {
                      label: "Mean daily output",
                      value: number(summary.mean),
                      unit: "t/day",
                      icon: Activity,
                    },
                    {
                      label: "Daily standard deviation",
                      value: number(summary.sd),
                      unit: summary.sd === null ? "" : "t/day",
                      icon: BarChart3,
                    },
                    {
                      label: "Flagged mine-days",
                      value: number(flaggedMineDays),
                      unit: "",
                      icon: TriangleAlert,
                    },
                  ].map(({ label, value, unit, icon: Icon }) => (
                    <div className="col-6 col-xl-3" key={label}>
                      <article className="card metric-card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                            <div className="subheader">{label}</div>
                            <span className="metric-icon">
                              <Icon size={20} />
                            </span>
                          </div>
                          <div className="h1 mb-1 metric-value">
                            {value}
                            <span className="text-secondary fs-4 fw-normal ms-1">
                              {unit}
                            </span>
                          </div>
                        </div>
                      </article>
                    </div>
                  ))}
                </div>
                <div className="row g-3">
                  <div className="col-12 col-xl-8">
                    <section className="card h-100">
                      <div className="card-header flex-wrap gap-3">
                        <div>
                          <h2 className="card-title">Daily extraction</h2>
                        </div>
                        <label className="ms-auto mine-selector">
                          <span className="visually-hidden">Chart mine</span>
                          <select
                            className="form-select form-select-sm"
                            aria-label="Chart mine"
                            value={mine}
                            onChange={(e) => setMine(e.target.value)}
                          >
                            <option value="total">Fleet total</option>
                            <option value="all">All mines</option>
                            {filtered.mines.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="card-body">
                        <div className="chart-toolbar mb-3">
                          <div
                            className="btn-group"
                            role="group"
                            aria-label="Chart type"
                          >
                            {(
                              [
                                ["line", "Line", LineChart],
                                ["bar", "Bar", BarChart3],
                                ["stacked", "Stacked", Layers],
                              ] as const
                            ).map(([id, label, Icon]) => (
                              <button
                                key={id}
                                className={`btn btn-sm ${mode === id ? "btn-primary" : ""}`}
                                aria-pressed={mode === id}
                                aria-label={`${label} chart`}
                                onClick={() => setMode(id)}
                              >
                                <Icon size={16} />
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <label className="form-check form-switch m-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={trend}
                                onChange={(e) => setTrend(e.target.checked)}
                              />
                              <span className="form-check-label">
                                Trendline
                              </span>
                            </label>
                            <select
                              className="form-select form-select-sm degree-select"
                              aria-label="Polynomial degree"
                              value={degree}
                              disabled={!trend}
                              onChange={(e) =>
                                setDegree(Number(e.target.value))
                              }
                            >
                              {[1, 2, 3, 4].map((d) => (
                                <option key={d} value={d}>
                                  Degree {d}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <ProductionChart
                          dates={filtered.dates}
                          series={shown}
                          mode={mode}
                          degree={backend.analysis?.effectiveDegree ?? degree}
                          fleetTrend={series[0]?.trend ?? []}
                          trend={trend}
                          height={360}
                        />
                        <div className="chart-legend mt-3">
                          {shown.map((s) => (
                            <span key={s.id}>
                              <i
                                className="legend-dot"
                                style={{ background: seriesColor(s.id) }}
                              />
                              {s.name}
                            </span>
                          ))}
                          <span>
                            <i className="legend-dot bg-danger" />
                            Spike
                          </span>
                          <span>
                            <i className="legend-dot bg-cyan" />
                            Drop
                          </span>
                          {trend && (
                            <span>
                              <i className="legend-trend" />
                              Polynomial trend
                            </span>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
                  <div className="col-12 col-xl-4">
                    <aside className="card h-100">
                      <div className="card-header">
                        <h2 className="card-title">Detection settings</h2>
                        <Settings2
                          size={19}
                          className="text-secondary ms-auto"
                        />
                      </div>
                      <div className="card-body">
                        <div className="row g-3">
                          {testNames.map((test, i) => (
                            <div
                              key={test}
                              className="col-12 col-sm-6 col-xl-12"
                            >
                              <div className="detector-setting">
                                <div className="detector-heading d-flex align-items-center justify-content-between gap-3 mb-2">
                                  <div className="d-flex align-items-center gap-1">
                                    <span className="fw-semibold">{test}</span>
                                    <span
                                      className="detector-help"
                                      onMouseEnter={() => setActiveHelp(test)}
                                      onMouseLeave={(event) => {
                                        if (
                                          !event.currentTarget
                                            .querySelector("button")
                                            ?.matches(":focus-visible")
                                        ) {
                                          setActiveHelp((current) =>
                                            current === test ? null : current,
                                          );
                                        }
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className="detector-help-button"
                                        aria-label={`About ${test}`}
                                        aria-expanded={activeHelp === test}
                                        aria-describedby={
                                          activeHelp === test
                                            ? `detector-help-${i}`
                                            : undefined
                                        }
                                        onClick={() => setActiveHelp(test)}
                                        onFocus={() => setActiveHelp(test)}
                                        onBlur={() =>
                                          setActiveHelp((current) =>
                                            current === test ? null : current,
                                          )
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key === "Escape") {
                                            setActiveHelp(null);
                                            event.stopPropagation();
                                          }
                                        }}
                                      >
                                        ?
                                      </button>
                                      <span
                                        id={`detector-help-${i}`}
                                        role="tooltip"
                                        aria-hidden={activeHelp !== test}
                                        className={`detector-help-text ${activeHelp === test ? "is-open" : ""}`}
                                      >
                                        {detectorDescriptions[test]}
                                      </span>
                                    </span>
                                  </div>
                                  <label className="form-check form-switch p-0 m-0">
                                    <input
                                      className="form-check-input float-none m-0"
                                      type="checkbox"
                                      aria-label={`Enable ${test}`}
                                      checked={settings.enabled.includes(test)}
                                      onChange={() => toggle(test)}
                                    />
                                  </label>
                                </div>
                                <fieldset
                                  disabled={!settings.enabled.includes(test)}
                                >
                                  {test === "IQR" && (
                                    <Numeric
                                      label="IQR multiplier"
                                      value={settings.iqrMultiplier}
                                      min={0}
                                      max={10}
                                      step={0.1}
                                      onChange={(v) =>
                                        update("iqrMultiplier", v)
                                      }
                                    />
                                  )}
                                  {test === "Z-score" && (
                                    <Numeric
                                      label="Z-score threshold"
                                      value={settings.zThreshold}
                                      min={0.1}
                                      max={10}
                                      step={0.1}
                                      onChange={(v) => update("zThreshold", v)}
                                    />
                                  )}
                                  {test === "Moving average" && (
                                    <div className="numeric-pair">
                                      <Numeric
                                        label="Window (days)"
                                        value={settings.maWindow}
                                        min={2}
                                        max={365}
                                        step={1}
                                        onChange={(v) => update("maWindow", v)}
                                      />
                                      <Numeric
                                        label="Distance (%)"
                                        value={settings.maPercent}
                                        min={0}
                                        max={1000}
                                        step={1}
                                        onChange={(v) => update("maPercent", v)}
                                      />
                                    </div>
                                  )}
                                  {test === "Grubbs" && (
                                    <div className="numeric-pair">
                                      <Numeric
                                        label="Alpha"
                                        value={settings.grubbsAlpha}
                                        min={0.001}
                                        max={0.2}
                                        step={0.001}
                                        onChange={(v) =>
                                          update("grubbsAlpha", v)
                                        }
                                      />
                                      <Numeric
                                        label="Max passes"
                                        value={settings.grubbsMax}
                                        min={1}
                                        max={20}
                                        step={1}
                                        onChange={(v) => update("grubbsMax", v)}
                                      />
                                    </div>
                                  )}
                                </fieldset>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="card-footer">
                        <button
                          className="btn btn-sm"
                          onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
                        >
                          <RefreshCw size={15} />
                          Reset defaults
                        </button>
                      </div>
                    </aside>
                  </div>
                </div>
                <section className="card" id="anomalies">
                  <div className="card-header flex-wrap gap-3">
                    <div>
                      <h2 className="card-title">
                        Anomaly log{" "}
                        <span className="badge bg-secondary-lt ms-2">
                          {anomalies.length}
                        </span>
                      </h2>
                    </div>
                    <label className="ms-auto">
                      <span className="visually-hidden">
                        Filter by detection method
                      </span>
                      <select
                        className="form-select form-select-sm"
                        aria-label="Filter by detection method"
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                      >
                        <option value="all">All methods</option>
                        {testNames.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-vcenter card-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Date</th>
                          <th>Mine / series</th>
                          <th className="text-end">Output (t)</th>
                          <th className="text-end">From baseline</th>
                          <th>Detected by</th>
                          <th>
                            <span className="visually-hidden">Details</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {anomalies.slice(page * 8, page * 8 + 8).map((x) => (
                          <tr key={`${x.series.id}-${x.date}`}>
                            <td>
                              <span
                                className={`badge ${x.anomaly.direction === "spike" ? "bg-red-lt" : "bg-cyan-lt"}`}
                              >
                                {x.anomaly.direction === "spike" ? (
                                  <ArrowUpRight size={14} />
                                ) : (
                                  <ArrowDownRight size={14} />
                                )}
                                {x.anomaly.direction}
                              </span>
                            </td>
                            <td className="text-nowrap">{shortDate(x.date)}</td>
                            <td className="mine-cell">{x.series.name}</td>
                            <td className="text-end numeric-cell">
                              {number(x.anomaly.value, 2)}
                            </td>
                            <td
                              className={`text-end numeric-cell ${x.anomaly.direction === "spike" ? "text-danger" : "text-cyan"}`}
                            >
                              {x.anomaly.deviationLabel}
                            </td>
                            <td>
                              <div className="d-flex gap-1 flex-wrap">
                                {x.anomaly.evidence.map((e) => (
                                  <span
                                    className="badge bg-secondary-lt"
                                    key={e.test}
                                  >
                                    {e.test === "Moving average"
                                      ? "MA"
                                      : e.test}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <button
                                className="btn btn-icon btn-sm"
                                aria-label={`Inspect ${x.series.name} on ${x.date}`}
                                onClick={() => setDetail(x)}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!anomalies.length && (
                    <div className="empty py-4">
                      <div className="empty-icon">
                        <Check size={28} />
                      </div>
                      <div className="empty-title">No observations flagged</div>
                      <p className="empty-subtitle text-secondary">
                        Try another mine, date window or detector threshold.
                      </p>
                    </div>
                  )}
                  <div className="card-footer d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <div className="text-secondary small">
                      {anomalies.length
                        ? `${page * 8 + 1}–${Math.min(page * 8 + 8, anomalies.length)} of ${anomalies.length} observations`
                        : "0 observations"}
                    </div>
                    <div className="btn-group">
                      <button
                        className="btn btn-sm btn-icon"
                        aria-label="Previous anomaly page"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        className="btn btn-sm btn-icon"
                        aria-label="Next anomaly page"
                        disabled={(page + 1) * 8 >= anomalies.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                </section>
                <section className="card" id="statistics">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">Mine statistics</h2>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-vcenter card-table">
                      <thead>
                        <tr>
                          <th>Mine / series</th>
                          <th className="text-end">Mean</th>
                          <th className="text-end">Std. deviation</th>
                          <th className="text-end">Median</th>
                          <th className="text-end">IQR</th>
                          <th className="text-end">Flagged days</th>
                          <th>Production profile</th>
                        </tr>
                      </thead>
                      <tbody>
                        {series.map((s, j) => (
                          <tr
                            key={s.id}
                            className={j === 0 ? "fw-semibold" : ""}
                          >
                            <td>
                              <span className="d-flex align-items-center gap-2 mine-cell">
                                <i
                                  className="legend-dot"
                                  style={{ background: seriesColor(s.id) }}
                                />
                                {s.name}
                              </span>
                            </td>
                            <td className="text-end numeric-cell">
                              {number(s.analysis.summary.mean, 2)}
                            </td>
                            <td className="text-end numeric-cell">
                              {number(s.analysis.summary.sd, 2)}
                            </td>
                            <td className="text-end numeric-cell">
                              {number(s.analysis.summary.median, 2)}
                            </td>
                            <td className="text-end numeric-cell">
                              {number(s.analysis.summary.iqr, 2)}
                            </td>
                            <td className="text-end numeric-cell">
                              {s.analysis.anomalies.length}
                            </td>
                            <td>
                              <Sparkline
                                values={s.values.filter(
                                  (_, i) =>
                                    i %
                                      Math.max(
                                        1,
                                        Math.floor(s.values.length / 40),
                                      ) ===
                                    0,
                                )}
                                color={seriesColor(s.id)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
      {sourceOpen && (
        <SourceDialog
          onClose={closeSource}
          onUpload={backend.uploadCsv}
          onConnect={backend.connectSheet}
          connection={connection}
        />
      )}
      {detail && (
        <Modal title="Observation details" onClose={closeDetail} wide>
          <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h3 className="mb-1">{detail.series.name}</h3>
              <div className="text-secondary">{shortDate(detail.date)}</div>
            </div>
            <span
              className={`badge ${detail.anomaly.direction === "spike" ? "bg-red-lt" : "bg-cyan-lt"}`}
            >
              {detail.anomaly.direction}
            </span>
          </div>
          <div className="row g-3 mb-4">
            <div className="col-sm-6">
              <div className="subheader">Daily output</div>
              <div className="h2 mb-0">
                {number(detail.anomaly.value, 2)}{" "}
                <span className="text-secondary fs-4 fw-normal">tonnes</span>
              </div>
            </div>
            <div className="col-sm-6">
              <div className="subheader">Comparison baseline</div>
              <div className="h2 mb-0">
                {number(detail.anomaly.baseline, 2)}{" "}
                <span className="text-secondary fs-4 fw-normal">t/day</span>
              </div>
              <div className="text-secondary small">
                {detail.anomaly.baselineDescription}
              </div>
            </div>
          </div>
          <h3 className="h4">Detector evidence</h3>
          <div className="list-group list-group-flush mb-3">
            {detail.anomaly.evidence.map((e) => (
              <div className="list-group-item px-0" key={e.test}>
                <div className="fw-semibold mb-1">{e.test}</div>
                <p className="mb-1">{e.detail}</p>
                <div className="text-secondary small">
                  Score: {e.unbounded ? "∞" : number(e.score, 3)} · threshold:{" "}
                  {number(e.threshold, 3)} · reference: {number(e.baseline, 2)}{" "}
                  t/day
                </div>
              </div>
            ))}
          </div>
          <p className="text-secondary small mb-0">
            A detection is a statistical flag. It does not establish the
            operational cause of a spike or drop.
          </p>
        </Modal>
      )}
    </div>
  );
}
