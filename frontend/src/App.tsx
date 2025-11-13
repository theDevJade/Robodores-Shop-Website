import { useEffect, useMemo, useState } from "react";
import { AttendanceTab } from "./components/AttendanceTab";
import { InventoryTab } from "./components/InventoryTab";
import { ManufacturingTab } from "./components/ManufacturingTab";
import { OrdersTab } from "./components/OrdersTab";
import { TicketsTab } from "./components/TicketsTab";
import { useAuth, User } from "./auth";
import { AdminTab } from "./components/AdminTab";
import { Signup } from "./components/Signup";
import { Dashboard } from "./components/Dashboard";
import { api } from "./api";
import logo from "./assets/robodores.png";
import { useViewportScale } from "./useViewportScale";

type TabDefinition = {
  id: string;
  label: string;
  roles: Array<"student" | "lead" | "admin">;
};

const tabs: TabDefinition[] = [
  { id: "dashboard", label: "Dashboard", roles: ["student", "lead", "admin"] },
  { id: "attendance", label: "Attendance", roles: ["student", "lead", "admin"] },
  { id: "manufacturing", label: "Manufacturing", roles: ["student", "lead", "admin"] },
  { id: "orders", label: "Orders", roles: ["student", "lead", "admin"] },
  { id: "inventory", label: "Inventory", roles: ["lead", "admin"] },
  { id: "tickets", label: "Feature Requests", roles: ["student", "lead", "admin"] },
  { id: "admin", label: "Admin", roles: ["admin"] },
];

