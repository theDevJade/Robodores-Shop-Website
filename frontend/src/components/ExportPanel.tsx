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
  const [modalOpen, setModalOpen] = useState(false);
  const [csvTab, setCsvTab] = useState<"export" | "import">("export");
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
    } catch (error: any) {
      setImportStatus({
        t: "err",
        m: error?.response?.data?.detail || error?.message || "Import failed",
      });
    } finally {
      setImporting(false);
    }
  }

  const closeModal = () => {
    setModalOpen(false);
    setCsvTab("export");
    setStatus(null);
    setImportStatus(null);
    setImportFile(null);
    setImportAllRows(true);
    setRangeStart("1");
    setRangeEnd("");
    if (importInputRef.current) importInputRef.current.value = "";
  };

  return (
    <>
      <div className="export-panel">
        <div className="export-panel__header">
          <div>
            <p className="export-panel__title">CSV Options</p>
            {helper && <small className="export-panel__helper">{helper}</small>}
          </div>
          <div className="csv-note">CSV files are spreadsheets from Excel, Sheets, etc.</div>
          <button type="button" className="button-surface" onClick={() => { setCsvTab("export"); setModalOpen(true); }}>
            CSV Options
          </button>
        </div>
      </div>
      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal card csv-modal">
            <div className="csv-modal__top">
              <div>
                <p className="export-panel__title">Data Tools</p>
                <h3>CSV Options</h3>
              </div>
              <button className="refresh-btn" type="button" onClick={closeModal}>
                Close
              </button>
            </div>
            <div className="csv-modal__tabs">
              <button
                type="button"
                className={csvTab === "export" ? "active" : ""}
                onClick={() => setCsvTab("export")}
              >
                Export
              </button>
              <button
                type="button"
                className={csvTab === "import" ? "active" : ""}
                disabled={!importConfig}
                onClick={() => importConfig && setCsvTab("import")}
              >
                Import
              </button>
            </div>
            {csvTab === "export" && (
              <div className="csv-modal__content">
                <label>
                  File name
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder={defaultName}
                  />
                </label>
                <button type="button" className="button-primary" onClick={handleExport} disabled={downloading}>
                  {downloading ? "Preparing..." : "Download CSV"}
                </button>
                {status && <div className="notice ok">{status}</div>}
              </div>
            )}
            {csvTab === "import" && importConfig ? (
              <div className="csv-modal__content">
                <label>
                  CSV file
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] ?? null);
                      setImportStatus(null);
                    }}
                  />
                  <small className="export-panel__helper">Use .csv spreadsheet files exported from Excel/Sheets.</small>
                </label>
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
                  <div className="export-panel__range export-panel__range--modal">
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
                  importConfig.supportsRange && <p className="stat-muted">Entire file will be imported.</p>
                )}
                {!importConfig.supportsRange && (
                  <p className="stat-muted">Import will include every row in the CSV.</p>
                )}
                <button type="button" className="button-primary" onClick={handleImport} disabled={importing}>
                  {importing ? "Importing..." : "Import CSV"}
                </button>
                {importStatus && <div className={`notice ${importStatus.t}`}>{importStatus.m}</div>}
              </div>
            ) : (
              csvTab === "import" && (
                <div className="csv-modal__content">
                  <p className="stat-muted">Import is not available for this section.</p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
