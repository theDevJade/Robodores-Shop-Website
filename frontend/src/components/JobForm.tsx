import { useState, useEffect } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { JobsQueue } from "./JobsQueue";
import { ExportPanel } from "./ExportPanel";

export function JobForm({ shop }: { shop: "cnc" | "printing" }) {
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const [ownerNameDefault, setOwnerNameDefault] = useState("");

  useEffect(() => {
    setOwnerNameDefault(user?.full_name ?? "");
  }, [user?.full_name]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("shop", shop);
    setSubmitting(true);
    try {
      await api.post("/jobs/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      event.currentTarget.reset();
    } catch (error: any) {
      const msg = error?.response?.data?.detail || error?.message || "Unable to submit job";
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <ExportPanel
        section={shop}
        defaultName={`${shop}-queue`}
        helper="Download the current queue with positions and notes."
      />
      <div className="card">
        <form onSubmit={submit}>
          <label>
            Part Name
            <input name="part_name" required />
          </label>
          <label>
            Owner / Requester
            <input name="owner_name" key={ownerNameDefault} defaultValue={ownerNameDefault} required />
          </label>
          <label>
            Notes
            <textarea name="notes" placeholder="Material, due date, tolerances" />
          </label>
          <label>
            File (.tap / .step / .stl)
            <input type="file" name="file" required accept=".tap,.step,.stl" />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : `Submit ${shop.toUpperCase()} job`}
          </button>
        </form>
      </div>
      <JobsQueue shop={shop} />
    </section>
  );
}
