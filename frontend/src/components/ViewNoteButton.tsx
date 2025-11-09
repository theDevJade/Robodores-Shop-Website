import { useState } from "react";
import { InfoDialog } from "./InfoDialog";

type Props = {
  title: string;
  content: string | null | undefined;
};

export function ViewNoteButton({ title, content }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="view-note-btn" onClick={() => setOpen(true)}>
        View Notes
      </button>
      <InfoDialog open={open} title={title} content={content ?? ""} onClose={() => setOpen(false)} />
    </>
  );
}