export default function App() {
  useViewportScale();
  const { user, loading, login, logout, refreshUser } = useAuth();
  const [active, setActive] = useState<string>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kioskMode, setKioskMode] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("portal-theme") as "dark" | "light") || "dark";
  });
  const [isCompactNav, setIsCompactNav] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 720px)").matches;
  });

  useEffect(() => {
    if (!user) return;
    const allowed = tabs.filter((tab) => tab.roles.includes(user.role));
    if (!allowed.find((tab) => tab.id === active)) {
      setActive(allowed[0]?.id ?? "attendance");
    }
  }, [user, active]);

  const isLeadOrAdmin = user?.role === "lead" || user?.role === "admin";

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    try {
      await login(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
    } catch (err: any) {
      setError(err.response?.data?.detail ?? "Unable to login");
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    const stored = localStorage.getItem(`portal-theme-user-${user.id}`) as "dark" | "light" | null;
    if (stored && (stored === "dark" || stored === "light")) {
      setTheme(stored);
    }
  }, [user?.id]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("portal-theme", theme);
    if (user?.id) {
      localStorage.setItem(`portal-theme-user-${user.id}`, theme);
    }
  }, [theme, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 720px)");
    const update = (event: MediaQueryListEvent | MediaQueryList) => setIsCompactNav(event.matches);
    update(media);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const visibleTabs = useMemo(() => {
    if (!user) return [];
    return tabs.filter((tab) => tab.roles.includes(user.role));
  }, [user]);

  const orderedTabs = useMemo(() => {
    if (!kioskMode) return visibleTabs;
    const attendanceTab = visibleTabs.find((tab) => tab.id === "attendance");
    if (!attendanceTab) return visibleTabs;
    return [attendanceTab, ...visibleTabs.filter((tab) => tab.id !== "attendance")];
  }, [visibleTabs, kioskMode]);

  const navTabs = useMemo(() => orderedTabs.filter((tab) => tab.id !== "admin"), [orderedTabs]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return (
      <div className="app-shell">
        <header className="top-bar">
          <div className="brand">
            <img src={logo} alt="Robodores 4255 logo" />
            <div className="brand-text">
              <p>Robotics Shop Portal</p>
              <h1>Robodores 4255</h1>
            </div>
          </div>
          <div className="top-actions">
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
              <span>{theme === "dark" ? "Dark" : "Light"} mode</span>
            </button>
          </div>
        </header>
        <div className="card" style={{ maxWidth: 440, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create Account</button>
          </div>
          {mode === "login" ? (
            <form onSubmit={handleLogin}>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Password
                <input name="password" type="password" required />
              </label>
              {error && <div className="notice err">{error}</div>}
              <button type="submit">Sign In</button>
            </form>
          ) : (
            <Signup />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="brand">
            <img src={logo} alt="Robodores 4255 logo" />
            <div className="brand-text">
              <p>Robotics Shop Portal</p>
              <h1>Robodores 4255</h1>
            </div>
          </div>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`refresh-btn kiosk-toggle top-actions__kiosk ${kioskMode ? "active" : ""}`}
            onClick={() => setKioskMode((prev) => !prev)}
          >
            {kioskMode ? "Exit Kiosk" : "Kiosk Mode"}
          </button>
          {user?.role === "admin" && (
            <button
              type="button"
              className={`refresh-btn admin-nav-btn ${active === "admin" ? "active" : ""}`}
              onClick={() => setActive("admin")}
            >
              {active === "admin" ? "Admin (Open)" : "Admin"}
            </button>
          )}
          <div className="profile-chip">
            <div className="profile-chip-info">
              <span>{user.full_name}</span>
              <small>{user.role.toUpperCase()}</small>
            </div>
            <button type="button" className="refresh-btn" onClick={logout}>
              Sign Out
            </button>
            <button type="button" className="menu-button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      {!isCompactNav && (
        <nav className="tab-bar" role="tablist" aria-label="Primary navigation">
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === active ? "active" : ""}
              onClick={() => setActive(tab.id)}
              aria-current={tab.id === active ? "page" : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}
      {active === "dashboard" && <Dashboard onNavigate={(tab) => setActive(tab)} />}
      {active === "attendance" && <AttendanceTab canViewLogs={Boolean(isLeadOrAdmin)} />}
      {active === "manufacturing" && <ManufacturingTab />}
      {active === "orders" && <OrdersTab canModerate={Boolean(isLeadOrAdmin)} />}
      {active === "inventory" && <InventoryTab canEdit={Boolean(isLeadOrAdmin)} />}
      {active === "tickets" && <TicketsTab />}
      {active === "admin" && <AdminTab />}
      {settingsOpen && (
        <SettingsModal
          user={user}
          refreshUser={refreshUser}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
        />
      )}
      {isCompactNav && (
        <div className="mobile-tab-tray" role="tablist" aria-label="Primary navigation">
          {navTabs.map((tab) => (
            <button
              key={`mobile-${tab.id}`}
              type="button"
              className={tab.id === active ? "active" : ""}
              onClick={() => setActive(tab.id)}
              aria-current={tab.id === active ? "page" : undefined}
            >
              <span>{tab.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="mobile-tab-tray__action"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open account settings"
          >
            Account
          </button>
        </div>
      )}
      {kioskMode && (
        <div className="kiosk-overlay">
          <div className="kiosk-panel">
            <Dashboard
              kiosk
              onNavigate={(tab) => {
                setActive(tab);
                setKioskMode(false);
              }}
            />
            <button className="refresh-btn" onClick={() => setKioskMode(false)} style={{ alignSelf: "flex-end" }}>
              Close Kiosk
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsModal({
  user,
  refreshUser,
  onClose,
  theme,
  onThemeChange,
}: {
  user: User;
  refreshUser: () => Promise<User | null>;
  onClose: () => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
}) {
  const [form, setForm] = useState({
    full_name: user.full_name,
    student_id: user.student_id ?? user.barcode_id ?? "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  useEffect(() => {
    setForm({
      full_name: user.full_name,
      student_id: user.student_id ?? user.barcode_id ?? "",
      password: "",
    });
    setStatus(null);
  }, [user]);

  function updateField<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    const trimmedStudentId = form.student_id.trim();
    try {
      await api.patch("/auth/me", {
        full_name: form.full_name.trim(),
        barcode_id: trimmedStudentId || null,
        student_id: trimmedStudentId || null,
        password: form.password || undefined,
      });
      await refreshUser();
      setForm((prev) => ({ ...prev, password: "" }));
      setStatus({ t: "ok", m: "Profile updated" });
    } catch (error: any) {
      setStatus({ t: "err", m: error?.response?.data?.detail ?? "Update failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card settings-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <div>
            <p className="brand-text" style={{ margin: 0, textTransform: "uppercase", letterSpacing: "0.2em" }}>Settings</p>
            <h3 style={{ margin: "0.2rem 0 0" }}>{user.full_name}</h3>
          </div>
          <button className="refresh-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={saveProfile} className="account-panel__form">
          <label>
            Full Name
            <input value={form.full_name} onChange={(e) => updateField("full_name", e.target.value)} />
          </label>
          <label>
            Student ID
            <input value={form.student_id} onChange={(e) => updateField("student_id", e.target.value)} placeholder="e.g. 123456" />
          </label>
          <label>
            New Password
            <input type="password" value={form.password} onChange={(e) => updateField("password", e.target.value)} placeholder="Leave blank to keep current" />
          </label>
          <div className="theme-toggle-row">
            <span>Theme</span>
            <div className="theme-toggle-controls">
              <button
                type="button"
                className={theme === "dark" ? "active" : ""}
                onClick={() => onThemeChange("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className={theme === "light" ? "active" : ""}
                onClick={() => onThemeChange("light")}
              >
                Light
              </button>
            </div>
            <small className="theme-note">Saved for your account across devices.</small>
          </div>
          {status && <div className={`notice ${status.t}`}>{status.m}</div>}
          <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
        </form>
      </div>
    </div>
  );
}

function SunIcon() {
  return (
    <svg className="sun-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="m12 3 0 2M12 19l0 2M5.64 5.64l1.41 1.41M16.95 16.95l1.41 1.41M3 12l2 0M19 12l2 0M5.64 18.36l1.41-1.41M16.95 7.05l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="moon-icon" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 0 1 11.21 3 7 7 0 1 0 21 12.79Z" />
    </svg>
  );
}
