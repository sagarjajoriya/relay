"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, CirclePlus, LogOut, UserPlus, Zap } from "lucide-react";
import type { WorkspaceResponse } from "@relay/contracts";
import { Avatar } from "@/components/avatar";
import { RoleBadge } from "@/components/role-badge";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";

export default function WorkspacesPage() {
  const { user, accessToken, ready, logout } = useAuth();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [joinSlug, setJoinSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.push("/login");
  }, [ready, user, router]);

  async function loadWorkspaces() {
    if (!accessToken) return;
    const data = await api.get<WorkspaceResponse[]>("/workspaces", accessToken);
    setWorkspaces(data);
  }

  useEffect(() => {
    if (accessToken) loadWorkspaces().catch(() => setError("Could not load workspaces"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<WorkspaceResponse>("/workspaces", { name, slug }, accessToken!);
      setName("");
      setSlug("");
      router.push(`/workspaces/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const joined = await api.post<WorkspaceResponse>("/workspaces/join", { slug: joinSlug }, accessToken!);
      setJoinSlug("");
      router.push(`/workspaces/${joined.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  if (!ready || !user) return null;

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line bg-card px-6 py-3">
        <span className="flex items-center gap-2 font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <Zap size={16} strokeWidth={2.5} />
          </span>
          Relay
        </span>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="font-semibold">{user.displayName}</div>
            <div className="text-xs text-ink-muted">{user.email}</div>
          </div>
          <Avatar name={user.displayName} />
          <button
            className="btn-ghost flex items-center gap-1.5 text-danger hover:text-danger"
            onClick={() => logout().then(() => router.push("/login"))}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 p-8 md:grid-cols-[1fr_360px]">
        <section>
          <h1 className="text-xl font-bold">Welcome back, {user.displayName.split(" ")[0]}.</h1>
          <p className="mt-1 text-sm text-ink-muted">Choose a workspace to continue.</p>

          <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-widest text-ink-muted">
            Your workspaces
          </h2>
          <ul className="flex flex-col gap-3">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workspaces/${w.id}`}
                  className="card group flex items-center gap-4 border-l-4 border-l-transparent p-4 transition-colors hover:border-l-primary hover:bg-primary-tint/40"
                >
                  <Avatar name={w.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{w.name}</span>
                      <RoleBadge role={w.role} />
                    </div>
                    <div className="font-mono text-xs text-ink-muted">{w.slug}</div>
                  </div>
                  <ChevronRight size={18} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
            {workspaces.length === 0 && (
              <li className="card p-6 text-center text-sm text-ink-muted">
                No workspaces yet — create one, or join with a slug.
              </li>
            )}
          </ul>
          {error && <p className="field-error mt-4">{error}</p>}
        </section>

        <aside className="flex flex-col gap-6">
          <form onSubmit={onCreate} className="card flex flex-col gap-3 p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <CirclePlus size={17} className="text-primary" /> Create workspace
            </h3>
            <div>
              <label className="field-label">Workspace name</label>
              <input className="input-field" placeholder="e.g. Acme Corp" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="field-label">Workspace slug</label>
              <input
                className="input-field font-mono"
                placeholder="acme-corp"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9-]+"
                title="lowercase letters, numbers and hyphens"
                required
              />
            </div>
            <button type="submit" className="btn-primary">
              Create workspace
            </button>
          </form>

          <form onSubmit={onJoin} className="card flex flex-col gap-3 p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <UserPlus size={17} className="text-primary" /> Join workspace
            </h3>
            <div>
              <label className="field-label">Workspace slug</label>
              <div className="flex gap-2">
                <input
                  className="input-field font-mono"
                  placeholder="existing-slug"
                  value={joinSlug}
                  onChange={(e) => setJoinSlug(e.target.value)}
                  required
                />
                <button type="submit" className="btn-secondary shrink-0">
                  Join
                </button>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </main>
  );
}
