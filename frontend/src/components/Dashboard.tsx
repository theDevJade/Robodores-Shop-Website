import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { api } from "../api";
import { useAuth } from "../auth";
import { ViewNoteButton } from "./ViewNoteButton";

type Summary = { date: string; open_entries: number };
type JobPreview = {
  id: number;
  part_name: string;
  owner_name: string;
  claimed_by_name?: string | null;
  status: string;
  notes?: string | null;
};
type OrderPreview = {
  id: number;
  part_name: string;
  requester_name: string;
  status: string;
  notes?: string | null;
};
type DashboardMetrics = {
  attendance?: Summary;
  cnc: { total: number; claimed: number; items: JobPreview[] };
  printing: { total: number; claimed: number; items: JobPreview[] };
  orders: { total: number; pending: number; items: OrderPreview[] };
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
      const [attendanceRes, cncRes, printingRes, ordersRes, historyRes] = await Promise.all([
        api.get<Summary>("/attendance/summary/today"),
        api.get("/jobs/", { params: { shop: "cnc" } }),
        api.get("/jobs/", { params: { shop: "printing" } }),
        api.get("/orders/"),
        api.get("/attendance/today_logs"),
      ]);
      const cncJobs = cncRes.data ?? [];
      const printingJobs = printingRes.data ?? [];
      const orders = ordersRes.data ?? [];
      const toPreview = (jobs: any[]) =>
        jobs.slice(0, kiosk ? 6 : 4).map((job) => ({
          id: job.id,
          part_name: job.part_name,
          owner_name: job.owner_name,
          claimed_by_name: job.claimed_by_name,
          status: job.status,
          notes: job.notes,
        }));
      const orderPreview = orders.slice(0, kiosk ? 6 : 4).map((o: any) => ({
        id: o.id,
        part_name: o.part_name,
        requester_name: o.requester_name,
        status: o.status,
        notes: o.justification,
      }));
      setMetrics({
        attendance: attendanceRes.data,
        cnc: {
          total: cncJobs.length,
          claimed: cncJobs.filter((j: any) => j.claimed_by_id).length,
          items: toPreview(cncJobs),
        },
        printing: {
          total: printingJobs.length,
          claimed: printingJobs.filter((j: any) => j.claimed_by_id).length,
          items: toPreview(printingJobs),
        },
        orders: {
          total: orders.length,
          pending: orders.filter((o: any) => o.status === "pending").length,
          items: orderPreview,
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
      title: "Orders",
      value: metrics?.orders?.total ?? (loading ? "..." : "—"),
      subtitle: metrics?.orders ? `${metrics.orders.pending} pending` : "",
      action: () => onNavigate("orders"),
    },
    {
      title: "CNC Queue",
      value: metrics?.cnc?.total ?? (loading ? "..." : "—"),
      subtitle: metrics?.cnc ? `${metrics.cnc.claimed} claimed` : "",
      action: () => onNavigate("cnc"),
    },
    {
      title: "3D Printing Queue",
      value: metrics?.printing?.total ?? (loading ? "..." : "—"),
      subtitle: metrics?.printing ? `${metrics.printing.claimed} claimed` : "",
      action: () => onNavigate("printing"),
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
      {(metrics?.cnc?.items?.length || metrics?.printing?.items?.length || metrics?.orders?.items?.length) && (
        <div className={`dashboard-panels ${kiosk ? "kiosk" : ""}`}>
          <Panel
            title="CNC Queue"
            items={metrics?.cnc?.items ?? []}
            emptyLabel="Queue is clear"
            onClick={() => onNavigate("cnc")}
            kiosk={Boolean(kiosk)}
            total={metrics?.cnc?.total ?? 0}
            claimed={metrics?.cnc?.claimed ?? 0}
          />
          <Panel
            title="3D Printing Queue"
            items={metrics?.printing?.items ?? []}
            emptyLabel="Queue is clear"
            onClick={() => onNavigate("printing")}
            kiosk={Boolean(kiosk)}
            total={metrics?.printing?.total ?? 0}
            claimed={metrics?.printing?.claimed ?? 0}
          />
          <Panel
            title="Orders"
            items={metrics?.orders?.items?.map((o) => ({
              id: o.id,
              part_name: o.part_name,
              owner_name: o.requester_name,
              status: o.status,
            })) ?? []}
            emptyLabel="No orders yet"
            onClick={() => onNavigate("orders")}
            kiosk={Boolean(kiosk)}
            total={metrics?.orders?.total ?? 0}
            claimed={metrics?.orders?.pending ?? 0}
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
  items: JobPreview[];
  emptyLabel: string;
  onClick: () => void;
  kiosk: boolean;
  total: number;
  claimed: number;
};

function Panel({ title, items, emptyLabel, onClick, kiosk, total, claimed }: PanelProps) {
  return (
    <div className={`panel ${kiosk ? "kiosk" : ""}`}>
      <div className="panel-header">
        <div>
          <h4>{title}</h4>
          <span className="stat-muted">Total: {total} • Claimed: {claimed}</span>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{item.part_name}</strong>
                  <span className="stat-muted"> Owner: {item.owner_name}</span>
                </div>
                {item.claimed_by_name && <span className="claimed-pill">Claimed</span>}
              </div>
              {item.claimed_by_name && <span className="stat-muted">Claimed by {item.claimed_by_name}</span>}
              <span className="status-small">{item.status}</span>
              {item.notes && <ViewNoteButton title={`${item.part_name} Notes`} content={item.notes} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
