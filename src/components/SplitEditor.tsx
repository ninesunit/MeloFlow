"use client";

import { formatRM, round2 } from "@/lib/shared/money";
import { PERCENT_TOLERANCE, type PlannedReceivable } from "@/lib/shared/split";
import { evenPercents, percentTotal, type SplitDraft } from "@/lib/shared/split-defaults";
import { Button, Checkbox, cx, Input, Segmented } from "./ui";

/**
 * Who shares a bill and how: tick people in or out, then split equally, by
 * percentage, or with fixed ringgit amounts (the admin pays the rest).
 * Used by the entry form and by the default splits in Settings.
 */
export function SplitEditor({
  draft,
  onChange,
  people,
  adminName,
  shares,
  plans,
}: {
  draft: SplitDraft;
  onChange: (d: SplitDraft) => void;
  people: string[];
  adminName: string;
  /** Calculated amounts for the current bill, when there is one. */
  shares?: Record<string, number> | null;
  plans?: PlannedReceivable[];
}) {
  const set = (patch: Partial<SplitDraft>) => onChange({ ...draft, ...patch });
  const total = percentTotal(draft);
  const balanced = Math.abs(total - 100) <= PERCENT_TOLERANCE;

  function toggle(p: string, on: boolean) {
    const participants = people.filter((x) => (x === p ? on : draft.participants.includes(x)));
    // Keep percentages adding up when someone joins or leaves an even split.
    const wasEven = JSON.stringify(pick(draft.ratios, draft.participants)) === JSON.stringify(evenPercents(draft.participants));
    set({ participants, ...(wasEven ? { ratios: { ...draft.ratios, ...evenPercents(participants) } } : {}) });
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Split method"
        value={draft.mode}
        options={[
          { value: "equal", label: "Equally" },
          { value: "ratio", label: "By %" },
          { value: "fixed", label: "Fixed RM" },
        ]}
        onChange={(mode) => set({ mode })}
      />
      <div className="flex flex-col divide-y divide-line">
        {people.map((p) => {
          const included = draft.participants.includes(p);
          const plan = plans?.find((x) => x.debtorName === p);
          const share = shares?.[p];
          return (
            <div key={p} className={cx("flex flex-wrap items-center gap-3 py-2.5", !included && "text-ink-faint")}>
              <div className="w-32">
                <Checkbox label={<span className="font-medium">{p}</span>} checked={included} onChange={(v) => toggle(p, v)} />
              </div>
              {!included && <span className="text-sm">Doesn&rsquo;t pay</span>}
              {included && draft.mode === "ratio" && (
                <div className="flex w-28 items-center gap-1">
                  <Input
                    aria-label={`${p} percentage`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="100"
                    value={draft.ratios[p] ?? ""}
                    onChange={(e) => set({ ratios: { ...draft.ratios, [p]: e.target.value } })}
                  />
                  <span className="text-ink-soft">%</span>
                </div>
              )}
              {included && draft.mode === "fixed" && p !== adminName && (
                <div className="flex w-36 items-center gap-1">
                  <span className="text-ink-soft">RM</span>
                  <Input
                    aria-label={`${p} fixed amount`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={draft.fixed[p] ?? ""}
                    onChange={(e) => set({ fixed: { ...draft.fixed, [p]: e.target.value } })}
                  />
                </div>
              )}
              {included && draft.mode === "fixed" && p === adminName && <span className="text-sm text-ink-soft">pays the rest</span>}
              <div className="ml-auto text-right">
                {included && share !== undefined && <p className="num font-medium text-ink">{formatRM(share)}</p>}
                {plan && Math.abs(plan.carryIn) >= 0.005 && (
                  <p className="num text-xs text-ink-soft">
                    {plan.carryIn > 0 ? `+${formatRM(plan.carryIn)} carried over` : `${formatRM(plan.carryIn)} credit used`} → owes {formatRM(plan.amountOwed)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {draft.mode === "ratio" && draft.participants.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className={cx("num", balanced ? "text-ink-soft" : "font-medium text-pending")}>
            Total {round2(total)}%
            {balanced ? (Math.abs(total - 100) >= 0.005 ? " — balanced to exactly 100%" : "") : ` — needs to be 100% (${round2(100 - total) > 0 ? "+" : ""}${round2(100 - total)}%)`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => set({ ratios: { ...draft.ratios, ...evenPercents(draft.participants) } })}>
            Make even
          </Button>
        </div>
      )}
    </div>
  );
}

function pick(obj: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
