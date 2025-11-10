import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

function pad2(n:number){ return String(n).padStart(2,"0"); }
function parseClockText(txt: string): {h:number,m:number} | null {
  if (!txt) return null;
  const t = txt.trim().toLowerCase();
  const m = t.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  let mi = m[2] !== undefined ? Number(m[2]) : 0;
  if (isNaN(h) || isNaN(mi) || h < 1 || h > 12 || mi < 0 || mi > 59) return null;
  return {h, m: mi};
}
function to24(h12:number, m:number, ampm:"AM"|"PM"): string { let h = h12 % 12; if (ampm === "PM") h += 12; return `${pad2(h)}:${pad2(m)}`; }

function AccountsTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const show = (t: "ok" | "err", m: string) => { setMsg({ t, m }); setTimeout(() => setMsg(null), 4000); };

  async function refresh(opts?: { search?: string }) {
    const hasSearchOverride = opts && Object.prototype.hasOwnProperty.call(opts, "search");
    const requestedSearch = hasSearchOverride ? opts?.search ?? "" : search;
    const trimmedSearch = requestedSearch.trim();
    if (hasSearchOverride) setSearch(requestedSearch);
    setLoading(true);
    try {
      const usersReq = trimmedSearch
        ? api.get("/auth/users", { params: { search: trimmedSearch } })
        : api.get("/auth/users");
      const [u, p] = await Promise.all([usersReq, api.get("/auth/requests")]);
      setUsers(u.data); setPending(p.data); show("ok","Accounts refreshed");
    } catch(e:any){ show("err", e?.response?.data?.detail || e?.message || "Failed to load accounts"); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ refresh(); },[]);

  async function createUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget));
    try{ await api.post("/auth/create", { email:data.email, full_name:data.full_name, role:data.role, password:data.password, barcode_id:data.barcode_id||null, student_id:data.student_id||null }); (e.target as HTMLFormElement).reset(); show("ok","User created"); refresh(); }
    catch(e:any){ show("err", e?.response?.data?.detail || e?.message || "Failed to create user"); }
  }
  async function approve(id:number, role:string){ try{ await api.post(`/auth/requests/${id}/approve`,{role}); show("ok","Approved"); refresh(); }catch{ show("err","Approve failed"); } }
  async function reject(id:number){ try{ await api.post(`/auth/requests/${id}/reject`); show("ok","Rejected"); refresh(); }catch{ show("err","Reject failed"); } }
  async function updateUserRole(id:number, role:string){ try{ await api.patch(`/auth/users/${id}`,{role}); show("ok","Role updated"); refresh(); }catch{ show("err","Update failed"); } }
  async function updateBarcode(id:number, v:string){ try{ await api.patch(`/auth/users/${id}`,{barcode_id:v||null}); show("ok","Barcode updated"); }catch{ show("err","Update failed"); } }
  async function updateStudentId(id:number, v:string){ try{ await api.patch(`/auth/users/${id}`,{student_id:v||null}); show("ok","Student ID updated"); }catch{ show("err","Update failed"); } }
  const [confirmState, setConfirmState] = useState<{ message: string; action: () => Promise<void> | void } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  async function deleteUserAccount(id:number, name:string){
    setConfirmState({
      message: `Remove ${name}'s account? This cannot be undone.`,
      action: async () => {
        await api.delete(`/auth/users/${id}`);
        show("ok","User removed");
        refresh();
      },
    });
  }

  async function handleConfirm() {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.action();
    } catch (e:any) {
      show("err", e?.response?.data?.detail || e?.message || "Failed to remove user");
    } finally {
      setConfirmBusy(false);
      setConfirmState(null);
    }
  }

  async function handleSearch(e: React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    refresh();
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h3>Accounts</h3><button className="refresh-btn" onClick={()=>refresh()} disabled={loading}>Refresh</button>
      </div>
      {msg && <div className={`notice ${msg.t}`}>{msg.m}</div>}
      <form className="search-row" onSubmit={handleSearch}>
        <label style={{flex:1}}>
          <span className="sr">Search</span>
          <input
            placeholder="Search by name, email, role, barcode, or student ID"
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
        </label>
        <button type="submit" disabled={loading}>Search</button>
        <button type="button" disabled={!search.trim() || loading} onClick={()=>refresh({search:""})}>Clear</button>
      </form>
      <div className="card">
        <h4>Create User</h4>
        <form onSubmit={createUser}>
          <label>Full Name<input name="full_name" required/></label>
          <label>Email<input type="email" name="email" required/></label>
          <label>Password<input type="password" name="password" required/></label>
          <label>Role<select name="role" defaultValue="student"><option value="student">Student</option><option value="lead">Lead</option><option value="admin">Admin</option></select></label>
          <label>Barcode ID<input name="barcode_id"/></label>
          <label>Student ID<input name="student_id"/></label>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card" style={{marginTop:16}}>
        <h4>Pending Requests</h4>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Requested</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map(p=> (
                <tr key={p.id}>
                  <td>{p.full_name}</td><td>{p.email}</td><td>{p.requested_role}</td>
                  <td className="table-actions">
                    <select id={`role-${p.id}`} defaultValue={p.requested_role}><option value="student">Student</option><option value="lead">Lead</option><option value="admin">Admin</option></select>
                    <button onClick={()=>approve(p.id,(document.getElementById(`role-${p.id}`) as HTMLSelectElement).value)}>Approve</button>
                    <button onClick={()=>reject(p.id)}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{marginTop:16}}>
        <h4>Users</h4>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Barcode</th><th>Student ID</th><th></th></tr>
            </thead>
            <tbody>
              {users.map(u=> (
                <tr key={u.id}>
                  <td>{u.full_name}</td><td>{u.email}</td>
                  <td><select defaultValue={u.role} onChange={e=>updateUserRole(u.id,e.target.value)}><option value="student">Student</option><option value="lead">Lead</option><option value="admin">Admin</option></select></td>
                  <td><input defaultValue={u.barcode_id??""} onBlur={e=>updateBarcode(u.id,e.target.value)} /></td>
                  <td><input defaultValue={u.student_id??""} onBlur={e=>updateStudentId(u.id,e.target.value)} /></td>
                  <td className="table-actions">
                    <button type="button" className="danger" onClick={()=>deleteUserAccount(u.id, u.full_name)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirmState)}
        message={confirmState?.message ?? ""}
        onConfirm={handleConfirm}
        onCancel={() => !confirmBusy && setConfirmState(null)}
        busy={confirmBusy}
        confirmLabel="Delete"
      />
    </div>
  );
}

function SchedulesTab(){
  const [schedules,setSchedules]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState<{t:"ok"|"err";m:string}|null>(null);
  const show=(t:"ok"|"err",m:string)=>{ setMsg({t,m}); setTimeout(()=>setMsg(null),4000); };
  async function refresh(){ setLoading(true); try{ const r=await api.get("/schedules/"); setSchedules(r.data); show("ok","Schedules refreshed"); } catch(e:any){ show("err", e?.response?.data?.detail || e?.message || "Failed to load schedules"); } finally { setLoading(false); } }
  useEffect(()=>{ refresh(); },[]);

  async function addSchedule(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault(); const fd=new FormData(e.currentTarget);
    const weekday=Number(fd.get("weekday"));
    const sTxt=String(fd.get("start_text")||""); const sAP=String(fd.get("sap")||"AM") as "AM"|"PM";
    const eTxt=String(fd.get("end_text")||""); const eAP=String(fd.get("eap")||"PM") as "AM"|"PM";
    const sParsed=parseClockText(sTxt); const eParsed=parseClockText(eTxt);
    if(!sParsed||!eParsed){ show("err","Enter times like 9 or 9:15"); return; }
    const start_time=to24(sParsed.h,sParsed.m,sAP); const end_time=to24(eParsed.h,eParsed.m,eAP);
    try{ await api.post("/schedules/",{weekday,start_time,end_time,active:true}); (e.target as HTMLFormElement).reset(); show("ok","Block added"); refresh(); }
    catch(e:any){ show("err", e?.response?.data?.detail || e?.message || "Failed to add block"); }
  }
  async function remove(id:number){ try{ await api.delete(`/schedules/${id}`); show("ok","Block removed"); refresh(); } catch{ show("err","Remove failed"); } }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h3>Schedules</h3><button className="refresh-btn" onClick={refresh} disabled={loading}>Refresh</button>
      </div>
      {msg && <div className={`notice ${msg.t}`}>{msg.m}</div>}
      <div className="card">
        <h4>Add Schedule Block</h4>
        <form onSubmit={addSchedule} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px,1fr))",gap:8}}>
          <label>Weekday<select name="weekday" defaultValue="1"><option value="0">Mon</option><option value="1">Tue</option><option value="2">Wed</option><option value="3">Thu</option><option value="4">Fri</option><option value="5">Sat</option><option value="6">Sun</option></select></label>
          <label>Start<input name="start_text" placeholder="e.g. 9 or 9:15"/></label>
          <label>AM/PM<select name="sap" defaultValue="AM"><option value="AM">AM</option><option value="PM">PM</option></select></label>
          <label>End<input name="end_text" placeholder="e.g. 5 or 5:30"/></label>
          <label>AM/PM<select name="eap" defaultValue="PM"><option value="AM">AM</option><option value="PM">PM</option></select></label>
          <div style={{alignSelf:"end"}}><button type="submit">Add Block</button></div>
        </form>
      </div>
      <div className="card" style={{marginTop:16}}>
        <h4>Existing Blocks</h4>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Weekday</th><th>Start</th><th>End</th><th>Active</th><th></th></tr>
            </thead>
            <tbody>
              {schedules.map((b:any)=>(
                <tr key={b.id}>
                  <td>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][b.weekday]}</td>
                  <td>{b.start_time}</td>
                  <td>{b.end_time}</td>
                  <td>{String(b.active)}</td>
                  <td className="table-actions"><button onClick={()=>remove(b.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AdminTab(){ const [tab,setTab]=useState<"accounts"|"schedules">("accounts"); return (
  <section>
    <div style={{display:"flex",gap:8,marginBottom:12}}>
      <button className={tab==="accounts"?"active":""} onClick={()=>setTab("accounts")}>Accounts</button>
      <button className={tab==="schedules"?"active":""} onClick={()=>setTab("schedules")}>Schedules</button>
    </div>
    {tab==="accounts"? <AccountsTab/> : <SchedulesTab/>}
  </section>
); }
