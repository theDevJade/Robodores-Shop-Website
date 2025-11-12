import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { useAuth } from "../auth";

type ManufacturingType = "cnc" | "printing" | "manual";
type ManufacturingPriority = "low" | "normal" | "urgent";
type ManufacturingStatus =
  | "design_submitted"
  | "ready_for_manufacturing"
  | "in_progress"
  | "quality_check"
  | "completed";

type ManufacturingAssignment = {
  id: number;
  name: string;
  role: string;
};

type ManufacturingPart = {
  id: number;
  part_name: string;
  subsystem: string;
  material: string;
  quantity: number;
  manufacturing_type: ManufacturingType;
  cad_link: string;
  cam_link?: string | null;
  cam_student?: string | null;
  cnc_operator?: string | null;
  material_stock?: string | null;
  printer_assignment?: string | null;
  slicer_profile?: string | null;
  filament_type?: string | null;
  tool_type?: string | null;
  dimensions?: string | null;
  responsible_student?: string | null;
  notes?: string | null;
  priority: ManufacturingPriority;
  status: ManufacturingStatus;
  status_label: string;
  status_locked: boolean;
  lock_reason?: string | null;
  created_at: string;
  updated_at: string;
  assigned_students: ManufacturingAssignment[];
  assigned_leads: ManufacturingAssignment[];
  created_by: ManufacturingAssignment;
  approved_by?: ManufacturingAssignment | null;
  can_move: boolean;
  can_edit: boolean;
  can_assign: boolean;
  student_eta_minutes?: number | null;
  eta_note?: string | null;
  eta_updated_at?: string | null;
  eta_by?: ManufacturingAssignment | null;
  eta_target?: string | null;
  actual_start?: string | null;
  actual_complete?: string | null;
  cad_file_name?: string | null;
  cad_file_url?: string | null;
  cam_file_name?: string | null;
  cam_file_url?: string | null;
};

type LookupUser = {
  id: number;
  name: string;
  role: string;
};

type FilterState = {
  type: ManufacturingType | "all";
  priority: ManufacturingPriority | "all";
  search: string;
};

type NewPartState = {
  part_name: string;
  subsystem: string;
  material: string;
  quantity: number;
  manufacturing_type: ManufacturingType;
  cad_link: string;
  priority: ManufacturingPriority;
  notes: string;
  material_stock: string;
  cam_link: string;
  cam_student: string;
  cnc_operator: string;
  printer_assignment: string;
  slicer_profile: string;
  filament_type: string;
  tool_type: string;
  dimensions: string;
  responsible_student: string;
  assigned_student_ids: number[];
  assigned_lead_ids: number[];
};

const STATUS_COLUMNS: Array<{ status: ManufacturingStatus; label: string; description: string }> = [
  { status: "design_submitted", label: "Pending", description: "Design Submitted" },
  { status: "ready_for_manufacturing", label: "Queued", description: "Ready for Manufacturing" },
  { status: "in_progress", label: "In Progress", description: "Build Underway" },
  { status: "quality_check", label: "Quality Check", description: "Inspection & Fit" },
  { status: "completed", label: "Completed", description: "Released to Team" },
];

const TYPE_SPECIFIC_FIELDS: Record<
  ManufacturingType,
  Array<{ name: keyof NewPartState; label: string; placeholder?: string }>
> = {
  cnc: [
    { name: "cam_link", label: "CAM File Link", placeholder: "Onshape / Fusion CAM link" },
    { name: "cam_student", label: "CAM Student", placeholder: "Student name" },
    { name: "cnc_operator", label: "CNC Operator", placeholder: "Primary operator" },
    { name: "material_stock", label: "Material Stock", placeholder: "Stock length / bin" },
  ],
  printing: [
    { name: "printer_assignment", label: "Printer Assignment", placeholder: "Printer or workstation" },
    { name: "slicer_profile", label: "Slicer Profile", placeholder: "Profile + layer height" },
    { name: "filament_type", label: "Filament Type", placeholder: "PLA / ABS / PETG" },
  ],
  manual: [
    { name: "tool_type", label: "Tool Type", placeholder: "Mill, lathe, hand tools" },
    { name: "dimensions", label: "Dimensions", placeholder: "Critical measurements" },
    { name: "responsible_student", label: "Responsible Student", placeholder: "Lead fabricator" },
  ],
};

const defaultFilters: FilterState = {
  type: "all",
  priority: "all",
  search: "",
};

type ViewPrefs = {
  onlyMine: boolean;
  onlyUrgent: boolean;
  hideOldCompleted: boolean;
  compactMode: boolean;
  collapsed: Record<ManufacturingStatus, boolean>;
};

type ViewPrefsPatch = Partial<Omit<ViewPrefs, "collapsed">> & {
  collapsed?: Partial<Record<ManufacturingStatus, boolean>>;
};

const VIEW_PREF_KEY = "manufacturing_view_prefs";

const defaultViewPrefs: ViewPrefs = {
  onlyMine: false,
  onlyUrgent: false,
  hideOldCompleted: true,
  compactMode: false,
  collapsed: {
    design_submitted: false,
    ready_for_manufacturing: false,
    in_progress: false,
    quality_check: false,
    completed: true,
  },
};

