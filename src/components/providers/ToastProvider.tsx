"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx } from "../ui";

type Tone = "ok" | "error" | "info";
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Turn any thrown value into a sentence for the toast. */
export function errorText(e: unknown): string {
  if (e instanceof Error) {
    if (/permission|insufficient/i.test(e.message)) {
      return "Firebase refused the request. Check that you're signed in with the admin account and the security rules list your email.";
    }
    return e.message;
  }
  return String(e);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "mf-rise pointer-events-auto max-w-md rounded-[var(--radius-control)] px-4 py-2.5 text-sm text-white",
              t.tone === "error" ? "bg-pending" : t.tone === "info" ? "bg-plum" : "bg-settled",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
