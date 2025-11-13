import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ViewNoteButton } from "./ViewNoteButton";
import { ExportPanel } from "./ExportPanel";
import { CsvRecord, createRowAccessor } from "../utils/csv";

export type Order = {
  id: number;
  requester_name: string;
  part_name: string;
  vendor_link: string;
  price_usd: number;
  justification?: string | null;
  status: string;
  created_at: string;
};

type Props = {
  canModerate: boolean;
};

export function OrdersTab({ canModerate }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const [form, setForm] = useState({
    requester_name: "",
    part_name: "",
    vendor_link: "",
    price_usd: "",
    justification: "",
  });

  useEffect(() => {
    setForm((prev) => ({ ...prev, requester_name: user?.full_name ?? "" }));
  }, [user?.full_name]);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await api.get<Order[]>("/orders/");
      setOrders(res.data);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to load orders";
      alert(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 10000);
    return () => clearInterval(t);
  }, []);

  function updateField<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post("/orders/", {
        requester_name: form.requester_name,
        part_name: form.part_name,
        vendor_link: form.vendor_link,
        price_usd: Number(form.price_usd),
        justification: form.justification,
      });
      resetForm();
      fetchOrders();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to create order";
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeOrder(id: number) {
    try {
      await api.delete(`/orders/${id}`);
      fetchOrders();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Cannot remove order";
      alert(msg);
    }
  }

  async function importOrdersFromRows(rows: CsvRecord[], range?: { start: number; end: number }) {
    let created = 0;
    const failures: string[] = [];
    for (let idx = 0; idx < rows.length; idx += 1) {
      const absoluteRow = (range?.start ?? 1) + idx;
      try {
        const payload = buildOrderPayload(rows[idx]);
        await api.post("/orders/", payload);
        created += 1;
      } catch (error: any) {
        failures.push(`Row ${absoluteRow}: ${error?.message ?? "Unable to import"}`);
      }
    }
    if (created) await fetchOrders();
    if (failures.length) {
      throw new Error(
        `${created ? `Imported ${created} row(s); ` : ""}${failures.length} failed:\n${failures.join("\n")}`,
      );
    }
  }

  function resetForm() {
    setForm({
      requester_name: user?.full_name ?? "",
      part_name: "",
      vendor_link: "",
      price_usd: "",
      justification: "",
    });
  }

  return (
    <section>
      <ExportPanel
        section="orders"
        defaultName="orders"
        helper="Download every request with one click."
        importConfig={{
          label: "Import requests",
          helper: "Upload a CSV with requester_name, part_name, vendor_link, price_usd, and justification columns.",
          supportsRange: true,
          onProcessRows: importOrdersFromRows,
        }}
      />
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>New Order Request</h3>
          <button className="refresh-btn" onClick={fetchOrders} disabled={loading}>Refresh</button>
        </div>
        <form onSubmit={submit}>
          <label>
            Requester
            <input name="requester_name" value={form.requester_name} onChange={(e) => updateField("requester_name", e.target.value)} required />
          </label>
          <label>
            Part Name
            <input name="part_name" value={form.part_name} onChange={(e) => updateField("part_name", e.target.value)} required />
          </label>
          <label>
            Vendor Link
            <input type="url" name="vendor_link" value={form.vendor_link} onChange={(e) => updateField("vendor_link", e.target.value)} required />
          </label>
          <label>
            Price (USD)
            <input type="number" step="0.01" name="price_usd" value={form.price_usd} onChange={(e) => updateField("price_usd", e.target.value)} required />
          </label>
          <label>
            Justification
            <textarea name="justification" placeholder="Why we need this part" value={form.justification} onChange={(e) => updateField("justification", e.target.value)} />
          </label>
          <button type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit Request"}</button>
        </form>
      </div>
      <div className="card orders-requests-card">
        <div className="orders-requests-card__head">
          <div>
            <h3>Requests</h3>
            <p className="stat-muted" style={{ margin: 0 }}>
              {orders.length} total requests
            </p>
          </div>
          <button className="refresh-btn" onClick={fetchOrders} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Requester</th>
                <th>Part</th>
                <th>Price</th>
                <th>Status</th>
                <th>Vendor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.requester_name}</td>
                  <td>{order.part_name}</td>
                  <td>${order.price_usd.toFixed(2)}</td>
                  <td>{order.status}</td>
                  <td>
                    <a href={order.vendor_link} target="_blank" rel="noreferrer">
                      Link
                    </a>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {order.justification ? (
                      <ViewNoteButton title={`${order.part_name} Justification`} content={order.justification} />
                    ) : (
                      "-"
                    )}
                    {(canModerate || order.requester_name === user?.full_name) && (
                      <button onClick={() => removeOrder(order.id)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function mapOrderRow(row: CsvRecord) {
  const get = createRowAccessor(row);
  return {
    requester_name: get("requester_name") || get("requester"),
    part_name: get("part_name") || get("part"),
    vendor_link: get("vendor_link") || get("vendor") || get("link"),
    price: get("price_usd") || get("price"),
    justification: get("justification") || get("note"),
  };
}

function buildOrderPayload(row: CsvRecord) {
  const mapped = mapOrderRow(row);
  const requester = mapped.requester_name?.trim();
  const part = mapped.part_name?.trim();
  const vendor = mapped.vendor_link?.trim();
  const priceNumber = Number(mapped.price?.trim() ?? "");
  if (!requester) throw new Error("Missing requester_name");
  if (!part) throw new Error("Missing part_name");
  if (!vendor) throw new Error("Missing vendor_link");
  if (!Number.isFinite(priceNumber)) throw new Error("Invalid price");
  return {
    requester_name: requester,
    part_name: part,
    vendor_link: vendor,
    price_usd: priceNumber,
    justification: mapped.justification?.trim() || undefined,
  };
}
