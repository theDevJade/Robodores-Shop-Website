import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { api } from "../api";
import { useAuth } from "../auth";

type Summary = { date: string; open_entries: number };
type PanelItem = {
  id: number;
  title: string;
  subtitle?: string;
  status?: string;
  badge?: string;
  note?: string | null;
};
type ManufacturingSummary = {
  total: number;
  urgent: number;
  by_status: Record<string, number>;
};
type DashboardMetrics = {
  attendance?: Summary;
  manufacturing: { total: number; urgent: number; byStatus: Record<string, number>; items: PanelItem[] };
  orders: { total: number; pending: number; items: PanelItem[] };
  attendanceHistory: Array<{ id: number; student_name: string; check_in: string | null; check_out: string | null }>;
};

type Props = {
  onNavigate: (tab: string) => void;
  kiosk?: boolean;
};

export function Dashboard({ onNavigate, kiosk }: Props) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [scanMode, setScanMode] = useState<"in" | "out">("in");
  const idInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const [scanStatus, setScanStatus] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [attendanceRes, summaryRes, manufacturingPartsRes, ordersRes, historyRes] = await Promise.all([
        api.get<Summary>("/attendance/summary/today"),
        api.get<ManufacturingSummary>("/manufacturing/summary"),
        api.get("/manufacturing/parts"),
        api.get("/orders/"),
        api.get("/attendance/today_logs"),
      ]);
      const parts = manufacturingPartsRes.data ?? [];
      const orders = ordersRes.data ?? [];
      const manufacturingItems: PanelItem[] = parts.slice(0, kiosk ? 6 : 4).map((part: any) => ({
        id: part.id,
        title: part.part_name,
        subtitle: part.subsystem,
        status: part.status_label ?? part.status,
        badge: (part.manufacturing_type ?? "").toUpperCase(),
        note: part.priority === "urgent" ? "Urgent" : undefined,
      }));
      const orderItems: PanelItem[] = orders.slice(0, kiosk ? 6 : 4).map((order: any) => ({
        id: order.id,
        title: order.part_name,
        subtitle: order.requester_name,
        status: order.status,
        note: order.justification,
      }));
      const summary = summaryRes.data;
      setMetrics({
        attendance: attendanceRes.data,
        manufacturing: {
          total: summary.total,
          urgent: summary.urgent,
          byStatus: summary.by_status,
          items: manufacturingItems,
        },
        orders: {
          total: orders.length,
          pending: orders.filter((order: any) => order.status === "pending").length,
          items: orderItems,
        },
        attendanceHistory: historyRes.data ?? [],
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function handleScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = idInput.current?.value.trim();
    if (!value) return;
    try {
      const note = noteInput.current?.value.trim();
      await api.post("/attendance/scan", {
        barcode_id: value,
        student_id: value.length === 6 ? value : undefined,
        mode: scanMode,
        timestamp: dayjs().toISOString(),
        note: note || undefined,
      });
      idInput.current!.value = "";
      if (noteInput.current) noteInput.current.value = "";
      setScanStatus({ t: "ok", m: scanMode === "in" ? "Checked in" : "Checked out" });
      load();
    } catch (err: any) {
      setScanStatus({ t: "err", m: err?.response?.data?.detail ?? "Scan failed" });
    } finally {
      idInput.current?.focus();
      setTimeout(() => setScanStatus(null), 4000);
    }
  }

  const cards = [
    {
      title: "Attendance Today",
      value: metrics?.attendance?.open_entries ?? (loading ? "..." : "—"),
      subtitle: metrics?.attendance?.date ? dayjs(metrics.attendance.date).format("MMM D, YYYY") : "",
      action: () => onNavigate("attendance"),
    },
    {
      title: "Manufacturing",
      value: metrics?.manufacturing?.total ?? (loading ? "..." : "—"),
      subtitle: metrics?.manufacturing ? `${metrics.manufacturing.urgent} urgent` : "",
      action: () => onNavigate("manufacturing"),
    },
    {
      title: "Orders",
      value: metrics?.orders?.total ?? (loading ? "..." : "—"),
      subtitle: metrics?.orders ? `${metrics.orders.pending} pending` : "",
      action: () => onNavigate("orders"),
    },
  ];

  return (
    <section className={kiosk ? "dashboard kiosk" : "dashboard"}>
      <div className={`dashboard-grid ${kiosk ? "kiosk-layout" : ""}`}>
        {cards.map((card) => (
          <button key={card.title} className={`dashboard-card ${kiosk ? "kiosk" : ""}`} onClick={card.action}>
            <p>{card.title}</p>
            <h2>{card.value}</h2>
            {card.subtitle && <span className="stat-muted">{card.subtitle}</span>}
          </button>
        ))}
      </div>
      {(metrics?.manufacturing?.items?.length || metrics?.orders?.items?.length) && (
        <div className={`dashboard-panels ${kiosk ? "kiosk" : ""}`}>
          <Panel
            title="Manufacturing Flow"
            items={metrics?.manufacturing?.items ?? []}
            emptyLabel="No active builds"
            onClick={() => onNavigate("manufacturing")}
            kiosk={Boolean(kiosk)}
            total={metrics?.manufacturing?.total ?? 0}
            secondary={
              metrics?.manufacturing
                ? `Urgent: ${metrics.manufacturing.urgent}`
                : ""
            }
          />
          <Panel
            title="Orders"
            items={metrics?.orders?.items ?? []}
            emptyLabel="No orders yet"
            onClick={() => onNavigate("orders")}
            kiosk={Boolean(kiosk)}
            total={metrics?.orders?.total ?? 0}
            secondary={
              metrics?.orders ? `Pending: ${metrics.orders.pending}` : ""
            }
          />
        </div>
      )}
      {metrics?.attendanceHistory?.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <h4>Today&apos;s Attendance Log</h4>
            <button className="refresh-btn" onClick={() => onNavigate("attendance")}>
              View Full
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                </tr>
              </thead>
              <tbody>
                {metrics.attendanceHistory.slice(0, kiosk ? 10 : 6).map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.student_name}</td>
                    <td>{entry.check_in ? dayjs(entry.check_in).format("HH:mm") : "-"}</td>
                    <td>{entry.check_out ? dayjs(entry.check_out).format("HH:mm") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {kiosk && (
        <div className="card kiosk-form">
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <button
              type="button"
              className={scanMode === "in" ? "button-primary" : "refresh-btn"}
              onClick={() => setScanMode("in")}
            >
              Check In
            </button>
            <button
              type="button"
              className={scanMode === "out" ? "button-primary" : "refresh-btn"}
              onClick={() => setScanMode("out")}
            >
              Check Out
            </button>
            <button type="button" className="refresh-btn" onClick={load} disabled={loading}>
              Refresh
            </button>
          </div>
          <form onSubmit={handleScan}>
            <label>
              Scan or Type ID
              <input
                ref={idInput}
                autoFocus
                placeholder="Scan barcode or type student ID"
                inputMode="numeric"
              />
            </label>
            <label>
              Note (optional)
              <textarea ref={noteInput} rows={2} placeholder="Quick note" />
            </label>
            {scanStatus && <div className={`notice ${scanStatus.t}`}>{scanStatus.m}</div>}
            <button type="submit">Record</button>
          </form>
        </div>
      )}
      {!kiosk && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
            Welcome back {user?.full_name}! Use the tabs above or click any card to jump directly into its workflow.
          </p>
        </div>
      )}
    </section>
  );
}

type PanelProps = {
  title: string;
  items: PanelItem[];
  emptyLabel: string;
  onClick: () => void;
  kiosk: boolean;
  total: number;
  secondary?: string;
};

function Panel({ title, items, emptyLabel, onClick, kiosk, total, secondary }: PanelProps) {
  return (
    <div className={`panel ${kiosk ? "kiosk" : ""}`}>
      <div className="panel-header">
        <div>
          <h4>{title}</h4>
          <span className="stat-muted">
            Total: {total}
            {secondary ? ` • ${secondary}` : ""}
          </span>
        </div>
        <button className="refresh-btn" onClick={onClick}>
          Open
        </button>
      </div>
      {items.length === 0 ? (
        <p className="stat-muted">{emptyLabel}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <strong>{item.title}</strong>
                  {item.subtitle && <span className="stat-muted"> • {item.subtitle}</span>}
                </div>
                {item.badge && <span className="claimed-pill">{item.badge}</span>}
              </div>
              {item.status && <span className="status-small">{item.status}</span>}
              {item.note && <span className="stat-muted">{item.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
