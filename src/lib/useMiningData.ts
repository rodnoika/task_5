"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "./api";
import type {
  AnalysisResponse,
  Dataset,
  DetectorSettings,
  SheetLink,
  SourceResponse,
} from "./types";

const EMPTY: Dataset = { dates: [], mines: [], source: "" };
type SourceKind = "sheets" | "csv";

export function useMiningData(
  settings: DetectorSettings,
  start: string,
  end: string,
  degree: number,
  resetView: () => void,
) {
  const [dataset, setDataset] = useState<Dataset>(EMPTY),
    [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [connection, setConnection] = useState<SheetLink | null>(null),
    [kind, setKind] = useState<SourceKind | null>(null);
  const [refreshed, setRefreshed] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [poll, setPoll] = useState(false);
  const [sourceError, setSourceError] = useState(""),
    [analysisError, setAnalysisError] = useState(""),
    [analyzing, setAnalyzing] = useState(false),
    [revision, setRevision] = useState(0);
  const sourceVersion = useRef(0),
    sourceAbort = useRef<AbortController | null>(null),
    sourceBusy = useRef(false);

  const loadSource = useCallback(
    async (source: SourceKind, body: unknown, replace: boolean) => {
      if (!replace && sourceBusy.current) return;
      if (replace) setPoll(false);
      sourceAbort.current?.abort();
      const controller = new AbortController(),
        version = ++sourceVersion.current;
      sourceAbort.current = controller;
      sourceBusy.current = true;
      setRefreshing(true);
      setSourceError("");
      try {
        const path = `/api/datasets/${source}`;
        const result = await requestJson<SourceResponse>(
          path,
          body,
          controller.signal,
        );
        if (version !== sourceVersion.current) return;
        setDataset(result.dataset);
        setRefreshed(result.fetchedAt);
        setKind(source);
        setConnection(source === "sheets" ? (body as SheetLink) : null);
        if (replace) resetView();
      } catch (error) {
        if (controller.signal.aborted || version !== sourceVersion.current)
          return;
        setSourceError(
          error instanceof Error ? error.message : "Could not load the source.",
        );
        throw error;
      } finally {
        if (version === sourceVersion.current) {
          sourceBusy.current = false;
          setRefreshing(false);
        }
      }
    },
    [resetView],
  );

  const connectSheet = useCallback(
    (link: SheetLink) => loadSource("sheets", link, true),
    [loadSource],
  );
  const uploadCsv = useCallback(
    (csv: string, filename: string) =>
      loadSource("csv", { csv, filename }, true),
    [loadSource],
  );
  const refresh = useCallback(async () => {
    if (kind === "sheets" && connection)
      await loadSource("sheets", connection, false);
  }, [kind, connection, loadSource]);

  useEffect(() => () => sourceAbort.current?.abort(), []);
  useEffect(() => {
    if (!poll || !connection) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 60000);
    return () => window.clearInterval(timer);
  }, [poll, connection, refresh]);
  useEffect(() => {
    if (!dataset.dates.length) return;
    const controller = new AbortController();
    setAnalyzing(true);
    setAnalysisError("");
    const timer = window.setTimeout(() => {
      void requestJson<AnalysisResponse>(
        "/api/analyze",
        {
          dataset,
          settings,
          startDate: start || null,
          endDate: end || null,
          degree,
        },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) setAnalysis(result);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setAnalysisError(
              (error instanceof Error ? error.message : "Analysis failed.") +
                " Displayed results are from the previous settings.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setAnalyzing(false);
        });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dataset, settings, start, end, degree, revision]);

  return {
    dataset,
    analysis,
    connection,
    kind,
    refreshed,
    refreshing,
    poll,
    setPoll,
    analyzing,
    analysisError,
    error: sourceError || analysisError,
    connectSheet,
    uploadCsv,
    refresh,
    retryAnalysis: () => setRevision((v) => v + 1),
  };
}
