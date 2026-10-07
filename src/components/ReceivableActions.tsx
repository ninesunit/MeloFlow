"use client";

import { useState } from "react";
import { carryForwardReceivable, recordReceivablePayment, settleReceivable } from "@/lib/db";
import { buildBillNotice } from "@/lib/shared/message";
import { formatRM, round2 } from "@/lib/shared/money";
import { outstanding } from "@/lib/shared/split";
import type { Receivable, Transaction } from "@/lib/shared/types";
import { Icon } from "./icons";
import { useData } from "./providers/DataProvider";
import { errorText, useToast } from "./providers/ToastProvider";
import { Button, Dialog, Field, Input, Notice } from "./ui";
import { WhatsAppDialog } from "./WhatsAppDialog";

/** Settle / part-pay / carry-forward / WhatsApp buttons for one housemate's share of a bill. */
export function ReceivableActions({ receivable, transaction, compact }: { receivable: Receivable; transaction: Transaction; compact?: boolean }) {
  const { settings } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const due = outstanding(receivable);
  const open = receivable.status !== "Settled";

  async function run(key: string, fn: () => Promise<void>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const draft = buildBillNotice({ settings, debtorName: receivable.debtorName, transaction, receivable });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open && (
        <>
          <Button size="sm" variant="primary" busy={busy === "settle"} onClick={() => run("settle", () => settleReceivable(receivable.id), `${receivable.debtorName} marked as paid`)}>
            Paid in full
          </Button>
          <Button size="sm" onClick={() => setPayOpen(true)}>
            Part payment
          </Button>
          {receivable.amountPaid > 0 && !compact && (
            <Button
              size="sm"
              variant="ghost"
              busy={busy === "carry"}
              onClick={() => {
                if (confirm(`Close this bill and add the unpaid ${formatRM(due)} to ${receivable.debtorName}'s next bill?`)) {
                  run("carry", () => carryForwardReceivable(receivable.id), `${formatRM(due)} moved to ${receivable.debtorName}'s next bill`);
                }
              }}
            >
              Carry rest to next bill
            </Button>
          )}
        </>
      )}
      {open && (
        <Button size="sm" variant="ghost" onClick={() => setWaOpen(true)} aria-label={`WhatsApp ${receivable.debtorName}`}>
          <Icon name="chat" className="h-4 w-4" /> {compact ? "" : "WhatsApp"}
        </Button>
      )}
      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} receivable={receivable} />
      <WhatsAppDialog open={waOpen} onClose={() => setWaOpen(false)} debtorName={receivable.debtorName} draft={draft} />
    </div>
  );
}

function PaymentDialog({ open, onClose, receivable }: { open: boolean; onClose: () => void; receivable: Receivable }) {
  const toast = useToast();
  const due = outstanding(receivable);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);

  async function save() {
    if (!(n > 0)) {
      setError("Enter how much was paid.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordReceivablePayment(receivable.id, round2(n), note.trim() || undefined);
      toast(`Recorded ${formatRM(n)} from ${receivable.debtorName}`);
      setAmount("");
      setNote("");
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Payment from ${receivable.debtorName}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ink-soft">
          Still owed on this bill: <span className="num font-semibold text-ink">{formatRM(due)}</span>
        </p>
        <Field label="Amount received (RM)">
          {(id) => <Input id={id} type="number" inputMode="decimal" step="0.01" min="0" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Note (optional)">{(id) => <Input id={id} placeholder="e.g. DuitNow 7 Oct" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {n > due + 0.004 && (
          <Notice tone="info">
            That&rsquo;s {formatRM(round2(n - due))} more than owed. The extra is kept as credit and taken off {receivable.debtorName}&rsquo;s next bill.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
