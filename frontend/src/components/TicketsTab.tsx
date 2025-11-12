import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { api } from "../api";
import { useAuth } from "../auth";
import { ConfirmDialog } from "./ConfirmDialog";
import { ViewNoteButton } from "./ViewNoteButton";
import { ExportPanel } from "./ExportPanel";
import { CsvRecord, createRowAccessor } from "../utils/csv";

type Tab = "feature" | "issue";

type Ticket = {
  id: number;
  type: string;
  subject: string;
  details: string;
  priority: string;
  status: string;
  requester_name: string;
  created_at: string;
  updated_at: string;
};

const statusOptions = [
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
];

export function TicketsTab() {
  const [tab, setTab] = useState<Tab>("feature");
  const [tickets, setTickets] = useState<{ features: Ticket[]; issues: Ticket[] }>({ features: [], issues: [] });
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const canModerate = user?.role === "lead" || user?.role === "admin";

  async function fetchTickets() {
    setLoading(true);
    try {
      const [features, issues] = await Promise.all([
        api.get<Ticket[]>("/tickets", { params: { type: "feature" } }),
        api.get<Ticket[]>("/tickets", { params: { type: "issue" } }),
      ]);
      setTickets({ features: features.data, issues: issues.data });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTickets();
  }, []);

  const exportSection = tab === "feature" ? "tickets_feature" : "tickets_issue";

  return (
    <section>
      <ExportPanel
        section={exportSection}
        defaultName={tab === "feature" ? "feature-requests" : "issues"}
        helper="Exports whichever queue you're viewing."
        importConfig={{
          label: "Import tickets",
          helper: "Upload subject, priority, and details columns to seed the queue.",
          supportsRange: true,
          onProcessRows: async (rows) => {
            await importTickets(rows, tab);
            await fetchTickets();
          },
        }}
      />
      <div className="card">
        <div className="subtabs">
          <button className={tab === "feature" ? "active" : ""} onClick={() => setTab("feature")}>
            Feature Requests
          </button>
          <button className={tab === "issue" ? "active" : ""} onClick={() => setTab("issue")}>
            Issues / Bugs
          </button>
        </div>
        <TicketForm kind={tab} onSubmitted={fetchTickets} />
      </div>
      <TicketQueue
        title={tab === "feature" ? "Feature Queue" : "Issue Queue"}
        tickets={tab === "feature" ? tickets.features : tickets.issues}
        loading={loading}
        canModerate={canModerate}
        count={(tab === "feature" ? tickets.features : tickets.issues).length}
        onStatusChange={fetchTickets}
      />
    </section>
  );
}

function TicketForm({ kind, onSubmitted }: { kind: Tab; onSubmitted: () => void }) {
  const [status, setStatus] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      setSubmitting(true);
      await api.post("/tickets/", {
        type: kind,
        subject: data.subject,
        details: data.details,
        priority: data.priority,
      });
      event.currentTarget.reset();
      setStatus({ t: "ok", m: "Ticket submitted!" });
      onSubmitted();
    } catch (err: any) {
      setStatus({ t: "err", m: err?.response?.data?.detail ?? "Unable to submit" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Subject
        <input name="subject" required placeholder={kind === "feature" ? "New feature idea" : "Describe the issue"} />
      </label>
      <label>
        Priority
        <select name="priority" defaultValue="normal">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        Details
        <textarea name="details" rows={4} placeholder="Add extra context" required />
      </label>
      {status && <div className={`notice ${status.t}`}>{status.m}</div>}
      <button type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit Ticket"}</button>
    </form>
  );
}

function TicketQueue({
  title,
  tickets,
  loading,
  canModerate,
  onStatusChange,
  count,
}: {
  title: string;
  tickets: Ticket[];
  loading: boolean;
  canModerate: boolean;
  onStatusChange: () => void;
  count: number;
}) {
  const [confirmTicket, setConfirmTicket] = useState<Ticket | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  async function updateStatus(id: number, status: string) {
    try {
      await api.patch(`/tickets/${id}`, { status });
      onStatusChange();
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Unable to update ticket");
    }
  }

  async function deleteTicket(id: number) {
    try {
      await api.delete(`/tickets/${id}`);
      onStatusChange();
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Unable to delete ticket");
    }
  }

  async function handleConfirmDelete() {
    if (!confirmTicket) return;
    setConfirmBusy(true);
    try {
      await deleteTicket(confirmTicket.id);
      setConfirmTicket(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>
          {title} <span className="stat-muted">({count} tickets)</span>
        </h3>
        <button className="refresh-btn" onClick={onStatusChange} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Requester</th>
              <th>Created</th>
              {canModerate && <th></th>}
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.subject}</td>
                <td style={{ textTransform: "capitalize" }}>{ticket.priority}</td>
                <td>
                  {canModerate ? (
                    <select value={ticket.status} onChange={(e) => updateStatus(ticket.id, e.target.value)}>
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ textTransform: "capitalize" }}>{ticket.status}</span>
                  )}
                </td>
                <td>{ticket.details ? <ViewNoteButton title={ticket.subject} content={ticket.details} /> : "-"}</td>
                <td>{ticket.requester_name}</td>
                <td>{dayjs(ticket.created_at).format("MMM D, HH:mm")}</td>
                {canModerate && (
                  <td className="table-actions">
                    <button className="danger" onClick={() => setConfirmTicket(ticket)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={canModerate ? 7 : 6} style={{ textAlign: "center", opacity: 0.6 }}>
                  No tickets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(confirmTicket)}
        message={`Delete "${confirmTicket?.subject}" ticket?`}
        confirmLabel="Delete"
        busy={confirmBusy}
        onConfirm={handleConfirmDelete}
        onCancel={() => !confirmBusy && setConfirmTicket(null)}
      />
    </div>
  );
}

async function importTickets(rows: CsvRecord[], type: Tab) {
  const failures: string[] = [];
  let created = 0;
  for (let idx = 0; idx < rows.length; idx += 1) {
    const rowNumber = idx + 1;
    try {
      const payload = mapTicketRow(rows[idx], type);
      await api.post("/tickets/", payload);
      created += 1;
    } catch (error: any) {
      failures.push(`Row ${rowNumber}: ${error?.message ?? "Unable to import"}`);
    }
  }
  if (failures.length) {
    throw new Error(
      `${created ? `Imported ${created} row(s); ` : ""}${failures.length} failed:\n${failures.join("\n")}`,
    );
  }
}

function mapTicketRow(record: CsvRecord, type: Tab) {
  const get = createRowAccessor(record);
  const subject = (get("subject") || get("title") || "").trim();
  const details = (get("details") || get("description") || "").trim();
  const priorityRaw = (get("priority") || "normal").toLowerCase();
  const priority = ["low", "normal", "high"].includes(priorityRaw) ? priorityRaw : "normal";
  if (!subject) throw new Error("Missing subject");
  if (!details) throw new Error("Missing details");
  return {
    type,
    subject,
    details,
    priority,
  };
}
