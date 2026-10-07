"use client";

import { useParams } from "next/navigation";
import { useStoredFile } from "@/components/useStoredFile";
import { LinkButton, Spinner } from "@/components/ui";

/**
 * Public view of one stored file (a receipt or the DuitNow QR), opened from a
 * WhatsApp message. No sign-in needed: the long random id in the link is the key.
 */
export default function SharedFilePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : null;
  const { file, error, loading } = useStoredFile(id);
  const isPdf = file?.mimeType === "application/pdf";

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-plum px-5 py-3 text-white">
        <p className="text-lg font-semibold tracking-[-0.02em]">MeloFlow</p>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 py-8">
        {loading && <Spinner className="text-ink-soft" />}
        {!loading && (error || !file) && (
          <div className="text-center">
            <h1 className="text-xl font-semibold">This link doesn&rsquo;t work any more</h1>
            <p className="mt-2 text-ink-soft">The file may have been replaced or removed. Ask for a new link.</p>
          </div>
        )}
        {file && (
          <>
            {isPdf ? (
              <iframe title={file.name} src={file.dataUrl} className="h-[80vh] w-full rounded-[var(--radius-panel)] border border-line bg-surface" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.dataUrl} alt={file.name} className="max-h-[80vh] w-auto max-w-full rounded-[var(--radius-panel)] border border-line bg-surface" />
            )}
            <LinkButton href={file.dataUrl} download={file.name} variant="primary">
              Download
            </LinkButton>
          </>
        )}
      </main>
    </div>
  );
}
