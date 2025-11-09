import { useEffect, useState } from "react";
import { api } from "../api";

export function Signup() {
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const full_name = String(data.get("full_name") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    const requested_role = String(data.get("requested_role") ?? "student");
    if (password !== confirm) {
      setMessage("Passwords do not match");
      return;
    }
    try {
      await api.post("/auth/request", { email, full_name, password, requested_role });
      setMessage("Account request submitted. An admin will review it.");
      e.currentTarget.reset();
    } catch (err: any) {
      setMessage(err.response?.data?.detail ?? "Failed to submit request");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Full Name
        <input name="full_name" required />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" required />
      </label>
      <label>
        Confirm Password
        <input name="confirm" type="password" required />
      </label>
      <label>
        Account Type
        <select name="requested_role" defaultValue="student">
          <option value="student">Student</option>
          <option value="lead">Lead</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      {message && <p>{message}</p>}
      <button type="submit">Request Account</button>
    </form>
  );
}
