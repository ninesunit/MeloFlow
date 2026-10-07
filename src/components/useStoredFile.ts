"use client";

import { useEffect, useState } from "react";
import { loadFile, type StoredFile } from "@/lib/files";

/** Load a file saved in the Firestore `files` collection. */
export function useStoredFile(id: string | null | undefined) {
  const [state, setState] = useState<{ id: string | null; file: StoredFile | null; error: string | null }>({ id: null, file: null, error: null });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadFile(id)
      .then((file) => !cancelled && setState({ id, file, error: file ? null : "This file no longer exists." }))
      .catch(() => !cancelled && setState({ id, file: null, error: "This file couldn't be loaded." }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = id && state.id === id ? state : { file: null, error: null };
  return { file: current.file, error: current.error, loading: Boolean(id) && state.id !== id };
}
