"use client";

import { useState } from "react";
import { ai } from "@/lib/ai";
import { normalisePhone, whatsappLink } from "@/lib/shared/message";
import { Icon } from "./icons";
import { useData } from "./providers/DataProvider";
import { errorText, useToast } from "./providers/ToastProvider";
import { Button, Dialog, Field, Input, LinkButton, Notice, Segmented, Textarea } from "./ui";

type Tone = "friendly" | "formal" | "short";
type Lang = "English" | "Malay" | "Mixed";

/** Preview, optionally polish with Gemini, then open WhatsApp with the message filled in. */
export function WhatsAppDialog({ open, onClose, debtorName, draft }: { open: boolean; onClose: () => void; debtorName: string; draft: string }) {
  if (!open) return null;
  return <Inner onClose={onClose} debtorName={debtorName} draft={draft} />;
}

function Inner({ onClose, debtorName, draft }: { onClose: () => void; debtorName: string; draft: string }) {
  const { settings } = useData();
  const toast = useToast();
  const saved = settings.housemates.find((h) => h.name === debtorName)?.phone ?? "";
  const [phone, setPhone] = useState(saved);
  const [text, setText] = useState(draft);
  const [tone, setTone] = useState<Tone>("friendly");
  const [lang, setLang] = useState<Lang>("English");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function polish() {
    setBusy(true);
    setError(null);
    try {
      const res = await ai.composeMessage({ draft, tone, language: lang });
      setText(res.message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Message copied");
    } catch {
      toast("Couldn't copy — select the text and copy it manually.", "error");
    }
  }

  const number = normalisePhone(phone);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Message ${debtorName}`}
      footer={
        <>
          <Button onClick={copy}>Copy text</Button>
          <LinkButton variant="whatsapp" href={whatsappLink(phone, text)} target="_blank" rel="noreferrer" onClick={() => setTimeout(onClose, 300)}>
            <Icon name="chat" className="h-4 w-4" /> Open in WhatsApp
          </LinkButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="WhatsApp number" hint={saved ? "Saved in Settings." : "Add numbers in Settings so they're filled in next time. Leave blank to pick the chat in WhatsApp."}>
          {(id) => <Input id={id} inputMode="tel" placeholder="012-345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        {phone && number.length < 10 && <Notice tone="warn">That number looks too short. Use the full mobile number, e.g. 012-345 6789.</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Tone>
            label="Tone"
            value={tone}
            onChange={setTone}
            options={[
              { value: "friendly", label: "Friendly" },
              { value: "formal", label: "Formal" },
              { value: "short", label: "Short" },
            ]}
          />
          <Segmented<Lang>
            label="Language"
            value={lang}
            onChange={setLang}
            options={[
              { value: "English", label: "English" },
              { value: "Malay", label: "BM" },
              { value: "Mixed", label: "Rojak" },
            ]}
          />
          <Button onClick={polish} busy={busy}>
            <Icon name="sparkle" className="h-4 w-4" /> Rewrite with AI
          </Button>
          {text !== draft && (
            <Button variant="ghost" size="sm" onClick={() => setText(draft)}>
              Use original
            </Button>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Textarea aria-label="Message" rows={14} value={text} onChange={(e) => setText(e.target.value)} className="text-sm leading-relaxed" />
        <p className="text-xs text-ink-faint">The AI rewrite keeps every amount, date and link from the original. Check it before sending.</p>
      </div>
    </Dialog>
  );
}