const getDefaultPartState = (): NewPartState => ({
  part_name: "",
  subsystem: "",
  material: "",
  quantity: 1,
  manufacturing_type: "cnc",
  cad_link: "",
  priority: "normal",
  notes: "",
  material_stock: "",
  cam_link: "",
  cam_student: "",
  cnc_operator: "",
  printer_assignment: "",
  slicer_profile: "",
  filament_type: "",
  tool_type: "",
  dimensions: "",
  responsible_student: "",
  assigned_student_ids: [],
  assigned_lead_ids: [],
});

export function ManufacturingTab() {
  const { user } = useAuth();
  const isLead = user?.role === "lead" || user?.role === "admin";
  const [parts, setParts] = useState<ManufacturingPart[]>([]);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [newPartFiles, setNewPartFiles] = useState<{ cad: File | null; cam: File | null }>({ cad: null, cam: null });
  const [viewPrefs, setViewPrefs] = useState<ViewPrefs>(() => {
    if (typeof window === "undefined") return defaultViewPrefs;
    const raw = window.localStorage.getItem(VIEW_PREF_KEY);
    if (!raw) return defaultViewPrefs;
    try {
      const parsed = JSON.parse(raw);
      return {
        ...defaultViewPrefs,
        ...parsed,
        collapsed: { ...defaultViewPrefs.collapsed, ...(parsed?.collapsed ?? {}) },
      };
    } catch {
      return defaultViewPrefs;
    }
  });
  const [lookups, setLookups] = useState<LookupUser[]>([]);
  const [drawerPart, setDrawerPart] = useState<ManufacturingPart | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newPart, setNewPart] = useState<NewPartState>(() => {
    const base = getDefaultPartState();
    if (user && isLead) {
      base.assigned_lead_ids = [user.id];
    }
    return base;
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [etaModal, setEtaModal] = useState<{ part: ManufacturingPart; mode: "claim" | "edit" } | null>(null);

  const resetCreateForm = () => {
    const base = getDefaultPartState();
    if (user && isLead) {
      base.assigned_lead_ids = [user.id];
    }
    setNewPart(base);
    setNewPartFiles({ cad: null, cam: null });
  };
  const updateViewPrefs = (patch: ViewPrefsPatch) => {
    setViewPrefs((prev) => ({
      ...prev,
      ...patch,
      collapsed: patch.collapsed ? { ...prev.collapsed, ...patch.collapsed } : prev.collapsed,
    }));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_PREF_KEY, JSON.stringify(viewPrefs));
  }, [viewPrefs]);

  useEffect(() => {
    refreshParts();
    const id = window.setInterval(() => refreshParts(true), 20000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isLead) return;
    api
      .get<{ users: LookupUser[] }>("/manufacturing/lookups")
      .then((res) => setLookups(res.data.users))
      .catch(() => {
        setToast("Unable to load assignees");
      });
  }, [isLead]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!modalOpen) {
      resetCreateForm();
    }
  }, [modalOpen]);

  const refreshParts = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get<ManufacturingPart[]>("/manufacturing/parts");
      setParts(res.data);
    } catch (error: any) {
      if (!silent) setToast(error?.response?.data?.detail || "Unable to load manufacturing parts");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const myUserId = user?.id ?? null;
  const isMyPart = (part: ManufacturingPart) => {
    if (!myUserId) return false;
    return (
      part.assigned_students.some((student) => student.id === myUserId) ||
      part.assigned_leads.some((lead) => lead.id === myUserId) ||
      part.created_by.id === myUserId
    );
  };

  const filteredParts = useMemo(() => {
    return parts.filter((part) => {
      if (filters.type !== "all" && part.manufacturing_type !== filters.type) return false;
      if (filters.priority !== "all" && part.priority !== filters.priority) return false;
      if (filters.search) {
        const haystack = `${part.part_name} ${part.subsystem} ${part.material}`.toLowerCase();
        if (!haystack.includes(filters.search.toLowerCase())) return false;
      }
      if (viewPrefs.onlyMine && (!myUserId || !isMyPart(part))) return false;
      if (viewPrefs.onlyUrgent && part.priority !== "urgent") return false;
      if (viewPrefs.hideOldCompleted && part.status === "completed" && isOlderThan(part.updated_at, 7)) {
        return false;
      }
      return true;
    });
  }, [parts, filters, viewPrefs, myUserId]);

  const groupedByStatus = useMemo(() => {
    const bucket: Record<ManufacturingStatus, ManufacturingPart[]> = {
      design_submitted: [],
      ready_for_manufacturing: [],
      in_progress: [],
      quality_check: [],
      completed: [],
    };
    filteredParts.forEach((part) => bucket[part.status].push(part));
    return bucket;
  }, [filteredParts]);

  const updateNewPart = (field: keyof NewPartState, value: string | number | number[]) => {
    setNewPart((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const payload: Record<string, any> = {
      part_name: newPart.part_name.trim(),
      subsystem: newPart.subsystem.trim(),
      material: newPart.material.trim(),
      cad_link: newPart.cad_link.trim(),
      quantity: newPart.quantity,
      manufacturing_type: newPart.manufacturing_type,
      priority: newPart.priority,
      notes: newPart.notes.trim() || null,
      material_stock: newPart.material_stock.trim() || null,
      cam_link: newPart.cam_link.trim() || null,
      cam_student: newPart.cam_student.trim() || null,
      cnc_operator: newPart.cnc_operator.trim() || null,
      printer_assignment: newPart.printer_assignment.trim() || null,
      slicer_profile: newPart.slicer_profile.trim() || null,
      filament_type: newPart.filament_type.trim() || null,
      tool_type: newPart.tool_type.trim() || null,
      dimensions: newPart.dimensions.trim() || null,
      responsible_student: newPart.responsible_student.trim() || null,
    };
    if (isLead) {
      payload.assigned_student_ids = newPart.assigned_student_ids;
      const leadIds = Array.from(new Set([...newPart.assigned_lead_ids, ...(user ? [user.id] : [])]));
      payload.assigned_lead_ids = leadIds;
    }
    setSubmitting(true);
    try {
      const res = await api.post<ManufacturingPart>("/manufacturing/parts", payload);
      const created = res.data;
      if (newPartFiles.cad || newPartFiles.cam) {
        try {
          await uploadPartFiles(created.id, newPartFiles);
        } catch (error: any) {
          setToast(error?.response?.data?.detail || "File upload failed");
        }
      }
      setToast(`Created ${newPart.part_name || "request"}`);
      setModalOpen(false);
      resetCreateForm();
      refreshParts();
    } catch (error: any) {
      setToast(error?.response?.data?.detail || "Unable to create part");
    } finally {
      setSubmitting(false);
    }
  };

  const updatePartInState = (next: ManufacturingPart) => {
    setParts((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    setDrawerPart((prev) => (prev && prev.id === next.id ? next : prev));
  };

  const movePart = async (partId: number, status: ManufacturingStatus) => {
    try {
      const res = await api.post<ManufacturingPart>(`/manufacturing/parts/${partId}/status`, { status });
      updatePartInState(res.data);
    } catch (error: any) {
      setToast(error?.response?.data?.detail ?? "Unable to move part");
    }
  };

  const releasePart = async (partId: number) => {
    try {
      const res = await api.post<ManufacturingPart>(`/manufacturing/parts/${partId}/unclaim`);
      updatePartInState(res.data);
    } catch (error: any) {
      setToast(error?.response?.data?.detail ?? "Unable to release part");
    }
  };

  const uploadPartFiles = async (partId: number, files: { cad?: File | null; cam?: File | null }) => {
    const form = new FormData();
    if (files.cad) form.append("cad_file", files.cad);
    if (files.cam) form.append("cam_file", files.cam);
    if (!form.has("cad_file") && !form.has("cam_file")) return;
    await api.post(`/manufacturing/parts/${partId}/files`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  };

  const handleUploadFile = async (partId: number, type: "cad" | "cam", file: File) => {
    try {
      await uploadPartFiles(partId, type === "cad" ? { cad: file } : { cam: file });
      setToast(`${type.toUpperCase()} file uploaded`);
      refreshParts(true);
    } catch (error: any) {
      setToast(error?.response?.data?.detail || "Upload failed");
    }
  };

  const deletePart = async (part: ManufacturingPart) => {
    if (!window.confirm(`Delete ${part.part_name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/manufacturing/parts/${part.id}`);
      setParts((prev) => prev.filter((p) => p.id !== part.id));
      setToast("Part deleted");
    } catch (error: any) {
      setToast(error?.response?.data?.detail || "Unable to delete part");
    }
  };

  const handleEtaSubmit = async (
    target: { part: ManufacturingPart; mode: "claim" | "edit" },
    etaIso: string,
    note: string,
  ) => {
    try {
      const body = { eta_target: etaIso, eta_note: note || null };
      const url =
        target.mode === "claim"
          ? `/manufacturing/parts/${target.part.id}/claim`
          : `/manufacturing/parts/${target.part.id}/eta`;
      const res = await api.post<ManufacturingPart>(url, body);
      updatePartInState(res.data);
      setEtaModal(null);
      setToast(target.mode === "claim" ? "Part claimed" : "ETA updated");
    } catch (error: any) {
      setToast(error?.response?.data?.detail || "Unable to save ETA");
    }
  };

  const boardClasses = ["manufacturing"];
  if (viewPrefs.compactMode) boardClasses.push("compact");

  return (
    <section className={boardClasses.join(" ")}>
      <div className="manufacturing-top card">
        <div className="top-line">
          <div>
            <h3>Manufacturing Workflow</h3>
            <p className="stat-muted">
              Design through delivery for CNC, printing, and manual builds in a single board.
            </p>
          </div>
        </div>
        <div className="control-row">
          <div className="toolbar-fields">
            <label>
              Type
              <select
                value={filters.type}
                onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value as FilterState["type"] }))}
              >
                <option value="all">All</option>
                <option value="cnc">CNC</option>
                <option value="printing">3D Printing</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label>
              Priority
              <select
                value={filters.priority}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, priority: event.target.value as FilterState["priority"] }))
                }
              >
                <option value="all">All</option>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          <label className="search">
            <span className="sr-only">Search</span>
            <input
              placeholder="Search part, subsystem, or material"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
          </label>
          <div className="action-buttons">
            <button type="button" onClick={() => setModalOpen(true)}>
              Create Request
            </button>
            <button className="refresh-btn" onClick={() => refreshParts()} disabled={loading}>
              Refresh
            </button>
          </div>
          <div className="view-toggles">
            <button
              type="button"
              className={viewPrefs.onlyMine ? "chip-toggle active" : "chip-toggle"}
              onClick={() => updateViewPrefs({ onlyMine: !viewPrefs.onlyMine })}
            >
              My Work
            </button>
            <button
              type="button"
              className={viewPrefs.onlyUrgent ? "chip-toggle active" : "chip-toggle"}
              onClick={() => updateViewPrefs({ onlyUrgent: !viewPrefs.onlyUrgent })}
            >
              Urgent Only
            </button>
            <button
              type="button"
              className={viewPrefs.hideOldCompleted ? "chip-toggle active" : "chip-toggle"}
              onClick={() => updateViewPrefs({ hideOldCompleted: !viewPrefs.hideOldCompleted })}
            >
              Hide Old Completed
            </button>
            <button
              type="button"
              className={viewPrefs.compactMode ? "chip-toggle active" : "chip-toggle"}
              onClick={() => updateViewPrefs({ compactMode: !viewPrefs.compactMode })}
            >
              Compact Mode
            </button>
          </div>
        </div>
      </div>
      <div className={`kanban-board ${viewPrefs.compactMode ? "compact" : ""}`}>
        {STATUS_COLUMNS.map((column) => {
          const laneItems = groupedByStatus[column.status];
          const laneEta = laneItems.reduce((sum, part) => sum + (part.student_eta_minutes ?? 0), 0);
          const collapsed = viewPrefs.collapsed[column.status];
          return (
            <div
              key={column.status}
              className={`kanban-column ${collapsed ? "is-collapsed" : ""}`}
              onDragOver={(event) => {
                if (draggingId !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const partId = draggingId ?? Number(event.dataTransfer.getData("text/plain"));
                if (!Number.isNaN(partId)) movePart(partId, column.status);
                setDraggingId(null);
              }}
            >
              <header>
                <div>
                  <h4>{column.label}</h4>
                  <small>{column.description}</small>
                </div>
                <div className="lane-meta">
                  <span className="stat-muted">
                    {laneItems.length} • {laneEta ? `ETA ~${formatDuration(laneEta)}` : "ETA n/a"}
                  </span>
                  <button
                    type="button"
                    className="collapse-btn"
                    onClick={() =>
                      updateViewPrefs({ collapsed: { [column.status]: !collapsed } })
                    }
                  >
                    {collapsed ? "Expand" : "Collapse"}
                  </button>
                </div>
              </header>
              <div className={`kanban-body ${collapsed ? "collapsed" : ""}`}>
                <div className="kanban-items">
                  {laneItems.length === 0 && (
                    <p className="stat-muted empty-slot">Drop parts here to move them.</p>
                  )}
                  {laneItems.map((part) => (
                    <PartCard
                      key={part.id}
                      part={part}
                      dragging={draggingId === part.id}
                      onOpen={() => setDrawerPart(part)}
                      onDragStart={(event) => {
                        if (!part.can_move) return;
                        setDraggingId(part.id);
                        event.dataTransfer.setData("text/plain", String(part.id));
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      onClaim={() => setEtaModal({ part, mode: "claim" })}
                      onRelease={() => releasePart(part.id)}
                      currentUserId={user?.id ?? null}
                      compact={viewPrefs.compactMode}
                      canEditEta={Boolean(isLead || (user && isMyPart(part)))}
                      onRequestEtaUpdate={() => setEtaModal({ part, mode: "edit" })}
                      canDelete={Boolean(isLead || (user && part.created_by.id === user.id))}
                      onDelete={() => deletePart(part)}
                    />
                  ))}
                </div>
              </div>
              {collapsed && (
                <div className="lane-collapsed">
                  <p className="stat-muted">Lane collapsed. Expand to view cards.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {modalOpen && (
        <CreateModal
          isLead={isLead}
          lookups={lookups}
          state={newPart}
          onChange={updateNewPart}
          onClose={() => setModalOpen(false)}
          onSubmit={handleCreate}
          submitting={submitting}
          files={newPartFiles}
          onFilesChange={setNewPartFiles}
        />
      )}
      {drawerPart && (
        <PartDrawer
          part={drawerPart}
          lookups={lookups}
          isLead={isLead}
          currentUserId={user?.id ?? null}
          onClose={() => setDrawerPart(null)}
          onUpdated={updatePartInState}
          onStatusChange={(status) => movePart(drawerPart.id, status)}
          onClaim={() => setEtaModal({ part: drawerPart, mode: "claim" })}
          onRelease={() => releasePart(drawerPart.id)}
          onRequestEtaUpdate={() => setEtaModal({ part: drawerPart, mode: "edit" })}
          onUploadFile={(type, file) => handleUploadFile(drawerPart.id, type, file)}
          onDelete={() => {
            deletePart(drawerPart);
            setDrawerPart(null);
          }}
        />
      )}
      {etaModal && (
        <EtaModal
          mode={etaModal.mode}
          part={etaModal.part}
          onClose={() => setEtaModal(null)}
          onSubmit={(iso, note) => handleEtaSubmit(etaModal, iso, note)}
        />
      )}
      {toast && <div className="notice ok" style={{ marginTop: 16 }}>{toast}</div>}
    </section>
  );
}

const CreateModal = ({
  isLead,
  lookups,
  state,
  onChange,
  onClose,
  onSubmit,
  submitting,
  files,
  onFilesChange,
}: {
  isLead: boolean;
  lookups: LookupUser[];
  state: NewPartState;
  onChange: (field: keyof NewPartState, value: string | number | number[]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  files: { cad: File | null; cam: File | null };
  onFilesChange: (files: { cad: File | null; cam: File | null }) => void;
}) => {
  const studentOptions = lookups.filter((entry) => entry.role === "student");
  const leadOptions = lookups.filter((entry) => entry.role !== "student");

  return (
    <div className="modal-backdrop manufacturing-create-backdrop">
      <div className="modal card manufacturing-modal">
        <header className="drawer-header">
          <div>
            <p className="subtle">New Request</p>
            <h3>Create Manufacturing Request</h3>
          </div>
          <button className="refresh-btn" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="drawer-form" onSubmit={onSubmit}>
          <div className="form-grid">
            <label>
              <RequiredLabel>Part Name</RequiredLabel>
              <input value={state.part_name} onChange={(e) => onChange("part_name", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Subsystem</RequiredLabel>
              <input value={state.subsystem} onChange={(e) => onChange("subsystem", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Material</RequiredLabel>
              <input value={state.material} onChange={(e) => onChange("material", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Quantity</RequiredLabel>
              <input
                type="number"
                min={1}
                value={state.quantity}
                onChange={(e) => onChange("quantity", Number(e.target.value) || 1)}
                required
              />
            </label>
            <label>
              <RequiredLabel>Manufacturing Type</RequiredLabel>
              <select
                value={state.manufacturing_type}
                onChange={(e) => onChange("manufacturing_type", e.target.value as ManufacturingType)}
              >
                <option value="cnc">CNC</option>
                <option value="printing">3D Printing</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label>
              <RequiredLabel>CAD Link</RequiredLabel>
              <input value={state.cad_link} onChange={(e) => onChange("cad_link", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Priority</RequiredLabel>
              <select
                value={state.priority}
                onChange={(e) => onChange("priority", e.target.value as ManufacturingPriority)}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label className="full-width">
            Notes
            <textarea value={state.notes} onChange={(e) => onChange("notes", e.target.value)} rows={3} />
          </label>
          <div className="type-grid">
            {TYPE_SPECIFIC_FIELDS[state.manufacturing_type].map((field) => (
              <label key={field.name}>
                <RequiredLabel>{field.label}</RequiredLabel>
                <input
                  value={(state[field.name] as string) ?? ""}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  required
                />
              </label>
            ))}
          </div>
          <div className="file-grid">
            <label>
              CAD File Upload
              <input
                type="file"
                accept=".step,.stp,.iges,.sldprt,.zip,.3mf,.stl"
                onChange={(e) => onFilesChange({ ...files, cad: e.target.files?.[0] ?? null })}
              />
              {files.cad && <small>Selected: {files.cad.name}</small>}
            </label>
            <label>
              CAM File Upload
              <input
                type="file"
                accept=".tap,.nc,.gcode,.zip"
                onChange={(e) => onFilesChange({ ...files, cam: e.target.files?.[0] ?? null })}
              />
              {files.cam && <small>Selected: {files.cam.name}</small>}
            </label>
          </div>
          {isLead ? (
            <div className="assignment-grid">
              <AssigneePicker
                label="Assign Students"
                people={studentOptions}
                selectedIds={state.assigned_student_ids}
                onChange={(ids) => onChange("assigned_student_ids", ids)}
                placeholder="Search student names"
              />
              <AssigneePicker
                label="Assign Leads"
                people={leadOptions}
                selectedIds={state.assigned_lead_ids}
                onChange={(ids) => onChange("assigned_lead_ids", ids)}
                placeholder="Search leads or admins"
              />
            </div>
          ) : (
            <p className="stat-muted">
              You will be assigned automatically so your work stays traceable.
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Add to Board"}
          </button>
        </form>
      </div>
    </div>
  );
};

function PartCard({
  part,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onClaim,
  onRelease,
  onRequestEtaUpdate,
  onDelete,
  currentUserId,
  compact,
  canEditEta,
  canDelete,
}: {
  part: ManufacturingPart;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onClaim: () => void;
  onRelease: () => void;
  onRequestEtaUpdate: () => void;
  onDelete: () => void;
  currentUserId: number | null;
  compact: boolean;
  canEditEta: boolean;
  canDelete: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const assignedIds = part.assigned_students.map((student) => student.id);
  const isOwner = currentUserId !== null && assignedIds.includes(currentUserId);
  const keyFacts =
    part.manufacturing_type === "cnc"
      ? [
          { label: "CAM", value: part.cam_student },
          { label: "Operator", value: part.cnc_operator },
          { label: "Stock", value: part.material_stock },
        ]
      : part.manufacturing_type === "printing"
      ? [
          { label: "Printer", value: part.printer_assignment },
          { label: "Profile", value: part.slicer_profile },
          { label: "Filament", value: part.filament_type },
        ]
      : [
          { label: "Tool", value: part.tool_type },
          { label: "Dims", value: part.dimensions },
          { label: "Owner", value: part.responsible_student },
        ];

  const etaLabel = part.student_eta_minutes ? formatDuration(part.student_eta_minutes) : null;
  const etaDueText = part.eta_target ? new Date(part.eta_target).toLocaleString() : null;
  const etaStale = part.eta_updated_at ? isOlderThan(part.eta_updated_at, 1) : false;

  return (
    <div
      className={`manufacturing-card priority-${part.priority} ${dragging ? "dragging" : ""} ${
        compact ? "compact" : ""
      } ${expanded ? "expanded" : ""}`}
      draggable={part.can_move}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="manufacturing-card__header">
        <div>
          <p className="subtle">{part.subsystem}</p>
          <h4>{part.part_name}</h4>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`priority-pill ${part.priority}`}>{part.priority.toUpperCase()}</span>
          <button type="button" className="mini-link" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      <div className="manufacturing-card__meta">
        <span className="type-pill">{part.manufacturing_type.toUpperCase()}</span>
        <span>Qty {part.quantity}</span>
        {part.status_locked && <span className="lock-pill">Locked</span>}
      </div>
      <div className="assignees">
        {part.assigned_students.length ? (
          part.assigned_students.slice(0, 2).map((person) => (
            <span key={person.id} className="assignment-chip">
              {person.name.split(" ")[0]}
            </span>
          ))
        ) : (
          <span className="stat-muted">Unclaimed</span>
        )}
        {part.assigned_students.length > 2 && (
          <span className="assignment-chip">+{part.assigned_students.length - 2}</span>
        )}
      </div>
      {expanded && (
        <div className="fact-grid">
          {keyFacts
            .filter((fact) => fact.value)
            .map((fact) => (
              <span key={fact.label}>
                <strong>{fact.label}:</strong> {fact.value}
              </span>
            ))}
        </div>
      )}
      {(etaLabel || canEditEta) && (
        <div className="eta-row">
          <span className={`eta-chip ${etaStale ? "stale" : ""}`}>
            {etaLabel ? `ETA ${etaLabel}` : "ETA needed"}
            {etaStale && etaLabel && <small> Update requested</small>}
          </span>
          {etaDueText && <small>Due {etaDueText}</small>}
          {canEditEta && (
            <button type="button" className="mini-link" onClick={onRequestEtaUpdate}>
              {etaLabel ? "Update ETA" : "Set ETA"}
            </button>
          )}
        </div>
      )}
      {expanded && (
        <>
          <div className="cad-link">
            <a href={part.cad_link} target="_blank" rel="noreferrer">
              Open CAD
            </a>
            {part.notes && <span className="note-indicator">Notes</span>}
          </div>
          {(part.cad_file_url || part.cam_file_url) && (
            <div className="file-links">
              {part.cad_file_url && (
                <a className="file-pill" href={part.cad_file_url} target="_blank" rel="noreferrer">
                  CAD Download
                </a>
              )}
              {part.cam_file_url && (
                <a className="file-pill" href={part.cam_file_url} target="_blank" rel="noreferrer">
                  CAM Download
                </a>
              )}
            </div>
          )}
        </>
      )}
      <div className="manufacturing-card__actions">
        <button className="refresh-btn" onClick={onOpen}>
          Details
        </button>
        {currentUserId && !assignedIds.includes(currentUserId) && (
          <button onClick={onClaim}>Claim</button>
        )}
        {isOwner && (
          <button className="refresh-btn" onClick={onRelease}>
            Release
          </button>
        )}
        {canDelete && (
          <button className="danger-btn" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function PartDrawer({
  part,
  lookups,
  isLead,
  currentUserId,
  onClose,
  onUpdated,
  onStatusChange,
  onClaim,
  onRelease,
  onRequestEtaUpdate,
  onUploadFile,
  onDelete,
}: {
  part: ManufacturingPart;
  lookups: LookupUser[];
  isLead: boolean;
  currentUserId: number | null;
  onClose: () => void;
  onUpdated: (part: ManufacturingPart) => void;
  onStatusChange: (status: ManufacturingStatus) => void;
  onClaim: () => void;
  onRelease: () => void;
  onRequestEtaUpdate: () => void;
  onUploadFile: (type: "cad" | "cam", file: File) => Promise<void>;
  onDelete: () => void;
}) {
  const [state, setState] = useState(() => toEditable(part));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ManufacturingStatus>(part.status);

  const studentOptions = lookups.filter((entry) => entry.role === "student");
  const leadOptions = lookups.filter((entry) => entry.role !== "student");
  const canUpdateEta =
    isLead ||
    (currentUserId !== null &&
      (part.assigned_students.some((student) => student.id === currentUserId) ||
        part.assigned_leads.some((lead) => lead.id === currentUserId)));
  const etaLabel = part.student_eta_minutes ? formatDuration(part.student_eta_minutes) : null;
  const etaDueText = part.eta_target ? new Date(part.eta_target).toLocaleString() : null;
  const [uploading, setUploading] = useState<{ cad: boolean; cam: boolean }>({ cad: false, cam: false });

  useEffect(() => {
    setState(toEditable(part));
    setStatus(part.status);
  }, [part]);

  const handleChange = (field: keyof EditablePartState, value: any) => {
    setState((prev) => ({ ...prev, [field]: value }));
  };

  const handleUpload = async (type: "cad" | "cam", file: File | null, input: HTMLInputElement | null) => {
    if (!file) return;
    setUploading((prev) => ({ ...prev, [type]: true }));
    try {
      await onUploadFile(type, file);
    } finally {
      setUploading((prev) => ({ ...prev, [type]: false }));
      if (input) input.value = "";
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        part_name: state.part_name,
        subsystem: state.subsystem,
        material: state.material,
        quantity: state.quantity,
        cad_link: state.cad_link,
        notes: state.notes || null,
        material_stock: state.material_stock || null,
        cam_link: state.cam_link || null,
        cam_student: state.cam_student || null,
        cnc_operator: state.cnc_operator || null,
        printer_assignment: state.printer_assignment || null,
        slicer_profile: state.slicer_profile || null,
        filament_type: state.filament_type || null,
        tool_type: state.tool_type || null,
        dimensions: state.dimensions || null,
        responsible_student: state.responsible_student || null,
      };
      if (isLead) {
        payload.manufacturing_type = state.manufacturing_type;
        payload.priority = state.priority;
        payload.assigned_student_ids = state.assigned_student_ids;
        payload.assigned_lead_ids = state.assigned_lead_ids;
      }
      const res = await api.patch<ManufacturingPart>(`/manufacturing/parts/${part.id}`, payload);
      onUpdated(res.data);
    } catch (error: any) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop manufacturing-drawer-backdrop">
      <div className="modal card manufacturing-drawer">
        <header className="drawer-header">
          <div>
            <p className="subtle">{part.manufacturing_type.toUpperCase()}</p>
            <h3>{part.part_name}</h3>
          </div>
          <button className="refresh-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="drawer-form" onSubmit={handleSave}>
          <div className="form-grid">
            <label>
              <RequiredLabel>Part Name</RequiredLabel>
              <input value={state.part_name} onChange={(e) => handleChange("part_name", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Subsystem</RequiredLabel>
              <input value={state.subsystem} onChange={(e) => handleChange("subsystem", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Material</RequiredLabel>
              <input value={state.material} onChange={(e) => handleChange("material", e.target.value)} required />
            </label>
            <label>
              <RequiredLabel>Quantity</RequiredLabel>
              <input
                type="number"
                min={1}
                value={state.quantity}
                onChange={(e) => handleChange("quantity", Number(e.target.value))}
                required
              />
            </label>
            <label>
              <RequiredLabel>CAD Link</RequiredLabel>
              <input value={state.cad_link} onChange={(e) => handleChange("cad_link", e.target.value)} required />
            </label>
            {isLead && (
              <>
                <label>
                  <RequiredLabel>Manufacturing Type</RequiredLabel>
                  <select
                    value={state.manufacturing_type}
                    onChange={(e) => handleChange("manufacturing_type", e.target.value)}
                  >
                    <option value="cnc">CNC</option>
                    <option value="printing">3D Printing</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <label>
                  <RequiredLabel>Priority</RequiredLabel>
                  <select value={state.priority} onChange={(e) => handleChange("priority", e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </>
            )}
            <label className="full-width">
              Notes
              <textarea value={state.notes} onChange={(e) => handleChange("notes", e.target.value)} rows={3} />
            </label>
          </div>
          <div className="type-grid">
            {TYPE_SPECIFIC_FIELDS[state.manufacturing_type].map((field) => (
              <label key={field.name}>
                <RequiredLabel>{field.label}</RequiredLabel>
                <input
                  value={(state[field.name] as string) ?? ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  required
                />
              </label>
            ))}
          </div>
          {isLead && (
            <div className="assignment-grid">
              <AssigneePicker
                label="Assigned Students"
                people={studentOptions}
                selectedIds={state.assigned_student_ids}
                onChange={(ids) => handleChange("assigned_student_ids", ids)}
                placeholder="Search student names"
              />
              <AssigneePicker
                label="Assigned Leads"
                people={leadOptions}
                selectedIds={state.assigned_lead_ids}
                onChange={(ids) => handleChange("assigned_lead_ids", ids)}
                placeholder="Search leads or admins"
              />
            </div>
          )}
          <div className="file-section">
            <div className="file-row">
              <div>
                <strong>CAD File</strong>
                {part.cad_file_name ? (
                  <a href={part.cad_file_url ?? "#"} target="_blank" rel="noreferrer">
                    {part.cad_file_name}
                  </a>
                ) : (
                  <p className="stat-muted">No CAD file uploaded</p>
                )}
              </div>
              <label className="file-upload-btn">
                {uploading.cad ? "Uploading..." : "Upload"}
                <input
                  type="file"
                  accept=".step,.stp,.iges,.sldprt,.zip,.3mf,.stl"
                  disabled={uploading.cad}
                  onChange={(e) => handleUpload("cad", e.target.files?.[0] ?? null, e.target)}
                  hidden
                />
              </label>
            </div>
            <div className="file-row">
              <div>
                <strong>CAM File</strong>
                {part.cam_file_name ? (
                  <a href={part.cam_file_url ?? "#"} target="_blank" rel="noreferrer">
                    {part.cam_file_name}
                  </a>
                ) : (
                  <p className="stat-muted">No CAM file uploaded</p>
                )}
              </div>
              <label className="file-upload-btn">
                {uploading.cam ? "Uploading..." : "Upload"}
                <input
                  type="file"
                  accept=".tap,.nc,.gcode,.zip"
                  disabled={uploading.cam}
                  onChange={(e) => handleUpload("cam", e.target.files?.[0] ?? null, e.target)}
                  hidden
                />
              </label>
            </div>
          </div>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
        <div className="eta-detail">
          <div>
            <strong>ETA</strong>
            <p>{etaLabel ? `~${etaLabel}` : "Not provided"}</p>
            {part.eta_by && (
              <small>Updated by {part.eta_by.name}{part.eta_updated_at ? ` • ${new Date(part.eta_updated_at).toLocaleString()}` : ""}</small>
            )}
            {etaDueText && <small>Due {etaDueText}</small>}
          </div>
          {canUpdateEta && (
            <button type="button" className="refresh-btn" onClick={onRequestEtaUpdate}>
              {etaLabel ? "Update ETA" : "Set ETA"}
            </button>
          )}
        </div>
        <div className="workflow-form">
          <label>
            Stage
            <select value={status} onChange={(e) => setStatus(e.target.value as ManufacturingStatus)}>
              {STATUS_COLUMNS.map((column) => (
                <option key={column.status} value={column.status}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <div className="workflow-actions">
            <button type="button" onClick={() => onStatusChange(status)}>
              Update Stage
            </button>
            <button className="refresh-btn" type="button" onClick={onClaim}>
              Claim
            </button>
            <button className="refresh-btn" type="button" onClick={onRelease}>
              Release
            </button>
            {(isLead || (currentUserId && part.created_by.id === currentUserId)) && (
              <button
                type="button"
                className="danger-btn"
                onClick={onDelete}
              >
                Delete Part
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type EditablePartState = {
  part_name: string;
  subsystem: string;
  material: string;
  quantity: number;
  cad_link: string;
  notes: string;
  manufacturing_type: ManufacturingType;
  priority: ManufacturingPriority;
  material_stock: string;
  cam_link: string;
  cam_student: string;
  cnc_operator: string;
  printer_assignment: string;
  slicer_profile: string;
  filament_type: string;
  tool_type: string;
  dimensions: string;
  responsible_student: string;
  assigned_student_ids: number[];
  assigned_lead_ids: number[];
};

function toEditable(part: ManufacturingPart): EditablePartState {
  return {
    part_name: part.part_name,
    subsystem: part.subsystem,
    material: part.material,
    quantity: part.quantity,
    cad_link: part.cad_link,
    notes: part.notes ?? "",
    manufacturing_type: part.manufacturing_type,
    priority: part.priority,
    material_stock: part.material_stock ?? "",
    cam_link: part.cam_link ?? "",
    cam_student: part.cam_student ?? "",
    cnc_operator: part.cnc_operator ?? "",
    printer_assignment: part.printer_assignment ?? "",
    slicer_profile: part.slicer_profile ?? "",
    filament_type: part.filament_type ?? "",
    tool_type: part.tool_type ?? "",
    dimensions: part.dimensions ?? "",
    responsible_student: part.responsible_student ?? "",
    assigned_student_ids: part.assigned_students.map((s) => s.id),
    assigned_lead_ids: part.assigned_leads.map((l) => l.id),
  };
}

type EtaModalProps = {
  mode: "claim" | "edit";
  part: ManufacturingPart;
  onClose: () => void;
  onSubmit: (etaIso: string, note: string) => Promise<void>;
};

function EtaModal({ mode, part, onClose, onSubmit }: EtaModalProps) {
  const defaultTarget = part.eta_target ? new Date(part.eta_target) : new Date(Date.now() + 2 * 60 * 60 * 1000);
  const [date, setDate] = useState(defaultTarget.toISOString().slice(0, 10));
  const [time, setTime] = useState(defaultTarget.toISOString().slice(11, 16));
  const [note, setNote] = useState(part.eta_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!date || !time) {
      setError("Select a date and time.");
      return;
    }
    const target = new Date(`${date}T${time}`);
    if (Number.isNaN(target.getTime())) {
      setError("Invalid date/time");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(target.toISOString(), note);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Unable to save ETA");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop manufacturing-create-backdrop">
      <div className="modal card manufacturing-modal">
        <header className="drawer-header">
          <div>
            <p className="subtle">{mode === "claim" ? "Claim Part" : "Update ETA"}</p>
            <h3>{part.part_name}</h3>
          </div>
          <button className="refresh-btn" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="drawer-form" onSubmit={handleSubmit}>
          <label>
            <RequiredLabel>Due Date</RequiredLabel>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            <RequiredLabel>Due Time</RequiredLabel>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </label>
          <label>
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional context" />
          </label>
          {error && <div className="notice err">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? "Saving..." : mode === "claim" ? "Claim with ETA" : "Save ETA"}
          </button>
        </form>
      </div>
    </div>
  );
}

type AssigneePickerProps = {
  label: string;
  people: LookupUser[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
};

function AssigneePicker({ label, people, selectedIds, onChange, placeholder }: AssigneePickerProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const map = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  const selectedPeople = selectedIds.map((id) => map.get(id) ?? { id, name: `User #${id}`, role: "student" });

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return people.filter(
      (person) => !selectedIds.includes(person.id) && person.name.toLowerCase().includes(needle),
    );
  }, [query, people, selectedIds]);

  const addPerson = (person: LookupUser) => {
    if (selectedIds.includes(person.id)) return;
    onChange([...selectedIds, person.id]);
    setQuery("");
  };

  const removePerson = (id: number) => {
    onChange(selectedIds.filter((value) => value !== id));
  };

  return (
    <div className="assignee-picker">
      <label>{label}</label>
      <div className="assignee-chip-row">
        {selectedPeople.map((person) => (
          <span className="assignee-chip" key={person.id}>
            {person.name}
            <button type="button" onClick={() => removePerson(person.id)} aria-label={`Remove ${person.name}`}>
              ×
            </button>
          </span>
        ))}
        {selectedPeople.length === 0 && <span className="stat-muted">No assignees yet</span>}
      </div>
      <div className="assignee-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 100)}
        />
        {focused && suggestions.length > 0 && (
          <ul className="assignee-suggestions">
            {suggestions.map((person) => (
              <li key={person.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addPerson(person)}>
                  <strong>{person.name}</strong>
                  <span>{person.role.toUpperCase()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequiredLabel({ children }: { children: ReactNode }) {
  return (
    <span className="required-label">
      <span>{children}</span>
      <span className="required-star" aria-hidden="true">
        *
      </span>
    </span>
  );
}

function formatDuration(minutes?: number | null): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes <= 0) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function isOlderThan(dateString: string | null | undefined, days: number): boolean {
  if (!dateString) return false;
  const stamp = new Date(dateString).getTime();
  if (Number.isNaN(stamp)) return false;
  return Date.now() - stamp > days * 24 * 60 * 60 * 1000;
}
