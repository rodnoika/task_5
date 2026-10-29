"use client";
import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Upload, ArrowUpRight, Download } from "lucide-react";
import Modal from "./Modal";
import type { SheetLink } from "@/lib/types";

const defaultSheetUrl =
  "https://docs.google.com/spreadsheets/d/19zAXIdGYHdn6D8PgXD3aTn7QIa9yrQRjjlGX24x-45g/edit?gid=573832876#gid=573832876";

export default function SourceDialog({
  onClose,
  onUpload,
  onConnect,
  connection,
}: {
  onClose: () => void;
  onUpload: (csv: string, filename: string) => Promise<void>;
  onConnect: (link: SheetLink) => Promise<void>;
  connection: SheetLink | null;
}) {
  const [tab, setTab] = useState("google"),
    [url, setUrl] = useState(connection?.reference ?? defaultSheetUrl),
    [gid, setGid] = useState(connection?.gid ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
      if (alive.current) onClose();
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not load this source.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function connect(event: React.FormEvent) {
    event.preventDefault();
    void run(() => onConnect({ reference: url, gid: gid.trim() || undefined }));
  }
  async function upload(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 4_000_000) throw Error("CSV limit: 4 MB.");
      await onUpload(await file.text(), file.name);
    });
  }
  return (
    <Modal title="Connect a data source" onClose={onClose}>
      <div
        className="nav nav-tabs source-tabs mb-4"
        role="tablist"
        aria-label="Source type"
      >
        {[
          ["google", "Google Sheets", FileSpreadsheet],
          ["csv", "Upload CSV", Upload],
        ].map(([id, label, Icon]) => (
          <button
            key={String(id)}
            id={`source-tab-${id}`}
            className={`nav-link ${tab === id ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`source-panel-${id}`}
            disabled={busy}
            onClick={() => {
              setTab(String(id));
              setError("");
            }}
          >
            {typeof Icon !== "string" && <Icon size={17} className="me-2" />}
            {String(label)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`source-panel-${tab}`}
        aria-labelledby={`source-tab-${tab}`}
      >
        {tab === "google" && (
          <form onSubmit={connect}>
            <div className="source-step mb-3">
              <span className="avatar avatar-sm bg-primary-lt">1</span>
              <div>
                <div className="fw-semibold mb-1">
                  Import the generator into Google Sheets
                </div>
                <p className="text-secondary small mb-2">
                  Set sharing to <strong>Anyone with the link → Editor</strong>.
                </p>
                <a href="/generator.xlsx" className="btn btn-sm" download>
                  <Download size={16} />
                  Download generator workbook
                </a>
              </div>
            </div>
            <div className="source-step mb-4">
              <span className="avatar avatar-sm bg-primary-lt">2</span>
              <div>
                <div className="fw-semibold mb-1">Copy the Data tab URL</div>
                <p className="text-secondary small mb-0">
                  Open the Data tab before copying the address. Its gid selects
                  the table to read.
                </p>
              </div>
            </div>
            <label className="form-label d-block mb-3">
              Spreadsheet URL or ID
              <input
                className="form-control mt-2"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
                required
                disabled={busy}
              />
            </label>
            <label className="form-label d-block mb-4">
              Data tab gid{" "}
              <span className="text-secondary fw-normal">
                (optional if included in URL)
              </span>
              <input
                className="form-control mt-2"
                value={gid}
                onChange={(e) => setGid(e.target.value)}
                inputMode="numeric"
                placeholder="Taken from the Data tab URL"
                disabled={busy}
              />
            </label>
            <button
              className="btn btn-primary w-100"
              type="submit"
              disabled={busy}
            >
              {busy ? "Reading spreadsheet…" : "Connect spreadsheet"}
              <ArrowUpRight size={16} />
            </button>
          </form>
        )}
        {tab === "csv" && (
          <>
            <label className="upload-zone mb-3">
              <Upload size={32} className="text-primary" />
              <strong>Choose a daily production CSV</strong>
              <span className="text-secondary small">
                Date, Total (optional), then one column per mine.
              </span>
              <span className="text-secondary small">
                Dates: YYYY-MM-DD · Nonnegative tonnes · Max 4 MB
              </span>
              <input
                type="file"
                disabled={busy}
                accept=".csv,text/csv"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
            {busy && (
              <p className="text-secondary small" role="status">
                Uploading CSV…
              </p>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="alert alert-danger mt-3 mb-0" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
