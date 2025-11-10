import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ViewNoteButton } from "./ViewNoteButton";
import { ExportPanel } from "./ExportPanel";

type Block = { id:number; weekday:number; start_time:string; end_time:string; active:boolean };
const WD = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export type AttendanceRow = {
  id: number;
  student_name: string;
  student_identifier: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string;
  note: string | null;
};

type Summary = { date: string; open_entries: number };

type DayGroup = { date: string; entries: AttendanceRow[] };

type Props = { canViewLogs: boolean };

export function AttendanceTab({ canViewLogs }: Props) {
  const { user } = useAuth();
  const canVerify = user?.role === "lead" || user?.role === "admin";
  const [mode, setMode] = useState<"in" | "out">("in");
  const [days, setDays] = useState<DayGroup[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{t:"ok"|"err", m:string}|null>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const show = (t:"ok"|"err", m:string)=>{ setMsg({t,m}); setTimeout(()=>setMsg(null),3000); };

  async function fetchSchedules(){ try{ const r = await api.get<Block[]>("/schedules/"); setBlocks(r.data); }catch{} }
  async function fetchSummary(){ try{ const r = await api.get<Summary>("/attendance/summary/today"); setSummary(r.data); }catch{} }

  useEffect(() => {
    if (canViewLogs) fetchLogs();
    fetchSchedules();
    fetchSummary();
    const interval = setInterval(() => {
      idInput.current?.focus();
      if (canViewLogs) fetchLogs();
      fetchSummary();
    }, 5000);
    return () => clearInterval(interval);
  }, [canViewLogs]);

  async function fetchLogs() {
    if (!canViewLogs) return;
    setLoading(true);
    try {
      const res = await api.get<DayGroup[]>("/attendance/logs_by_date");
      setDays(res.data);
    } finally { setLoading(false); }
  }

  async function onScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const value = idInput.current?.value.trim(); if (!value) return;
    try {
      const note = noteInput.current?.value.trim();
      const payload: any = {
        barcode_id: value,
        student_id: value.length === 6 ? value : undefined,
        mode,
        timestamp: dayjs().toISOString(),
        note: note || undefined,
      };
      await api.post<AttendanceRow>("/attendance/scan", payload);
      fetchLogs();
      fetchSummary();
      show("ok", mode === "in" ? "Checked in" : "Checked out");
    } catch (error: any) {
      show("err", error.response?.data?.detail ?? "Scan failed");
    } finally {
      if (idInput.current) idInput.current.value = "";
      if (noteInput.current) noteInput.current.value = "";
      idInput.current?.focus();
    }
  }

  async function removeEntry(id: number) { try{ await api.delete(`/attendance/${id}`); fetchLogs(); show("ok","Entry removed"); } catch (err: any) { show("err", err.response?.data?.detail ?? "Cannot remove entry"); } }

  async function updateEntryStatus(id: number, status: "ok" | "unverified") {
    try {
      await api.patch(`/attendance/entries/${id}/status`, { status });
      fetchLogs();
      show("ok", status === "ok" ? "Marked verified" : "Marked unverified");
    } catch (error: any) {
      show("err", error?.response?.data?.detail ?? "Unable to update status");
    }
  }

  return (
    <section>
      <ExportPanel section="attendance" defaultName="attendance-log" helper="Exports the current attendance history." />
      <form onSubmit={onScan} className="card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button type="button" className={mode === "in" ? "active" : ""} onClick={() => setMode("in")}>Check In</button>
          <button type="button" className={mode === "out" ? "active" : ""} onClick={() => setMode("out")}>Check Out</button>
          <button type="button" className="refresh-btn" onClick={fetchLogs} disabled={loading}>Refresh</button>
        </div>
        {msg && <div className={`notice ${msg.t}`}>{msg.m}</div>}
        <label htmlFor="barcode">Scan or Type 6-digit ID</label>
        <input id="barcode" ref={idInput} autoFocus placeholder="Scan barcode or type student ID" />
        <label htmlFor="note">Attendance Note (optional)</label>
        <textarea id="note" ref={noteInput} rows={2} placeholder="Add a quick note about this check-in" />
        <button type="submit">Record</button>
      </form>

      {summary && (
        <div className="card" style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 style={{ margin: 0 }}>Today's Attendance</h4>
            <span className="stat-muted">{summary.date}</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>{summary.open_entries}</p>
            <small>currently signed in</small>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 8 }}>
        <h4>Schedule Blocks</h4>
        <div style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {blocks.map(b => (
            <span key={b.id} style={{ border: "1px solid #334155", padding: "4px 8px", borderRadius: 8 }}>
              {WD[b.weekday]} {b.start_time}-{b.end_time}
            </span>
          ))}
        </div>
      </div>

      {days.map((g) => (
        <div key={g.date} className="card" style={{ marginTop: 12 }}>
          <h3>{g.date}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.entries.map((log) => (
                  <tr key={log.id} className={log.status !== "ok" ? "warn" : undefined}>
                    <td>{log.student_name}</td>
                    <td>{log.student_identifier ?? "-"}</td>
                    <td>{log.check_in ? dayjs(log.check_in).format("HH:mm") : "-"}</td>
                    <td>{log.check_out ? dayjs(log.check_out).format("HH:mm") : "-"}</td>
                    <td>
                      {canVerify && (log.status === "unverified" || log.status === "ok") ? (
                        <select value={log.status} onChange={e=>updateEntryStatus(log.id, e.target.value as "ok"|"unverified")}>
                          <option value="ok">Verified</option>
                          <option value="unverified">Unverified</option>
                        </select>
                      ) : (
                        <span>{log.status}</span>
                      )}
                      {log.status === "unverified" && <span className="status-pill unverified">Unverified</span>}
                    </td>
                    <td>{log.note ? <ViewNoteButton title={`${log.student_name} Note`} content={log.note} /> : "-"}</td>
                    <td style={{ textAlign: "right" }}>
                      {user?.role === "admin" && (
                        <button onClick={() => removeEntry(log.id)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
