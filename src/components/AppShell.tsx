"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "./providers/AuthProvider";
import { DataProvider, useData } from "./providers/DataProvider";
import { Icon } from "./icons";
import { cx, Notice, Spinner } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: "home", mobile: true },
  { href: "/bills/", label: "Bills & money", icon: "bills", mobile: true },
  { href: "/settle/", label: "Settle up", icon: "settle", mobile: true },
  { href: "/personal/", label: "Personal budget", icon: "wallet", mobile: true },
  { href: "/utilities/", label: "Utilities", icon: "bolt", mobile: false },
  { href: "/estimator/", label: "Bill estimator", icon: "calc", mobile: false },
  { href: "/data/", label: "Import & export", icon: "sheet", mobile: false },
  { href: "/settings/", label: "Settings", icon: "gear", mobile: false },
];

function isActive(pathname: string, href: string) {
  const p = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return href === "/" ? p === "/" : p.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const onLogin = pathname.startsWith("/login");
  // Shared receipt / QR links open without signing in.
  const isPublic = pathname.startsWith("/f/");

  useEffect(() => {
    if (!loading && !user && !onLogin && !isPublic && isFirebaseConfigured) router.replace("/login/");
  }, [loading, user, onLogin, isPublic, router]);

  if (!isFirebaseConfigured) return <NotConfigured />;
  if (onLogin || isPublic) return <>{children}</>;
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-soft">
        <Spinner />
      </div>
    );
  }
  return (
    <DataProvider>
      <Frame pathname={pathname}>{children}</Frame>
    </DataProvider>
  );
}

function Frame({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { signOut, user } = useAuth();
  const { ready, error, settings } = useData();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col bg-plum text-white/90 lg:flex">
        <div className="px-6 pt-7 pb-6">
          <p className="text-[1.35rem] font-semibold tracking-[-0.02em] text-white">MeloFlow</p>
          <p className="mt-0.5 text-sm text-white/55">{settings.adminName}&rsquo;s house ledger</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[0.95rem] transition-colors",
                isActive(pathname, item.href) ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
              )}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-4 text-sm">
          <p className="truncate text-white/55">{user?.email}</p>
          <button onClick={() => signOut()} className="mt-1 inline-flex items-center gap-2 text-white/80 hover:text-white">
            <Icon name="logout" className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-plum px-4 py-3 text-white lg:hidden">
        <p className="text-lg font-semibold tracking-[-0.02em]">MeloFlow</p>
        <p className="text-sm text-white/60">{settings.adminName}&rsquo;s house</p>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
        {error && (
          <div className="mb-4">
            <Notice tone="error">
              Couldn&rsquo;t load your data: {error}. Check that the Firestore rules list this account&rsquo;s email (see README).
            </Notice>
          </div>
        )}
        {ready ? children : <div className="flex justify-center py-24 text-ink-soft"><Spinner /></div>}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
        {NAV.filter((n) => n.mobile).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={cx("flex flex-col items-center gap-0.5 py-2 text-[0.7rem]", isActive(pathname, item.href) ? "text-violet" : "text-ink-soft")}
          >
            <Icon name={item.icon} />
            {item.label.split(" ")[0]}
          </Link>
        ))}
        <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[0.7rem] text-ink-soft" aria-expanded={moreOpen}>
          <Icon name="more" />
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-plum/40 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="mf-rise w-full rounded-t-[var(--radius-panel)] bg-surface p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !n.mobile).map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-3 hover:bg-paper">
                <Icon name={item.icon} /> {item.label}
              </Link>
            ))}
            <button onClick={() => signOut()} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-3 text-left text-pending hover:bg-paper">
              <Icon name="logout" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl px-6 py-20">
      <h1 className="text-2xl font-semibold">Connect MeloFlow to Firebase</h1>
      <p className="mt-3 text-ink-soft">
        The app can&rsquo;t find its Firebase settings. Copy <code>.env.example</code> to <code>.env.local</code>, paste in the web app config
        from Firebase console → Project settings → Your apps, then restart <code>npm run dev</code>. On Vercel, add the same values under Project →
        Settings → Environment Variables and redeploy.
      </p>
    </div>
  );
}
