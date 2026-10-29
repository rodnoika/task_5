export type Mine = { id: string; name: string; values: number[] };
export type Dataset = { dates: string[]; mines: Mine[]; source: string };
export type TestName = "IQR" | "Z-score" | "Moving average" | "Grubbs";
export type DetectorSettings = {
  iqrMultiplier: number;
  zThreshold: number;
  maWindow: number;
  maPercent: number;
  grubbsAlpha: number;
  grubbsMax: number;
  enabled: TestName[];
};
export type Summary = {
  n: number;
  sum: number;
  mean: number;
  sd: number | null;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
};
export type Evidence = {
  test: TestName;
  score: number | null;
  threshold: number;
  baseline: number;
  detail: string;
  unbounded: boolean;
};
export type Anomaly = {
  index: number;
  value: number;
  direction: "spike" | "drop";
  baseline: number;
  evidence: Evidence[];
  stackedValue: number;
  deviationPercent: number | null;
  deviationLabel: string;
  baselineDescription: string;
};
export type SeriesAnalysis = {
  summary: Summary;
  anomalies: Anomaly[];
  movingAverage: (number | null)[];
};
export type ChartMode = "line" | "bar" | "stacked";
export type AnalyzedMine = Mine & { analysis: SeriesAnalysis; trend: number[] };
export type AnalysisResponse = {
  dataset: Dataset;
  series: AnalyzedMine[];
  flaggedMineDays: number;
  effectiveDegree: number;
};
export type SourceResponse = { dataset: Dataset; fetchedAt: string };
export type SheetLink = { reference: string; gid?: string };
export const DEFAULT_SETTINGS: DetectorSettings = {
  iqrMultiplier: 1.5,
  zThreshold: 3,
  maWindow: 7,
  maPercent: 45,
  grubbsAlpha: 0.05,
  grubbsMax: 1,
  enabled: ["IQR", "Z-score", "Moving average", "Grubbs"],
};
export const PALETTE = [
  "#206bc4",
  "#2fb344",
  "#f76707",
  "#ae3ec9",
  "#0ca6c7",
  "#d63939",
  "#4263eb",
  "#f59f00",
  "#1098ad",
  "#e64980",
  "#74b816",
  "#6741d9",
];
export function seriesColor(id: string): string {
  if (id === "total") return PALETTE[0];
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return PALETTE[(hash >>> 0) % PALETTE.length];
}
