import type { ReactNode } from "react";
import { Zap } from "lucide-react";

export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-surface to-emerald-50 p-4">
      <div className="card w-full max-w-md p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">
            <Zap size={22} strokeWidth={2.5} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Relay</h1>
          <p className="text-sm text-ink-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
