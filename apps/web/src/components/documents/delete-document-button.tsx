"use client";

import { useTransition } from "react";
import { deleteDocumentAction } from "./actions";

export function DeleteDocumentButton({ documentId, filename }: { documentId: string; filename: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="text-xs text-destructive underline"
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete ${filename}? The file is removed permanently; the audit log keeps a record.`)) {
          start(() => deleteDocumentAction(documentId));
        }
      }}
    >
      Delete
    </button>
  );
}
