import { useEffect, useRef, useState } from "react";
import { api, API_BASE } from "../api";
import { useAuth } from "../auth";
import { ViewNoteButton } from "./ViewNoteButton";

type Job = {
  id: number;
  shop: string;
  part_name: string;
  owner_name: string;
  status: string;
  notes?: string | null;
  file_name: string;
  created_at: string;
  file_url?: string | null;
  queue_position: number;
  claimed_by_id?: number | null;
  claimed_by_name?: string | null;
  claimed_at?: string | null;
};

export function JobsQueue({ shop }: { shop: "cnc" | "printing" }) {
  const { user } = useAuth();
  const canReorder = user?.role === "lead" || user?.role === "admin";
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [claimedJobs, setClaimedJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const activeRef = useRef<Job[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  function updateActive(next: Job[]) {
    activeRef.current = next;
    setActiveJobs(next);
  }

  function splitJobs(data: Job[]) {
    const active = data.filter((job) => !job.claimed_by_id);
    const claimed = data.filter((job) => job.claimed_by_id);
    updateActive(active);
    setClaimedJobs(claimed);
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.get<Job[]>("/jobs/", { params: { shop } });
      splitJobs(res.data);
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [shop]);

  async function removeJob(id: number) {
    try {
      await api.delete(`/jobs/${id}`);
      refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || "Cannot remove job");
    }
  }

  async function persistOrder(nextOrder: Job[]) {
    try {
      const res = await api.post<Job[]>("/jobs/reorder", { shop, ordered_ids: nextOrder.map((job) => job.id) });
      splitJobs(res.data);
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || "Failed to reorder queue");
      refresh();
    }
  }

  function handleDragStart(index: number, event: React.DragEvent<HTMLTableRowElement>) {
    if (!canReorder) return;
    dragIndex.current = index;
    setDraggingId(activeRef.current[index]?.id ?? null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    event.dataTransfer.setDragImage(event.currentTarget, 20, 10);
  }

  function handleDragOver(index: number, event: React.DragEvent<HTMLTableRowElement>) {
    if (!canReorder || dragIndex.current === null || index === dragIndex.current) return;
    event.preventDefault();
    const updated = [...activeRef.current];
    const [dragged] = updated.splice(dragIndex.current!, 1);
    updated.splice(index, 0, dragged);
    dragIndex.current = index;
    updateActive(updated);
  }

  function handleDrop(event: React.DragEvent) {
    if (!canReorder || dragIndex.current === null) return;
    event.preventDefault();
    dragIndex.current = null;
    setDraggingId(null);
    persistOrder(activeRef.current);
  }

  function moveRow(index: number, delta: number) {
    if (!canReorder) return;
    const updated = [...activeRef.current];
    const newIndex = Math.min(Math.max(index + delta, 0), updated.length - 1);
    if (newIndex === index) return;
    const [item] = updated.splice(index, 1);
    updated.splice(newIndex, 0, item);
    updateActive(updated);
    persistOrder(updated);
  }

  async function claimJob(jobId: number) {
    try {
      await api.post(`/jobs/${jobId}/claim`);
      refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || "Cannot claim job");
    }
  }

  async function unclaimJob(jobId: number) {
    try {
      await api.post(`/jobs/${jobId}/unclaim`);
      refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || "Cannot unclaim job");
    }
  }

  function downloadHref(file_url?: string | null) {
    if (!file_url) return undefined;
    const base = (API_BASE || "").replace(/\/$/, "");
    return `${base}${file_url}`;
  }

  return (
    <>
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>
            {shop.toUpperCase()} Queue <span className="stat-muted">({activeJobs.length} unclaimed)</span>
          </h3>
          <button className="refresh-btn" onClick={refresh} disabled={loading}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Part</th>
              <th>Owner</th>
              <th>Status</th>
              <th>File</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeJobs.map((j, index) => (
              <tr
                key={j.id}
                draggable={canReorder}
                onDragStart={(e) => handleDragStart(index, e)}
                onDragOver={(e) => handleDragOver(index, e)}
                onDrop={handleDrop}
                onDragEnd={() => {
                  dragIndex.current = null;
                  setDraggingId(null);
                }}
                className={draggingId === j.id ? "dragging-row" : undefined}
                style={{ cursor: canReorder ? "grab" : "default" }}
              >
                <td>{index + 1}</td>
                <td>{j.part_name}</td>
                <td>{j.owner_name}</td>
                <td>
                  {j.status}
                  {j.claimed_by_id && <span className="claimed-pill">Claimed</span>}
                </td>
                <td>
                  {j.file_url ? (
                    <a href={downloadHref(j.file_url)} target="_blank" rel="noreferrer">Download</a>
                  ) : (
                    j.file_name
                  )}
                </td>
                <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <ViewNoteButton title={`${j.part_name} Notes`} content={j.notes} />
                  <button onClick={() => removeJob(j.id)}>Remove</button>
                  <button onClick={() => claimJob(j.id)}>Claim</button>
                  {canReorder && (
                    <>
                      <button disabled={index === 0} onClick={() => moveRow(index, -1)}>↑</button>
                      <button disabled={index === activeJobs.length - 1} onClick={() => moveRow(index, 1)}>↓</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>
          Claimed Jobs <span className="stat-muted">({claimedJobs.length})</span>
        </h3>
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Claimed By</th>
              <th>Since</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {claimedJobs.map((j) => (
              <tr key={j.id}>
                <td>{j.part_name}</td>
                <td>{j.owner_name}</td>
                <td>{j.status}</td>
                <td>{j.claimed_by_name ?? "Unknown"}</td>
                <td>{j.claimed_at ? new Date(j.claimed_at).toLocaleString() : "-"}</td>
                <td>
                  {j.file_url ? (
                    <a href={downloadHref(j.file_url)} target="_blank" rel="noreferrer">Download</a>
                  ) : (
                    j.file_name
                  )}
                </td>
                <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <ViewNoteButton title={`${j.part_name} Notes`} content={j.notes} />
                  {(user?.role === "lead" || user?.role === "admin" || j.claimed_by_id === user?.id) && (
                    <button onClick={() => unclaimJob(j.id)}>Unclaim</button>
                  )}
                  <button onClick={() => removeJob(j.id)}>Remove</button>
                </td>
              </tr>
            ))}
            {claimedJobs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", opacity: 0.7 }}>
                  No jobs claimed yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
