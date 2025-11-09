import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  title?: string;
  content: string;
  onClose: () => void;
};

export function InfoDialog({ open, title = "Details", content, onClose }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fullscreen-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fullscreen-note">
        <div className="fullscreen-note__header">
          <h2>{title}</h2>
          <button type="button" className="refresh-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="fullscreen-note__body">
          {content.trim() ? content : "No additional notes provided."}
        </div>
      </div>
    </div>,
    document.body,
  );
}
