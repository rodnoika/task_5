"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  seriesColor,
  type Mine,
  type SeriesAnalysis,
  type ChartMode,
} from "@/lib/types";
export type ChartSeries = Mine & { analysis: SeriesAnalysis; trend: number[] };
export default function ProductionChart({
  dates,
  series,
  mode,
  degree,
  fleetTrend,
  trend = true,
  height = 340,
}: {
  dates: string[];
  series: ChartSeries[];
  mode: ChartMode;
  degree: number;
  fleetTrend: number[];
  trend?: boolean;
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const data = useMemo(() => {
    const selectedTrend = series.length === 1 ? series[0].trend : fleetTrend;
    return dates.map((date, i) => {
      const row: Record<string, string | number> = { date };
      series.forEach((s) => {
        row[s.id] = s.values[i];
        row[s.id + "-trend"] = s.trend[i];
      });
      row["fleet-trend"] = selectedTrend[i];
      return row;
    });
  }, [dates, series, fleetTrend]);
  if (!mounted)
    return (
      <div style={{ height }} className="chart-loading">
        Preparing production chart…
      </div>
    );
  return (
    <div
      className="production-chart"
      role="img"
      aria-label={`${mode} chart of daily extraction for ${series.map((s) => s.name).join(", ")} with anomaly markers${trend ? ` and degree ${degree} polynomial trends` : ""}`}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart
          data={data}
          margin={{ top: 18, right: 16, left: 0, bottom: 8 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--chart-grid)"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => String(d).slice(5)}
            minTickGap={48}
            tick={{ fontSize: 11, fill: "var(--chart-label)" }}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            width={58}
            tickFormatter={(v) =>
              new Intl.NumberFormat("en", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v)
            }
            tick={{ fontSize: 11, fill: "var(--chart-label)" }}
            tickLine={false}
            axisLine={false}
            domain={[0, "auto"]}
          />
          <Tooltip
            labelFormatter={(v) => String(v)}
            formatter={(value, name) => [
              `${Number(value).toLocaleString("en", { maximumFractionDigits: 2 })} t`,
              String(name),
            ]}
            contentStyle={{
              background: "var(--tblr-bg-surface)",
              border: "1px solid var(--tblr-border-active-color)",
              borderRadius: 2,
              color: "#fff",
              fontSize: 12,
            }}
            labelStyle={{ color: "#c2cbd5", marginBottom: 8 }}
            itemStyle={{ color: "#fff" }}
          />
          {series.map((s) =>
            mode === "bar" ? (
              <Bar
                key={s.id}
                dataKey={s.id}
                name={s.name}
                fill={seriesColor(s.id)}
                fillOpacity={0.7}
                radius={[2, 2, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
            ) : mode === "stacked" ? (
              <Area
                key={s.id}
                dataKey={s.id}
                name={s.name}
                stackId="mines"
                type="linear"
                stroke={seriesColor(s.id)}
                fill={seriesColor(s.id)}
                fillOpacity={0.28}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ) : (
              <Area
                key={s.id}
                dataKey={s.id}
                name={s.name}
                type="linear"
                stroke={seriesColor(s.id)}
                fill={seriesColor(s.id)}
                fillOpacity={series.length === 1 ? 0.09 : 0}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ),
          )}
          {trend &&
            (mode === "stacked" ? (
              <Line
                dataKey="fleet-trend"
                name={`Fleet trend (degree ${degree})`}
                stroke="var(--chart-trend)"
                strokeWidth={1.8}
                strokeDasharray="6 5"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : (
              series.map((s) => (
                <Line
                  key={s.id + "-trend"}
                  dataKey={s.id + "-trend"}
                  name={`${s.name} trend`}
                  stroke={
                    series.length === 1
                      ? "var(--chart-trend)"
                      : seriesColor(s.id)
                  }
                  strokeWidth={1.6}
                  strokeDasharray="6 5"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))
            ))}
          {series.flatMap((s) =>
            s.analysis.anomalies.map((a) => {
              const y =
                mode === "stacked" && series.length > 1
                  ? a.stackedValue
                  : a.value;
              return (
                <ReferenceDot
                  key={`${s.id}-${a.index}`}
                  x={dates[a.index]}
                  y={y}
                  r={4}
                  fill={a.direction === "spike" ? "#d63939" : "#0ca6c7"}
                  stroke="var(--tblr-bg-surface)"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              );
            }),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
