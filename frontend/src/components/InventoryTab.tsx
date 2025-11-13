import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ExportPanel } from "./ExportPanel";
import { CsvRecord, createRowAccessor } from "../utils/csv";

export type InventoryPartType = "custom" | "cots";

export type InventoryItem = {
  id: number;
  part_name: string;
  sku?: string | null;
  part_type?: InventoryPartType | null;
  location?: string | null;
  quantity: number;
  unit_cost?: number | null;
  reorder_threshold?: number | null;
  tags?: string | null;
  vendor_name?: string | null;
  vendor_link?: string | null;
  updated_at: string;
};

type Props = {
  canEdit: boolean;
};

type SortKey =
  | "part_name"
  | "part_type"
  | "sku"
  | "location"
  | "quantity"
  | "reorder_threshold"
  | "updated_at";

const TYPE_LABELS: Record<InventoryPartType, string> = {
  custom: "Custom",
  cots: "COTS",
};

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "part_name", label: "Name" },
  { key: "part_type", label: "Type" },
  { key: "sku", label: "SKU" },
  { key: "location", label: "Location" },
  { key: "quantity", label: "Quantity" },
  { key: "reorder_threshold", label: "Reorder threshold" },
  { key: "updated_at", label: "Last updated" },
];

export function InventoryTab({ canEdit }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [orderItem, setOrderItem] = useState<InventoryItem | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const searchTimeout = useRef<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<InventoryPartType | "all">("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "part_name",
    direction: "asc",
  });
  const [expandedTags, setExpandedTags] = useState<Record<number, boolean>>({});

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (searchTimeout.current) {
      window.clearTimeout(searchTimeout.current);
    }
    searchTimeout.current = window.setTimeout(() => {
      fetchItems(query || undefined);
    }, 320);
    return () => {
      if (searchTimeout.current) {
        window.clearTimeout(searchTimeout.current);
      }
    };
  }, [query]);

  async function fetchItems(search?: string) {
    setLoading(true);
    try {
      const res = await api.get<InventoryItem[]>("/inventory/items", { params: { q: search } });
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    fetchItems(query || undefined);
  }

  const { locations, hasUnassigned } = useMemo(() => {
    const locationSet = new Set<string>();
    let includeUnassigned = false;
    items.forEach((item) => {
      if (item.location) {
        locationSet.add(item.location);
      } else {
        includeUnassigned = true;
      }
    });
    return {
      locations: Array.from(locationSet).sort((a, b) => a.localeCompare(b)),
      hasUnassigned: includeUnassigned,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      const currentType = item.part_type ?? "custom";
      if (typeFilter !== "all" && currentType !== typeFilter) {
        return false;
      }
      if (locationFilter !== "all") {
        if (locationFilter === "__none__") {
          if (item.location) return false;
        } else if (item.location !== locationFilter) {
          return false;
        }
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const multiplier = sort.direction === "asc" ? 1 : -1;
      const aValue = sortableValue(a, sort.key);
      const bValue = sortableValue(b, sort.key);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * multiplier;
      }
      return String(aValue).localeCompare(String(bValue)) * multiplier;
    });

    return sorted;
  }, [items, typeFilter, locationFilter, sort]);

  const updateSortKey = (key: SortKey) => {
    setSort((prev) => ({ key, direction: prev.key === key ? prev.direction : "asc" }));
  };

  const toggleSortDirection = () => {
    setSort((prev) => ({ ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }));
  };

  async function adjust(itemId: number, delta: number) {
    await api.post(`/inventory/items/${itemId}/adjust`, { delta, reason: "manual" });
    fetchItems(query || undefined);
  }

  async function remove(itemId: number) {
    if (!window.confirm("Delete this inventory item?")) return;
    await api.delete(`/inventory/items/${itemId}`);
    fetchItems(query || undefined);
  }

  const emptyState = !loading && filteredItems.length === 0;

  const handleInventoryImport = async (rows: CsvRecord[], range?: { start: number; end: number }) => {
    const failures: string[] = [];
    let created = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const absoluteRow = (range?.start ?? 1) + index;
      try {
        const payload = mapInventoryRow(rows[index]);
        await api.post("/inventory/items", payload);
        created += 1;
      } catch (error: any) {
        failures.push(`Row ${absoluteRow}: ${error?.message ?? "Unable to import item"}`);
      }
    }
    if (created) {
      await fetchItems(query || undefined);
    }
    if (failures.length) {
      throw new Error(
        `${created ? `Imported ${created} item(s); ` : ""}${failures.length} failed:\n${failures.join("\n")}`,
      );
    }
  };

  return (
    <section>
      {orderItem && (
        <QuickOrderModal
          item={orderItem}
          defaultRequester={user?.full_name ?? ""}
          onClose={() => setOrderItem(null)}
          onSubmitted={() => setOrderItem(null)}
        />
      )}
      {addModalOpen && (
        <AddItemModal
          onClose={() => setAddModalOpen(false)}
          onCreated={async () => {
            await fetchItems(query || undefined);
            setAddModalOpen(false);
          }}
        />
      )}
      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={async () => {
            await fetchItems(query || undefined);
            setEditingItem(null);
          }}
          onDeleted={async () => {
            await remove(editingItem.id);
            setEditingItem(null);
          }}
        />
      )}
      <ExportPanel
        section="inventory"
        defaultName="inventory"
        helper="Exports the full inventory grid."
        importConfig={{
          label: "Import inventory",
          helper:
            "Columns: part_name, part_type, sku, location, quantity, unit_cost, reorder_threshold, vendor_name, tags, vendor_link.",
          supportsRange: true,
          onProcessRows: handleInventoryImport,
        }}
      />

      <div className="card inventory-table-card">
        <div className="inventory-table-card__head">
          <div>
            <h3>Inventory</h3>
            <p>
              Showing {filteredItems.length} of {items.length} items
            </p>
          </div>
          <div className="inventory-table-card__headActions">
            {loading && <span className="text-muted">Updating…</span>}
            {canEdit && (
              <div className="inventory-table-card__actions">
                <button type="button" className="button-primary" onClick={() => setAddModalOpen(true)}>
                  + Add item
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="inventory-toolbar">
          <div className="inventory-toolbar__searchRow">
            <label className="inventory-toolbar__field inventory-toolbar__field--full">
              <span>Search inventory</span>
              <input
                placeholder="Search by name, SKU, location, vendor, or tags"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </label>
            <div className="inventory-toolbar__buttonStack">
              <button className="button-primary" type="button" onClick={handleSearch} disabled={loading}>
                Search
              </button>
              <button className="refresh-btn" type="button" onClick={() => fetchItems(query || undefined)} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>
          <div className="inventory-toolbar__filters inventory-toolbar__filters--thirds">
            <label className="inventory-toolbar__field inventory-toolbar__field--third">
              <span>Part type</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as InventoryPartType | "all")}>
                <option value="all">All types</option>
                <option value="custom">Custom</option>
                <option value="cots">COTS</option>
              </select>
            </label>
            <label className="inventory-toolbar__field inventory-toolbar__field--third">
              <span>Location</span>
              <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="all">All locations</option>
                {hasUnassigned && <option value="__none__">Unassigned</option>}
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
            <label className="inventory-toolbar__field inventory-toolbar__field--third sort-field">
              <span>Sort by</span>
              <div className="sort-field__controls">
                <select value={sort.key} onChange={(e) => updateSortKey(e.target.value as SortKey)}>
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="refresh-btn sort-direction-btn"
                  onClick={toggleSortDirection}
                  aria-label="Toggle sort direction"
                >
                  {sort.direction === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </label>
          </div>
        </div>
        <div className="table-scroll inventory-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>SKU</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Updated</th>
                <th className="table-actions inventory-actions-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const partType = item.part_type ?? "custom";
                const lowOnHand =
                  typeof item.reorder_threshold === "number" && item.reorder_threshold >= 0
                    ? item.quantity <= item.reorder_threshold
                    : false;
                const tags = item.tags ? item.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
                const tagsExpanded = expandedTags[item.id];
                return (
                  <tr key={item.id}>
                    <td title={item.part_name}>
                      <div className="inventory-name-cell">
                        <strong>{item.part_name}</strong>
                        {tags.length > 0 && (
                          <div className="inventory-tags">
                            {tagsExpanded ? (
                              <>
                                <div className="tag-grid">
                                  {tags.map((tag) => (
                                    <span key={tag} className="tag-chip">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="mini-link inventory-tag-toggle"
                                  onClick={() => setExpandedTags((prev) => ({ ...prev, [item.id]: false }))}
                                >
                                  Hide tags
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="mini-link inventory-tag-toggle"
                                onClick={() => setExpandedTags((prev) => ({ ...prev, [item.id]: true }))}
                              >
                                Show tags ({tags.length})
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td title={TYPE_LABELS[partType]}>
                      <span className={`type-pill type-${partType}`}>{TYPE_LABELS[partType]}</span>
                    </td>
                    <td className="inventory-meta" title={item.sku ?? "—"}>
                      {item.sku ?? "—"}
                    </td>
                    <td className="inventory-meta" title={item.location ?? "Unassigned"}>
                      {item.location ?? "Unassigned"}
                    </td>
                    <td title={`${item.quantity}`}>
                      <div className="inventory-qty">
                        <span className={lowOnHand ? "low" : undefined}>{item.quantity}</span>
                        {typeof item.reorder_threshold === "number" && (
                          <small>Reorder @ {item.reorder_threshold}</small>
                        )}
                        {canEdit && (
                          <div className="qty-controls">
                            <button type="button" className="table-inline-btn" onClick={() => adjust(item.id, 1)}>
                              +1
                            </button>
                            <button type="button" className="table-inline-btn" onClick={() => adjust(item.id, -1)}>
                              -1
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="inventory-meta" title={new Date(item.updated_at).toLocaleString()}>
                      {new Date(item.updated_at).toLocaleDateString()}
                    </td>
                    <td className="table-actions inventory-actions">
                      <button type="button" onClick={() => setOrderItem(item)}>
                        Submit order
                      </button>
                      {canEdit && (
                        <button type="button" className="button-surface" onClick={() => setEditingItem(item)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {emptyState && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "1.5rem" }}>
                    No items match your filters. Try adjusting your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AddItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> | void }) {
  const [form, setForm] = useState<InventoryFormState>(() => getEmptyFormState());
  const [saving, setSaving] = useState(false);
  const isCots = form.part_type === "cots";

  function updateField<K extends keyof InventoryFormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { errors, payload } = buildPayloadFromForm(form);
    if (!payload || errors.length) {
      alert(errors.join("\n"));
      return;
    }
    setSaving(true);
    try {
      await api.post("/inventory/items", payload);
      setForm(getEmptyFormState());
      await onCreated();
    } catch (err: any) {
      const message = err?.response?.data?.detail ?? err?.message ?? "Failed to create item";
      alert(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Add inventory item</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit} className="inventory-form">
          <label>
            Part name
            <input value={form.part_name} onChange={(e) => updateField("part_name", e.target.value)} required />
          </label>
          <label>
            Part type
            <select value={form.part_type} onChange={(e) => updateField("part_type", e.target.value)} required>
              <option value="custom">Custom (in-house)</option>
              <option value="cots">COTS (vendor supplied)</option>
            </select>
          </label>
          <label>
            {isCots ? "Vendor SKU" : "Internal SKU"}
            <input value={form.sku} onChange={(e) => updateField("sku", e.target.value)} required />
          </label>
          <label>
            Location
            <input value={form.location} onChange={(e) => updateField("location", e.target.value)} required />
          </label>
          <label>
            Quantity on hand
            <input
              type="number"
              min="0"
              step="1"
              value={form.quantity}
              onChange={(e) => updateField("quantity", e.target.value)}
              required
            />
          </label>
          <label>
            Unit cost (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unit_cost}
              onChange={(e) => updateField("unit_cost", e.target.value)}
              required
            />
          </label>
          <label>
            Reorder threshold
            <input
              type="number"
              min="0"
              step="1"
              value={form.reorder_threshold}
              onChange={(e) => updateField("reorder_threshold", e.target.value)}
              required
            />
          </label>
          {isCots && (
            <label>
              Vendor name
              <input value={form.vendor_name} onChange={(e) => updateField("vendor_name", e.target.value)} required={isCots} />
            </label>
          )}
          <label>
            Vendor link
            <input
              type="url"
              placeholder="https://vendor.example/item"
              value={form.vendor_link}
              onChange={(e) => updateField("vendor_link", e.target.value)}
            />
          </label>
          <label>
            Tags
            <input
              placeholder="comma separated"
              value={form.tags}
              onChange={(e) => updateField("tags", e.target.value)}
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Create item"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EditItemModal({
  item,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: InventoryItem;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<InventoryFormState>(() => formStateFromItem(item));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm(formStateFromItem(item));
  }, [item]);

  const isCots = form.part_type === "cots";

  function updateField<K extends keyof InventoryFormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { errors, payload } = buildPayloadFromForm(form);
    if (!payload || errors.length) {
      alert(errors.join("\n"));
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/inventory/items/${item.id}`, payload);
      await onSaved();
    } catch (err: any) {
      const message = err?.response?.data?.detail ?? err?.message ?? "Failed to update item";
      alert(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Edit inventory item</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit} className="inventory-form">
          <label>
            Part name
            <input value={form.part_name} onChange={(e) => updateField("part_name", e.target.value)} required />
          </label>
          <label>
            Part type
            <select value={form.part_type} onChange={(e) => updateField("part_type", e.target.value)} required>
              <option value="custom">Custom (in-house)</option>
              <option value="cots">COTS (vendor supplied)</option>
            </select>
          </label>
          <label>
            {isCots ? "Vendor SKU" : "Internal SKU"}
            <input value={form.sku} onChange={(e) => updateField("sku", e.target.value)} required />
          </label>
          <label>
            Location
            <input value={form.location} onChange={(e) => updateField("location", e.target.value)} required />
          </label>
          <label>
            Quantity on hand
            <input
              type="number"
              min="0"
              step="1"
              value={form.quantity}
              onChange={(e) => updateField("quantity", e.target.value)}
              required
            />
          </label>
          <label>
            Unit cost (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unit_cost}
              onChange={(e) => updateField("unit_cost", e.target.value)}
              required
            />
          </label>
          <label>
            Reorder threshold
            <input
              type="number"
              min="0"
              step="1"
              value={form.reorder_threshold}
              onChange={(e) => updateField("reorder_threshold", e.target.value)}
              required
            />
          </label>
          {isCots && (
            <label>
              Vendor name
              <input value={form.vendor_name} onChange={(e) => updateField("vendor_name", e.target.value)} required={isCots} />
            </label>
          )}
          <label>
            Vendor link
            <input
              type="url"
              placeholder="https://vendor.example/item"
              value={form.vendor_link}
              onChange={(e) => updateField("vendor_link", e.target.value)}
            />
          </label>
          <label>
            Tags
            <input
              placeholder="comma separated"
              value={form.tags}
              onChange={(e) => updateField("tags", e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Removing…" : "Remove item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type InventoryFormState = {
  part_name: string;
  part_type: InventoryPartType;
  sku: string;
  location: string;
  quantity: string;
  unit_cost: string;
  reorder_threshold: string;
  vendor_name: string;
  vendor_link: string;
  tags: string;
};

type InventoryPayload = {
  part_name: string;
  part_type: InventoryPartType;
  sku: string;
  location: string;
  quantity: number;
  unit_cost: number;
  reorder_threshold: number;
  vendor_name: string | null;
  vendor_link: string | null;
  tags: string | null;
};

function getEmptyFormState(): InventoryFormState {
  return {
    part_name: "",
    part_type: "custom",
    sku: "",
    location: "",
    quantity: "1",
    unit_cost: "",
    reorder_threshold: "",
    vendor_name: "",
    vendor_link: "",
    tags: "",
  };
}

function formStateFromItem(item: InventoryItem): InventoryFormState {
  return {
    part_name: item.part_name,
    part_type: item.part_type ?? "custom",
    sku: item.sku ?? "",
    location: item.location ?? "",
    quantity: String(item.quantity),
    unit_cost: item.unit_cost != null ? String(item.unit_cost) : "",
    reorder_threshold: item.reorder_threshold != null ? String(item.reorder_threshold) : "",
    vendor_name: item.vendor_name ?? "",
    vendor_link: item.vendor_link ?? "",
    tags: item.tags ?? "",
  };
}

function buildPayloadFromForm(form: InventoryFormState): { errors: string[]; payload?: InventoryPayload } {
  const errors: string[] = [];
  const trimmedName = form.part_name.trim();
  const trimmedSku = form.sku.trim();
  const trimmedLocation = form.location.trim();
  const isCots = form.part_type === "cots";
  const quantity = Number.parseInt(form.quantity, 10);
  const unitCost = Number.parseFloat(form.unit_cost);
  const reorderThreshold = Number.parseInt(form.reorder_threshold, 10);

  if (!trimmedName) errors.push("Part name is required.");
  if (!trimmedSku) errors.push("SKU is required.");
  if (!trimmedLocation) errors.push("Location is required.");
  if (Number.isNaN(quantity)) errors.push("Quantity must be a whole number.");
  if (Number.isNaN(unitCost)) errors.push("Unit cost must be a number.");
  if (Number.isNaN(reorderThreshold)) errors.push("Reorder threshold must be a whole number.");

  const vendorName = form.vendor_name.trim();
  if (isCots && !vendorName) {
    errors.push("Vendor is required for COTS items.");
  }

  if (errors.length) {
    return { errors };
  }

  const payload: InventoryPayload = {
    part_name: trimmedName,
    part_type: form.part_type,
    sku: trimmedSku,
    location: trimmedLocation,
    quantity,
    unit_cost: unitCost,
    reorder_threshold: reorderThreshold,
    vendor_name: vendorName || null,
    vendor_link: form.vendor_link.trim() || null,
    tags: form.tags.trim() || null,
  };

  return { errors, payload };
}

function mapInventoryRow(record: CsvRecord): InventoryPayload {
  const get = createRowAccessor(record);
  const part_name = (get("part_name") || "").trim();
  if (!part_name) throw new Error("Missing part_name");
  const partTypeRaw = (get("part_type") || "custom").trim().toLowerCase();
  const part_type: InventoryPartType = partTypeRaw === "cots" ? "cots" : "custom";
  const sku = (get("sku") || "").trim();
  if (!sku) throw new Error("Missing sku");
  const location = (get("location") || "").trim();
  if (!location) throw new Error("Missing location");
  const quantity = Number.parseInt(get("quantity") || "0", 10);
  if (!Number.isFinite(quantity)) throw new Error("Invalid quantity");
  const unit_cost = Number.parseFloat(get("unit_cost") || "0");
  if (!Number.isFinite(unit_cost)) throw new Error("Invalid unit_cost");
  const reorder_threshold = Number.parseInt(get("reorder_threshold") || "0", 10);
  if (!Number.isFinite(reorder_threshold)) throw new Error("Invalid reorder_threshold");
  const vendor_name = (get("vendor_name") || "").trim();
  if (part_type === "cots" && !vendor_name) {
    throw new Error("vendor_name required for COTS items");
  }
  const payload: InventoryPayload = {
    part_name,
    part_type,
    sku,
    location,
    quantity,
    unit_cost,
    reorder_threshold,
    vendor_name: vendor_name || null,
    vendor_link: (get("vendor_link") || "").trim() || null,
    tags: (get("tags") || "").trim() || null,
  };
  return payload;
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

  async function submit(e: FormEvent<HTMLFormElement>) {
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
          <h3>Quick order: {item.part_name}</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
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
            <input type="number" step="0.01" value={form.price_usd} onChange={(e) => updateField("price_usd", e.target.value)} required />
          </label>
          <label>
            Justification
            <textarea value={form.justification} onChange={(e) => updateField("justification", e.target.value)} required rows={3} />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Submitting…" : "Submit order"}
          </button>
        </form>
      </div>
    </div>
  );
}

function sortableValue(item: InventoryItem, key: SortKey): string | number {
  switch (key) {
    case "quantity":
    case "reorder_threshold":
      return item[key] ?? 0;
    case "updated_at":
      return new Date(item.updated_at).getTime();
    default:
      return (item[key] as string | null) ?? "";
  }
}
