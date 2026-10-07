"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { formatRM } from "@/lib/shared/money";
import type { PaymentStatus } from "@/lib/shared/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------- Buttons ----------

type Variant = "primary" | "secondary" | "ghost" | "danger" | "whatsapp";

const variants: Record<Variant, string> = {
  primary: "bg-violet text-white hover:bg-plum-2 disabled:bg-ink-faint",
  secondary: "bg-surface text-ink border border-line hover:bg-paper disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-paper hover:text-ink",
  danger: "bg-surface text-pending border border-line hover:bg-pending-soft",
  whatsapp: "bg-[#1f8f4e] text-white hover:bg-[#177a41]",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-sm" : "px-4 py-2 text-[0.95rem]",
        variants[variant],
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = "secondary",
  className,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return (
    <a
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2 text-[0.95rem] font-medium transition-colors",
        variants[variant],
        className,
      )}
    >
      {children}
    </a>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

// ---------- Form controls ----------

const controlClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[0.95rem] text-ink placeholder:text-ink-faint focus:border-violet focus:outline-none disabled:bg-paper";

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-ink-faint">{hint}</p>}
      {error && <p className="text-xs text-pending">{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(controlClass, props.type === "number" && "num", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(controlClass, "pr-8", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(controlClass, props.className)} />;
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[0.95rem]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-violet)]"
      />
      {label}
    </label>
  );
}

/** Segmented control for a small set of options. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius-control)] border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Display ----------

export function Panel({ title, action, children, className, padded = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-[var(--radius-panel)] border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-[1.02rem] font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 max-w-[62ch] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const statusStyle: Record<PaymentStatus, string> = {
  Pending: "bg-pending-soft text-pending",
  Partial: "bg-partial-soft text-[#8a5e00]",
  Settled: "bg-settled-soft text-settled",
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", statusStyle[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status}
    </span>
  );
}

export function Money({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  const text = signed && value > 0 ? `+${formatRM(value)}` : formatRM(value);
  return <span className={cx("num", className)}>{text}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--radius-panel)] border border-dashed border-line bg-surface/60 px-5 py-8">
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-[60ch] text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const styles = {
    info: "border-violet/30 bg-violet-soft text-ink",
    warn: "border-partial/40 bg-partial-soft text-ink",
    error: "border-pending/40 bg-pending-soft text-ink",
    ok: "border-settled/40 bg-settled-soft text-ink",
  }[tone];
  return <div className={cx("rounded-[var(--radius-control)] border px-4 py-3 text-sm", styles)}>{children}</div>;
}

// ---------- Dialog ----------

const dialogStack: string[] = [];

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const token = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogStack.push(token);
    // Escape closes only the topmost dialog when dialogs are stacked.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogStack[dialogStack.length - 1] === token) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = dialogStack.lastIndexOf(token);
      if (i >= 0) dialogStack.splice(i, 1);
      if (dialogStack.length === 0) document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, token]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-plum/40 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "mf-rise flex max-h-[92vh] w-full flex-col rounded-t-[var(--radius-panel)] bg-surface outline-none sm:rounded-[var(--radius-panel)]",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-ink-soft hover:bg-paper" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

/** Simple horizontal progress bar for budgets. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  const color = over ? "bg-pending" : pct > 80 ? "bg-partial" : "bg-settled";
  return (
    <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-2 w-full overflow-hidden rounded-full bg-paper">
      <div className={cx("h-full rounded-full", color)} style={{ width: `${over ? 100 : pct}%` }} />
    </div>
  );
}
