"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  WS_EVENTS,
  type ChannelResponse,
  type MessageResponse,
  type PaginatedMessages,
  type PresenceEvent,
  type PresenceUser,
  type SearchResponse,
  type TypingEvent,
} from "@relay/contracts";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { createSocket, type RelaySocket } from "@/lib/socket";

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
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({}); // userId -> displayName
  const [onlineUsers, setOnlineUsers] = useState<Record<string, string>>({}); // userId -> displayName
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [pendingUploads, setPendingUploads] = useState<{ id: string; fileName: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const socketRef = useRef<RelaySocket | null>(null);
  // Handlers below are registered once per socket; this ref lets them see the
  // current channel so a broadcast racing a channel switch can't leak into the
  // wrong message list.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  useEffect(() => {
    if (ready && !user) router.push("/login");
  }, [ready, user, router]);

  // One socket per page lifetime; message handlers are registered once and
  // filter by the active channel via state updates keyed on channelId.
  useEffect(() => {
    if (!accessToken) return;
    const socket = createSocket(accessToken);
    socketRef.current = socket;

    const upsert = (incoming: MessageResponse) => {
      if (incoming.channelId !== activeIdRef.current) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === incoming.id);
        if (idx === -1) return [...prev, incoming];
        const next = [...prev];
        next[idx] = incoming;
        return next;
      });
      // Any message activity clears that author's typing indicator.
      setTypingUsers((prev) => {
        if (!(incoming.author.id in prev)) return prev;
        const { [incoming.author.id]: _, ...rest } = prev;
        return rest;
      });
    };

    socket.on(WS_EVENTS.messageCreated, upsert);
    socket.on(WS_EVENTS.messageUpdated, upsert);
    socket.on(WS_EVENTS.messageDeleted, upsert);
    socket.on(WS_EVENTS.typing, (e: TypingEvent) =>
      setTypingUsers((prev) => ({ ...prev, [e.user.id]: e.user.displayName })),
    );
    socket.on(WS_EVENTS.typingStopped, (e: TypingEvent) =>
      setTypingUsers((prev) => {
        const { [e.user.id]: _, ...rest } = prev;
        return rest;
      }),
    );
    socket.on(WS_EVENTS.presenceOnline, (e: PresenceEvent) => {
      if (e.workspaceId !== workspaceId) return;
      setOnlineUsers((prev) => ({ ...prev, [e.user.id]: e.user.displayName }));
    });
    socket.on(WS_EVENTS.presenceOffline, (e: PresenceEvent) => {
      if (e.workspaceId !== workspaceId) return;
      setOnlineUsers((prev) => {
        const { [e.user.id]: _, ...rest } = prev;
        return rest;
      });
    });
    socket.on("connect_error", (err) => setError(`Realtime connection failed: ${err.message}`));

    // Seed the online list after the socket is up (so we don't miss the gap
    // between fetch and subscribe).
    socket.on("connect", () => {
      api
        .get<PresenceUser[]>(`/workspaces/${workspaceId}/presence`, accessToken)
        .then((users) => setOnlineUsers(Object.fromEntries(users.map((u) => [u.id, u.displayName]))))
        .catch(() => undefined);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken]);

  // Join the active channel's room (server re-checks access) and reset typing
  // state on every switch.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeId) return;
    setTypingUsers({});
    socket.emit(WS_EVENTS.channelJoin, { channelId: activeId }, (res) => {
      if (!res.ok) setError(`Could not join channel: ${res.error}`);
    });
    return () => {
      socket.emit(WS_EVENTS.channelLeave, { channelId: activeId });
    };
  }, [activeId]);

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
    if (!accessToken || !activeId) return;
    if (!draft.trim() && pendingUploads.length === 0) return;
    setError(null);
    stopTyping();
    try {
      const msg = await api.post<MessageResponse>(
        `/channels/${activeId}/messages`,
        { content: draft, attachmentIds: pendingUploads.map((u) => u.id) },
        accessToken,
      );
      // The room broadcast will usually beat this response; the id-deduping
      // append keeps the message from showing twice either way.
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setDraft("");
      setPendingUploads([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send");
    }
  }

  // Pre-signed upload: ask the API for a PUT URL, then send the bytes straight
  // to object storage — they never pass through our API.
  async function onPickFile(file: File) {
    if (!accessToken || !activeId) return;
    setError(null);
    setUploading(true);
    try {
      const { attachmentId, uploadUrl } = await api.post<{ attachmentId: string; uploadUrl: string }>(
        `/channels/${activeId}/attachments`,
        { fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size },
        accessToken,
      );
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!put.ok) throw new ApiError(put.status, "Upload to storage failed");
      setPendingUploads((prev) => [...prev, { id: attachmentId, fileName: file.name }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Debounced typing signal: emit start on first keystroke, stop after 2s idle.
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopTyping() {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (activeId) socketRef.current?.emit(WS_EVENTS.typingStop, { channelId: activeId });
  }

  function onDraftChange(value: string) {
    setDraft(value);
    if (!activeId || !socketRef.current) return;
    if (!typingTimeoutRef.current) {
      socketRef.current.emit(WS_EVENTS.typingStart, { channelId: activeId });
    } else {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(stopTyping, 2000);
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !searchQ.trim()) return;
    setError(null);
    try {
      const res = await api.get<SearchResponse>(
        `/workspaces/${workspaceId}/search?q=${encodeURIComponent(searchQ)}`,
        accessToken,
      );
      setSearchResults(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed");
    }
  }

  // Snippets arrive with control-char delimiters around matches; splitting and
  // rendering as text nodes keeps untrusted message content out of any HTML
  // path entirely.
  function renderSnippet(snippet: string) {
    return snippet.split(SEARCH_MARK_START).flatMap((part, i) => {
      if (i === 0) return [<span key={i}>{part}</span>];
      const [hit, rest] = part.split(SEARCH_MARK_END);
      return [<mark key={i}>{hit}</mark>, <span key={`${i}r`}>{rest}</span>];
    });
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

        <h3 style={{ marginTop: 20, marginBottom: 8 }}>Online</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {Object.entries(onlineUsers).map(([id, name]) => (
            <li key={id} style={{ padding: "2px 6px" }}>
              <span style={{ color: "#2da44e" }}>●</span> {name}
              {id === user.id && <span style={{ color: "#999" }}> (you)</span>}
            </li>
          ))}
          {Object.keys(onlineUsers).length === 0 && <li style={{ color: "#999", padding: "2px 6px" }}>Nobody online</li>}
        </ul>
      </aside>

      {/* Message pane */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{ padding: 16, borderBottom: "1px solid #ddd", display: "flex", gap: 16, alignItems: "center" }}
        >
          <strong style={{ flexShrink: 0 }}>
            {activeChannel ? `${activeChannel.type === "PRIVATE" ? "🔒" : "#"} ${activeChannel.name}` : "…"}
          </strong>
          <form onSubmit={onSearch} style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <input placeholder="Search workspace" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
            <button type="submit">Search</button>
            {searchResults && (
              <button type="button" onClick={() => { setSearchResults(null); setSearchQ(""); }}>
                ✕
              </button>
            )}
          </form>
        </header>

        {searchResults && (
          <div style={{ borderBottom: "1px solid #ddd", maxHeight: "40%", overflowY: "auto", padding: 16 }}>
            <p style={{ margin: "0 0 8px", color: "#999" }}>
              {searchResults.results.length === 0
                ? "No results."
                : `${searchResults.results.length}${searchResults.hasMore ? "+" : ""} result(s)`}
            </p>
            {searchResults.results.map((r) => (
              <div
                key={r.messageId}
                onClick={() => { setActiveId(r.channelId); setSearchResults(null); setSearchQ(""); }}
                style={{ cursor: "pointer", padding: "6px 0", borderTop: "1px solid #eee" }}
              >
                <div style={{ fontSize: 12, color: "#666" }}>
                  #{r.channelName} · {r.author.displayName} · {new Date(r.createdAt).toLocaleString()}
                </div>
                <div>{renderSnippet(r.snippet)}</div>
              </div>
            ))}
          </div>
        )}

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
              {!m.deletedAt &&
                m.attachments.map((a) =>
                  a.contentType.startsWith("image/") ? (
                    <div key={a.id} style={{ marginTop: 4 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.downloadUrl} alt={a.fileName} style={{ maxWidth: 320, maxHeight: 240, borderRadius: 4 }} />
                    </div>
                  ) : (
                    <div key={a.id} style={{ marginTop: 4 }}>
                      <a href={a.downloadUrl} target="_blank" rel="noreferrer">
                        📎 {a.fileName}
                      </a>{" "}
                      <span style={{ color: "#999", fontSize: 12 }}>({Math.ceil(a.sizeBytes / 1024)} KB)</span>
                    </div>
                  ),
                )}
            </div>
          ))}
          {messages.length === 0 && <p style={{ color: "#999" }}>No messages yet.</p>}
        </div>

        <p style={{ minHeight: 18, margin: 0, padding: "0 16px", color: "#999", fontSize: 12 }}>
          {Object.values(typingUsers).length > 0 &&
            `${Object.values(typingUsers).join(", ")} ${Object.values(typingUsers).length === 1 ? "is" : "are"} typing…`}
        </p>

        {error && <p style={{ color: "crimson", padding: "0 16px" }}>{error}</p>}

        {pendingUploads.length > 0 && (
          <p style={{ margin: 0, padding: "4px 16px", color: "#666", fontSize: 12 }}>
            📎 {pendingUploads.map((u) => u.fileName).join(", ")}{" "}
            <button type="button" onClick={() => setPendingUploads([])}>clear</button>
          </p>
        )}
        <form onSubmit={onSend} style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #ddd" }}>
          <label style={{ cursor: "pointer", alignSelf: "center" }} title="Attach a file">
            {uploading ? "⏳" : "📎"}
            <input
              type="file"
              hidden
              disabled={!activeId || uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPickFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <input
            placeholder={activeChannel ? `Message #${activeChannel.name}` : "Select a channel"}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            disabled={!activeId}
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={!activeId || uploading}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
