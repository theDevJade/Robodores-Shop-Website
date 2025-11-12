import { useRef, useState } from "react";
import { api } from "../api";
import { parseCsv, CsvRecord } from "../utils/csv";

const ensureCsv = (name: string) => {
  const trimmed = name.trim() || "export";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
};

export type ExportSection =
  | "attendance"
  | "manufacturing"
  | "cnc"
  | "printing"
  | "orders"
  | "inventory"
  | "tickets_feature"
  | "tickets_issue";

type Props = {
  section: ExportSection;
  defaultName: string;
  helper?: string;
  importConfig?: ImportConfig;
};

type ImportConfig = {
  label?: string;
  helper?: string;
  endpoint?: string;
  supportsRange?: boolean;
  onProcessRows?: (records: CsvRecord[], range: { start: number; end: number }) => Promise<void>;
};

export function ExportPanel({ section, defaultName, helper, importConfig }: Props) {
  const [filename, setFilename] = useState(defaultName);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [rangeStart, setRangeStart] = useState<string>("1");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [importAllRows, setImportAllRows] = useState(true);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const ensureFileSelected = () => {
    if (importFile) return true;
    setImportStatus({ t: "err", m: "Choose a CSV file first." });
    return false;
  };

  const openImportModal = () => {
    if (!ensureFileSelected()) return;
    setImportStatus(null);
    setImportModalOpen(true);
  };

  async function handleExport() {
    setDownloading(true);
    setStatus(null);
    try {
      const res = await api.get(`/exports/${section}`, {
        params: { filename },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = ensureCsv(filename || defaultName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus("Export ready");
      setTimeout(() => setStatus(null), 2500);
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  async function handleImport() {
    if (!importConfig) return;
    if (!importFile) {
      setImportStatus({ t: "err", m: "Select a CSV file first." });
      return;
    }
    setImporting(true);
    setImportStatus(null);
    const start = importAllRows ? 1 : Math.max(1, Number.parseInt(rangeStart || "1", 10));
    const end = importAllRows ? null : rangeEnd ? Math.max(start, Number.parseInt(rangeEnd, 10)) : null;
    try {
      if (importConfig.onProcessRows) {
        const text = await importFile.text();
        const { records } = parseCsv(text);
        if (!records.length) throw new Error("No data rows found in CSV.");
        const upper = end ? Math.min(end, records.length) : records.length;
        const slice = records.slice(start - 1, upper);
        if (!slice.length) throw new Error("Selected range has no data rows.");
        await importConfig.onProcessRows(slice, { start, end: upper });
      } else {
        const endpoint = importConfig.endpoint ?? `/imports/${section}`;
        const body = new FormData();
        body.append("file", importFile);
        if (importConfig.supportsRange) {
          body.append("range_start", String(start));
          if (end) body.append("range_end", String(end));
        }
        await api.post(endpoint, body, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      setImportStatus({ t: "ok", m: "Import complete" });
      setImportFile(null);
      if (importInputRef.current) importInputRef.current.value = "";
      setImportModalOpen(false);
    } catch (error: any) {
      setImportStatus({
        t: "err",
        m: error?.response?.data?.detail || error?.message || "Import failed",
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="export-panel">
      <div>
        <p className="export-panel__title">Download CSV</p>
        {helper && <small className="export-panel__helper">{helper}</small>}
      </div>
      <div className="export-panel__controls">
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="attendance-report"
        />
        <button type="button" onClick={handleExport} disabled={downloading}>
          {downloading ? "Preparing..." : "Export CSV"}
        </button>
      </div>
      {status && <div className="notice ok" style={{ marginTop: 8 }}>{status}</div>}
      {importConfig && (
        <div className="export-panel__import">
          <div>
            <p className="export-panel__title">{importConfig.label ?? "Import CSV"}</p>
            {importConfig.helper && <small className="export-panel__helper">{importConfig.helper}</small>}
          </div>
          <div className="export-panel__fileRow">
            <input
              ref={importInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] ?? null);
                setImportStatus(null);
                setImportModalOpen(false);
              }}
            />
            <button type="button" onClick={openImportModal} disabled={importing}>
              Import CSV
            </button>
          </div>
          {importStatus && <div className={`notice ${importStatus.t}`} style={{ marginTop: 8 }}>{importStatus.m}</div>}
        </div>
      )}
      {importConfig && importModalOpen && (
        <div className="modal-backdrop">
          <div className="modal card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div>
                <p className="brand-text" style={{ margin: 0, textTransform: "uppercase", letterSpacing: "0.2em" }}>
                  CSV Import
                </p>
                <h3 style={{ margin: "0.2rem 0 0" }}>{importConfig.label ?? "Import CSV"}</h3>
              </div>
              <button className="refresh-btn" type="button" onClick={() => setImportModalOpen(false)}>
                Close
              </button>
            </div>
            {importConfig.supportsRange && (
              <label className="import-toggle">
                <input
                  type="checkbox"
                  checked={importAllRows}
                  onChange={(e) => setImportAllRows(e.target.checked)}
                />
                <span>Use all rows</span>
              </label>
            )}
            {importConfig.supportsRange && !importAllRows ? (
              <div className="export-panel__range export-panel__range--modal" style={{ marginTop: "1rem" }}>
                <label>
                  From row
                  <input
                    type="number"
                    min={1}
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                  />
                </label>
                <label>
                  To row
                  <input
                    type="number"
                    min={Number(rangeStart || "1")}
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    placeholder="End"
                  />
                </label>
              </div>
            ) : (
              <p className="stat-muted" style={{ marginTop: "1rem" }}>
                Import will include every row in the CSV.
              </p>
            )}
            <div className="form-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="button-primary" onClick={handleImport} disabled={importing}>
                {importing ? "Importing..." : "Import"}
              </button>
              <button type="button" onClick={() => setImportModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
