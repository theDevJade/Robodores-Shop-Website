import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ExportPanel } from "./ExportPanel";

export type InventoryItem = {
  id: number;
  part_name: string;
  sku?: string | null;
  location?: string | null;
  quantity: number;
  unit_cost?: number | null;
  reorder_threshold?: number | null;
  tags?: string | null;
  vendor_link?: string | null;
  updated_at: string;
};

type Props = {
  canEdit: boolean;
};

export function InventoryTab({ canEdit }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [orderItem, setOrderItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems(search?: string) {
    setLoading(true);
    try {
      const res = await api.get<InventoryItem[]>("/inventory/items", { params: { q: search } });
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await api.post("/inventory/items", {
      part_name: data.part_name,
      sku: data.sku || null,
      location: data.location || null,
      quantity: Number(data.quantity || 0),
      unit_cost: data.unit_cost ? Number(data.unit_cost) : null,
      reorder_threshold: data.reorder_threshold ? Number(data.reorder_threshold) : null,
      tags: data.tags || null,
      vendor_link: data.vendor_link || null,
    });
    event.currentTarget.reset();
    fetchItems(query || undefined);
  }

  async function adjust(itemId: number, delta: number) {
    await api.post(`/inventory/items/${itemId}/adjust`, { delta, reason: "manual" });
    fetchItems(query || undefined);
  }

  async function remove(itemId: number) {
    await api.delete(`/inventory/items/${itemId}`);
    fetchItems(query || undefined);
  }

  const sorted = [...items].sort((a, b) => a.part_name.localeCompare(b.part_name));

  return (
    <section>
      {orderItem && (
        <QuickOrderModal
          item={orderItem}
          defaultRequester={user?.full_name ?? ""}
          onClose={() => setOrderItem(null)}
          onSubmitted={() => {
            setOrderItem(null);
          }}
        />
      )}
      <ExportPanel
        section="inventory"
        defaultName="inventory"
        helper="Exports the full inventory grid."
      />
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input placeholder="Search by name, SKU, location, or tags" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="button-primary" onClick={() => fetchItems(query || undefined)}>Search</button>
          </div>
          <button className="refresh-btn" onClick={() => fetchItems(query || undefined)} disabled={loading}>Refresh</button>
        </div>
      </div>
      {canEdit && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h3>Add Item</h3>
          <form onSubmit={addItem}>
            <label>Part Name<input name="part_name" required /></label>
            <label>SKU<input name="sku" /></label>
            <label>Location<input name="location" /></label>
            <label>Quantity<input name="quantity" type="number" defaultValue="0" /></label>
            <label>Unit Cost<input name="unit_cost" type="number" step="0.01" /></label>
            <label>Reorder Threshold<input name="reorder_threshold" type="number" /></label>
            <label>Tags<input name="tags" placeholder="comma separated" /></label>
            <label>Vendor Link<input name="vendor_link" type="url" placeholder="https://vendor.example/item" /></label>
            <button type="submit">Create Item</button>
          </form>
        </div>
      )}

      <div className="inventory-grid">
        {items.slice(0, 8).map((item) => (
          <article key={item.id} className="card">
            <h4>{item.part_name}</h4>
            <p>SKU: {item.sku ?? "-"}</p>
            <p>Location: {item.location ?? "-"}</p>
            <p>Qty: {item.quantity}</p>
            {item.reorder_threshold && <p>Reorder @ {item.reorder_threshold}</p>}
            {item.tags && <p>Tags: {item.tags}</p>}
            {item.vendor_link && (
              <p>
                Vendor:{" "}
                <a href={item.vendor_link} target="_blank" rel="noreferrer">
                  Link
                </a>
              </p>
            )}
            {canEdit && (
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button type="button" onClick={() => adjust(item.id, 1)}>+1</button>
                <button type="button" onClick={() => adjust(item.id, -1)}>-1</button>
                <button type="button" onClick={() => remove(item.id)}>Remove</button>
              </div>
            )}
            <div style={{ marginTop: "0.5rem" }}>
              <button type="button" onClick={() => setOrderItem(item)}>Submit Order</button>
            </div>
          </article>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3>All Parts (A-Z)</h3>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>SKU</th><th>Location</th><th>Qty</th><th>Tags</th><th>Vendor</th><th></th></tr></thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id}>
                  <td>{item.part_name}</td>
                  <td>{item.sku ?? "-"}</td>
                  <td>{item.location ?? "-"}</td>
                  <td>{item.quantity}</td>
                  <td>{item.tags ?? "-"}</td>
                  <td>
                    {item.vendor_link ? (
                      <a href={item.vendor_link} target="_blank" rel="noreferrer">
                        Link
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="table-actions">
                    {canEdit && <button onClick={() => remove(item.id)}>Remove</button>}
                    <button style={{ marginLeft: 8 }} onClick={() => setOrderItem(item)}>Submit Order</button>
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

function QuickOrderModal({
  item,
  defaultRequester,
  onClose,
  onSubmitted,
}: {
  item: InventoryItem;
  defaultRequester: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [form, setForm] = useState({
    requester_name: defaultRequester,
    part_name: item.part_name,
    vendor_link: item.vendor_link ?? "",
    price_usd: item.unit_cost ? String(item.unit_cost) : "",
    justification: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      requester_name: defaultRequester,
      part_name: item.part_name,
      vendor_link: item.vendor_link ?? "",
      price_usd: item.unit_cost ? String(item.unit_cost) : "",
      justification: "",
    });
  }, [item, defaultRequester]);

  function updateField<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.vendor_link) {
      alert("Vendor link is required");
      return;
    }
    setSaving(true);
    try {
      await api.post("/orders/", {
        requester_name: form.requester_name,
        part_name: form.part_name,
        vendor_link: form.vendor_link,
        price_usd: Number(form.price_usd || 0),
        justification: form.justification,
      });
      onSubmitted();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to submit order";
      alert(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Quick Order: {item.part_name}</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={submit} className="account-panel__form">
          <label>
            Requester
            <input value={form.requester_name} onChange={(e) => updateField("requester_name", e.target.value)} required />
          </label>
          <label>
            Part Name
            <input value={form.part_name} onChange={(e) => updateField("part_name", e.target.value)} required />
          </label>
          <label>
            Vendor Link
            <input
              type="url"
              value={form.vendor_link}
              onChange={(e) => updateField("vendor_link", e.target.value)}
              placeholder="https://vendor.example/item"
              required
            />
          </label>
          <label>
            Price (USD)
            <input
              type="number"
              step="0.01"
              value={form.price_usd}
              onChange={(e) => updateField("price_usd", e.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          <label>
            Justification
            <textarea value={form.justification} onChange={(e) => updateField("justification", e.target.value)} />
          </label>
          <button type="submit" disabled={saving}>{saving ? "Submitting..." : "Submit Order"}</button>
        </form>
      </div>
    </div>
  );
}
