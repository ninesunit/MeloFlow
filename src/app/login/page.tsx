"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, Field, Input, Notice } from "@/components/ui";

function friendly(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password don't match the admin account.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes, or reset the password in the Firebase console.";
    case "auth/network-request-failed":
      return "No connection to Firebase. Check your internet and try again.";
    default:
      return "Sign-in failed. Check the email and password.";
  }
}

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(friendly((err as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-plum p-12 text-white lg:flex">
        <p className="text-2xl font-semibold tracking-[-0.02em]">MeloFlow</p>
        <div className="max-w-sm">
          <p className="text-[2.4rem] leading-[1.1] font-semibold tracking-[-0.02em]">Every bill split, every ringgit accounted for.</p>
          <p className="mt-4 text-white/65">Rent, TNB, Air Selangor and Wi-Fi for the house — plus your own budget, kept separate.</p>
        </div>
        <p className="text-sm text-white/40">Single-user ledger</p>
      </div>
      <div className="flex items-center justify-center px-6 py-16">
        <form onSubmit={submit} className="w-full max-w-sm">
          <p className="mb-8 text-2xl font-semibold tracking-[-0.02em] lg:hidden">MeloFlow</p>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 mb-6 text-ink-soft">Use the administrator account created in Firebase.</p>
          <div className="flex flex-col gap-4">
            <Field label="Email">
              {(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Password">
              {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="primary" busy={busy} className="mt-2">
              Sign in
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
