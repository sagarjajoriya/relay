"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceResponse } from "@relay/contracts";
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
    if (accessToken) loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/workspaces", { name, slug }, accessToken!);
      setName("");
      setSlug("");
      await loadWorkspaces();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/workspaces/join", { slug: joinSlug }, accessToken!);
      setJoinSlug("");
      await loadWorkspaces();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  if (!ready || !user) return null;

  return (
    <main style={{ maxWidth: 480, margin: "60px auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Workspaces</h1>
        <button onClick={() => logout().then(() => router.push("/login"))}>Log out</button>
      </div>

      <ul>
        {workspaces.map((w) => (
          <li key={w.id}>
            {w.name} <code>#{w.slug}</code> — {w.role}
          </li>
        ))}
        {workspaces.length === 0 && <li>No workspaces yet.</li>}
      </ul>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h2>Create a workspace</h2>
      <form onSubmit={onCreate} style={{ display: "flex", gap: 8 }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        <button type="submit">Create</button>
      </form>

      <h2>Join a workspace</h2>
      <form onSubmit={onJoin} style={{ display: "flex", gap: 8 }}>
        <input placeholder="slug" value={joinSlug} onChange={(e) => setJoinSlug(e.target.value)} required />
        <button type="submit">Join</button>
      </form>
    </main>
  );
}
