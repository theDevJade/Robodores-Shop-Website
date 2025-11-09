import { useState } from "react";
import { api } from "../api";

const ensureCsv = (name: string) => {
  const trimmed = name.trim() || "export";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
};

export type ExportSection =
  | "attendance"
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
};

export function ExportPanel({ section, defaultName, helper }: Props) {
  const [filename, setFilename] = useState(defaultName);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
    </div>
  );
}
