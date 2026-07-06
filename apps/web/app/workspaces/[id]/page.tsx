"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ChannelResponse, MessageResponse, PaginatedMessages } from "@relay/contracts";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";

export default function WorkspaceDetailPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const { user, accessToken, ready } = useAuth();
  const router = useRouter();

  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageResponse[]>([]); // display order: oldest -> newest
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.push("/login");
  }, [ready, user, router]);

  const loadChannels = useCallback(async () => {
    if (!accessToken) return;
    const data = await api.get<ChannelResponse[]>(`/workspaces/${workspaceId}/channels`, accessToken);
    setChannels(data);
    setActiveId((current) => current ?? data[0]?.id ?? null);
  }, [accessToken, workspaceId]);

  useEffect(() => {
    if (accessToken) loadChannels().catch((e) => setError(String(e)));
  }, [accessToken, loadChannels]);

  // Load the newest page whenever the active channel changes.
  useEffect(() => {
    if (!accessToken || !activeId) return;
    let cancelled = false;
    (async () => {
      const page = await api.get<PaginatedMessages>(`/channels/${activeId}/messages?limit=30`, accessToken);
      if (cancelled) return;
      setMessages([...page.messages].reverse());
      setNextCursor(page.nextCursor);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [accessToken, activeId]);

  async function loadOlder() {
    if (!accessToken || !activeId || !nextCursor) return;
    const page = await api.get<PaginatedMessages>(
      `/channels/${activeId}/messages?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
      accessToken,
    );
    // Older page is newest-first; reverse and prepend so it sits above current.
    setMessages((prev) => [...[...page.messages].reverse(), ...prev]);
    setNextCursor(page.nextCursor);
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !activeId || !draft.trim()) return;
    setError(null);
    try {
      const msg = await api.post<MessageResponse>(`/channels/${activeId}/messages`, { content: draft }, accessToken);
      setMessages((prev) => [...prev, msg]);
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send");
    }
  }

  async function onCreateChannel(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !newChannel.trim()) return;
    setError(null);
    try {
      const created = await api.post<ChannelResponse>(
        `/workspaces/${workspaceId}/channels`,
        { name: newChannel, type: "PUBLIC" },
        accessToken,
      );
      setNewChannel("");
      await loadChannels();
      setActiveId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create channel");
    }
  }

  if (!ready || !user) return null;

  const activeChannel = channels.find((c) => c.id === activeId) ?? null;

  return (
    <main style={{ display: "flex", height: "100vh", fontSize: 14 }}>
      {/* Channel sidebar */}
      <aside style={{ width: 220, borderRight: "1px solid #ddd", padding: 16, overflowY: "auto" }}>
        <Link href="/workspaces">← Workspaces</Link>
        <h3 style={{ marginBottom: 8 }}>Channels</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {channels.map((c) => (
            <li key={c.id} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setActiveId(c.id)}
                style={{
                  background: c.id === activeId ? "#eef" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 6px",
                }}
              >
                {c.type === "PRIVATE" ? "🔒" : "#"} {c.name}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={onCreateChannel} style={{ marginTop: 12, display: "flex", gap: 4 }}>
          <input
            placeholder="new-channel"
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
            style={{ width: "100%" }}
          />
          <button type="submit">+</button>
        </form>
      </aside>

      {/* Message pane */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ padding: 16, borderBottom: "1px solid #ddd" }}>
          <strong>{activeChannel ? `${activeChannel.type === "PRIVATE" ? "🔒" : "#"} ${activeChannel.name}` : "…"}</strong>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          {nextCursor && (
            <button onClick={() => loadOlder().catch((e) => setError(String(e)))} style={{ alignSelf: "center" }}>
              Load older
            </button>
          )}
          {messages.map((m) => (
            <div key={m.id}>
              <strong>{m.author.displayName}</strong>{" "}
              {m.deletedAt ? (
                <em style={{ color: "#999" }}>message deleted</em>
              ) : (
                <span>
                  {m.content}
                  {m.editedAt && <em style={{ color: "#999" }}> (edited)</em>}
                </span>
              )}
            </div>
          ))}
          {messages.length === 0 && <p style={{ color: "#999" }}>No messages yet.</p>}
        </div>

        {error && <p style={{ color: "crimson", padding: "0 16px" }}>{error}</p>}

        <form onSubmit={onSend} style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #ddd" }}>
          <input
            placeholder={activeChannel ? `Message #${activeChannel.name}` : "Select a channel"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!activeId}
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={!activeId}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
