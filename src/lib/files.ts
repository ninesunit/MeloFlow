"use client";

/**
 * File storage without Cloud Storage (which needs the Blaze plan).
 *
 * Images are shrunk in the browser and saved as base64 in the Firestore
 * `files` collection, one document per file (Firestore's limit is 1 MiB per
 * document). Each file gets a long random id; the security rules let anyone
 * fetch a file by its exact id but never list them, so a link like
 * https://your-app/f/<id>/ works like a private share link for housemates.
 */
import { deleteDoc, doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Transaction, UserSettings } from "./shared/types";

export const FILES = "files";
/** Largest file kept in Firestore (before base64), leaving room under the 1 MiB document limit. */
export const MAX_STORED_BYTES = 600 * 1024;
/** Largest file sent to the AI route (Vercel caps request bodies at ~4.5 MB). */
export const MAX_AI_BYTES = 4 * 1024 * 1024;

export interface StoredFile {
  id: string;
  mimeType: string;
  name: string;
  size: number;
  dataUrl: string;
}

/** 24 random bytes, URL-safe — unguessable, so the id itself is the access key. */
export function newFileId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This browser can't open that image. Try a JPG or PNG (iPhone: set Camera → Formats → Most Compatible)."));
    };
    img.src = url;
  });
}

function toJpeg(img: HTMLImageElement, maxDim: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't compress the image."))), "image/jpeg", quality));
}

/** Shrink an image to a JPEG no larger than `maxBytes`, lowering quality then size. */
export async function compressImage(file: Blob, opts: { maxDim: number; maxBytes: number }): Promise<Blob> {
  const img = await loadImage(file);
  let dim = opts.maxDim;
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const q of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await toJpeg(img, dim, q);
      if (blob.size <= opts.maxBytes) return blob;
    }
    dim = Math.round(dim * 0.8);
  }
  throw new Error("Couldn't make the image small enough. Try a smaller photo.");
}

export interface PreparedUpload {
  /** Version sent to the AI for reading (higher resolution). */
  forAi: Blob | null;
  /** Version kept in Firestore, or null when it's too big to keep. */
  forStorage: Blob | null;
  name: string;
}

/** Make the AI copy and the stored copy of a bill or receipt. */
export async function prepareBillFile(file: File): Promise<PreparedUpload> {
  const name = file.name || "bill";
  if (file.type === "application/pdf") {
    return {
      forAi: file.size <= MAX_AI_BYTES ? file : null,
      forStorage: file.size <= MAX_STORED_BYTES ? file : null,
      name,
    };
  }
  if (!file.type.startsWith("image/")) throw new Error("Upload a photo (JPG, PNG, WEBP) or a PDF.");
  const forAi = await compressImage(file, { maxDim: 2200, maxBytes: 3.5 * 1024 * 1024 });
  const forStorage = await compressImage(file, { maxDim: 1500, maxBytes: MAX_STORED_BYTES });
  return { forAi, forStorage, name: name.replace(/\.\w+$/, "") + ".jpg" };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsDataURL(blob);
  });
}

/** Save a (small) file to Firestore and return its id. */
export async function saveFile(blob: Blob, name: string, kind: "receipt" | "payment"): Promise<string> {
  if (blob.size > MAX_STORED_BYTES) throw new Error("That file is too large to keep (limit 600 KB).");
  const id = newFileId();
  await setDoc(doc(firestore(), FILES, id), {
    kind,
    name: name.slice(-100),
    mimeType: blob.type || "application/octet-stream",
    size: blob.size,
    data: await blobToBase64(blob),
    createdAt: Timestamp.now(),
  });
  return id;
}

export async function deleteStoredFile(id: string | null | undefined): Promise<void> {
  if (!id) return;
  try {
    await deleteDoc(doc(firestore(), FILES, id));
  } catch {
    // Already gone — nothing to do.
  }
}

/** Load a file by id. Works signed out too (that's how housemates open receipt links). */
export async function loadFile(id: string): Promise<StoredFile | null> {
  const snap = await getDoc(doc(firestore(), FILES, id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { id, mimeType: d.mimeType, name: d.name, size: d.size, dataUrl: `data:${d.mimeType};base64,${d.data}` };
}

/** Shareable link to a stored file, on whatever address the app is running at. */
export function fileLink(id: string | null | undefined): string | null {
  if (!id || typeof window === "undefined") return null;
  return `${window.location.origin}/f/${id}/`;
}

/** Receipt and DuitNow QR links for WhatsApp messages. */
export function noticeLinks(settings: Pick<UserSettings, "duitNowQrFileId">, t?: Pick<Transaction, "receiptFileId"> | null) {
  return { receiptUrl: fileLink(t?.receiptFileId), qrUrl: fileLink(settings.duitNowQrFileId) };
}
