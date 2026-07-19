"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Hash,
  Lock,
  MessageSquareText,
  Paperclip,
  Search,
  SendHorizonal,
  WifiOff,
  X,
} from "lucide-react";
import {
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  WS_EVENTS,
  type ChannelActivityEvent,
  type ChannelResponse,
  type MessageResponse,
  type PaginatedMessages,
  type PresenceEvent,
  type PresenceUser,
  type SearchResponse,
  type TypingEvent,
  type UnreadCounts,
  type WorkspaceMemberResponse,
} from "@relay/contracts";
import { Avatar } from "@/components/avatar";
import { MessageRow } from "@/components/message-row";
import { NotificationsBell } from "@/components/notifications-bell";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { createSocket, type RelaySocket } from "@/lib/socket";

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

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
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [onlineUsers, setOnlineUsers] = useState<Record<string, string>>({});
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [pendingUploads, setPendingUploads] = useState<{ id: string; fileName: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [unread, setUnread] = useState<UnreadCounts>({});
  const [members, setMembers] = useState<WorkspaceMemberResponse[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Thread panel
  const [threadRoot, setThreadRoot] = useState<MessageResponse | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageResponse[]>([]);
  const [threadDraft, setThreadDraft] = useState("");

  const socketRef = useRef<RelaySocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const threadRootIdRef = useRef<string | null>(null);
  threadRootIdRef.current = threadRoot?.id ?? null;
  // Display-name -> id map of mentions picked from the autocomplete; applied
  // at send time to produce canonical <@id> tokens.
  const pickedMentionsRef = useRef<Record<string, string>>({});

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
    if (!accessToken) return;
    loadChannels().catch((e) => setError(String(e)));
    api.get<UnreadCounts>(`/workspaces/${workspaceId}/unread`, accessToken).then(setUnread).catch(() => undefined);
    api
      .get<WorkspaceMemberResponse[]>(`/workspaces/${workspaceId}/members`, accessToken)
      .then(setMembers)
      .catch(() => undefined);
  }, [accessToken, workspaceId, loadChannels]);

  const markRead = useCallback(
    (channelId: string) => {
      if (!accessToken) return;
      api.post(`/channels/${channelId}/read`, {}, accessToken).catch(() => undefined);
      setUnread((prev) => {
        if (!(channelId in prev)) return prev;
        const { [channelId]: _, ...rest } = prev;
        return rest;
      });
    },
    [accessToken],
  );

  // Load the newest page + clear unread whenever the active channel changes.
  useEffect(() => {
    if (!accessToken || !activeId) return;
    let cancelled = false;
    (async () => {
      const page = await api.get<PaginatedMessages>(`/channels/${activeId}/messages?limit=30`, accessToken);
      if (cancelled) return;
      setMessages([...page.messages].reverse());
      setNextCursor(page.nextCursor);
      markRead(activeId);
    })().catch((e) => setError(String(e)));
    setThreadRoot(null);
    setThreadMessages([]);
    return () => {
      cancelled = true;
    };
  }, [accessToken, activeId, markRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length, activeId]);

  useEffect(() => {
    if (!accessToken) return;
    const socket = createSocket(accessToken);
    socketRef.current = socket;

    // Routes an incoming message to the right pane: replies belong to the
    // thread panel (when open); top-level messages belong to the timeline of
    // the active channel. The refs keep once-registered handlers current.
    const route = (incoming: MessageResponse) => {
      if (incoming.parentId) {
        if (incoming.parentId === threadRootIdRef.current) {
          setThreadMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === incoming.id);
            if (idx === -1) return [...prev, incoming];
            const next = [...prev];
            next[idx] = incoming;
            return next;
          });
        }
        return;
      }
      if (incoming.channelId !== activeIdRef.current) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === incoming.id);
        if (idx === -1) return [...prev, incoming];
        const next = [...prev];
        next[idx] = incoming;
        return next;
      });
      if (incoming.id === threadRootIdRef.current) setThreadRoot(incoming);
      setTypingUsers((prev) => {
        if (!(incoming.author.id in prev)) return prev;
        const { [incoming.author.id]: _, ...rest } = prev;
        return rest;
      });
    };

    socket.on(WS_EVENTS.messageCreated, route);
    socket.on(WS_EVENTS.messageUpdated, route);
    socket.on(WS_EVENTS.messageDeleted, route);
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
    // Workspace-wide unread signal: bump badges for channels we're not viewing.
    socket.on(WS_EVENTS.channelActivity, (e: ChannelActivityEvent) => {
      if (e.workspaceId !== workspaceId || e.authorId === user?.id) return;
      if (e.channelId === activeIdRef.current) {
        // Visible right now — advance the watermark instead of badging.
        if (accessToken) api.post(`/channels/${e.channelId}/read`, {}, accessToken).catch(() => undefined);
        return;
      }
      setUnread((prev) => ({ ...prev, [e.channelId]: (prev[e.channelId] ?? 0) + 1 }));
    });
    socket.on("connect_error", () => setDisconnected(true));
    socket.on("disconnect", () => setDisconnected(true));
    socket.on("connect", () => {
      setDisconnected(false);
      api
        .get<PresenceUser[]>(`/workspaces/${workspaceId}/presence`, accessToken)
        .then((users) => setOnlineUsers(Object.fromEntries(users.map((u) => [u.id, u.displayName]))))
        .catch(() => undefined);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, workspaceId]);

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

  async function loadOlder() {
    if (!accessToken || !activeId || !nextCursor) return;
    const page = await api.get<PaginatedMessages>(
      `/channels/${activeId}/messages?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
      accessToken,
    );
    setMessages((prev) => [...[...page.messages].reverse(), ...prev]);
    setNextCursor(page.nextCursor);
  }

  function upsertTimeline(msg: MessageResponse) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
    if (msg.id === threadRootIdRef.current) setThreadRoot(msg);
  }

  // Replace picked "@Display Name" spans with canonical <@id> tokens.
  function canonicalizeMentions(text: string): string {
    let out = text;
    for (const [name, id] of Object.entries(pickedMentionsRef.current)) {
      out = out.split(`@${name}`).join(`<@${id}>`);
    }
    return out;
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
        { content: canonicalizeMentions(draft), attachmentIds: pendingUploads.map((u) => u.id) },
        accessToken,
      );
      upsertTimeline(msg);
      setDraft("");
      setPendingUploads([]);
      pickedMentionsRef.current = {};
      setMentionQuery(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send");
    }
  }

  async function openThread(root: MessageResponse) {
    if (!accessToken) return;
    setThreadRoot(root);
    setThreadMessages([]);
    try {
      const page = await api.get<PaginatedMessages>(`/messages/${root.id}/thread?limit=100`, accessToken);
      setThreadMessages(page.messages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load thread");
    }
  }

  async function onSendReply(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !threadRoot || !threadDraft.trim()) return;
    setError(null);
    try {
      const reply = await api.post<MessageResponse>(
        `/messages/${threadRoot.id}/replies`,
        { content: threadDraft },
        accessToken,
      );
      setThreadMessages((prev) => (prev.some((m) => m.id === reply.id) ? prev : [...prev, reply]));
      setThreadDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reply");
    }
  }

  async function onEditMessage(id: string, content: string) {
    try {
      const updated = await api.patch<MessageResponse>(`/messages/${id}`, { content }, accessToken!);
      if (updated.parentId) setThreadMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
      else upsertTimeline(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to edit");
    }
  }

  async function onDeleteMessage(id: string) {
    try {
      const deleted = await api.del<MessageResponse>(`/messages/${id}`, accessToken!);
      if (deleted.parentId) setThreadMessages((prev) => prev.map((m) => (m.id === id ? deleted : m)));
      else upsertTimeline(deleted);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  async function onToggleReaction(id: string, emoji: string, reacted: boolean) {
    try {
      const path = `/messages/${id}/reactions/${encodeURIComponent(emoji)}`;
      const updated = reacted
        ? await api.del<MessageResponse>(path, accessToken!)
        : await api.put<MessageResponse>(path, {}, accessToken!);
      if (updated.parentId) setThreadMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
      else upsertTimeline(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to react");
    }
  }

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
    // Mention autocomplete: an "@" at start-of-word opens the member popup.
    const at = /(^|\s)@([^@]*)$/.exec(value);
    setMentionQuery(at ? at[2] : null);
    if (!activeId || !socketRef.current) return;
    if (!typingTimeoutRef.current) {
      socketRef.current.emit(WS_EVENTS.typingStart, { channelId: activeId });
    } else {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(stopTyping, 2000);
  }

  function pickMention(member: WorkspaceMemberResponse) {
    setDraft((prev) => prev.replace(/(^|\s)@([^@]*)$/, `$1@${member.displayName} `));
    pickedMentionsRef.current[member.displayName] = member.id;
    setMentionQuery(null);
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

  function renderSnippet(snippet: string) {
    return snippet.split(SEARCH_MARK_START).flatMap((part, i) => {
      if (i === 0) return [<span key={i}>{part}</span>];
      const [hit, rest] = part.split(SEARCH_MARK_END);
      return [
        <mark key={i} className="rounded bg-highlight px-0.5 font-semibold">
          {hit}
        </mark>,
        <span key={`${i}r`}>{rest}</span>,
      ];
    });
  }

  async function onCreateChannel(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !newChannel.trim()) return;
    setError(null);
    try {
      const created = await api.post<ChannelResponse>(
        `/workspaces/${workspaceId}/channels`,
        { name: newChannel, type: newChannelPrivate ? "PRIVATE" : "PUBLIC" },
        accessToken,
      );
      setNewChannel("");
      setNewChannelPrivate(false);
      await loadChannels();
      setActiveId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create channel");
    }
  }

  if (!ready || !user) return null;

  const activeChannel = channels.find((c) => c.id === activeId) ?? null;
  const channelNames = Object.fromEntries(channels.map((c) => [c.id, c.name]));
  const typingNames = Object.values(typingUsers);
  const mentionMatches =
    mentionQuery !== null
      ? members.filter((m) => m.displayName.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
      : [];

  const grouped: { label: string; items: MessageResponse[] }[] = [];
  for (const m of messages) {
    const label = dayLabel(m.createdAt);
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(m);
    else grouped.push({ label, items: [m] });
  }

  return (
    <main className="flex h-screen text-sm">
      {/* ---- Channel sidebar ---- */}
      <aside className="flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-ink">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Link href="/workspaces" className="rounded p-1 hover:bg-sidebar-hover" title="All workspaces">
            <ArrowLeft size={16} />
          </Link>
          <span className="truncate font-semibold text-white">Relay</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-sidebar-ink-dim">
            Channels
          </div>
          <ul className="flex flex-col gap-0.5">
            {channels.map((c) => {
              const count = unread[c.id] ?? 0;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      c.id === activeId
                        ? "bg-primary text-white"
                        : count > 0
                          ? "font-semibold text-white hover:bg-sidebar-hover"
                          : "text-sidebar-ink hover:bg-sidebar-hover hover:text-white"
                    }`}
                  >
                    {c.type === "PRIVATE" ? <Lock size={14} className="shrink-0" /> : <Hash size={14} className="shrink-0" />}
                    <span className="truncate">{c.name}</span>
                    {count > 0 && c.id !== activeId && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <form onSubmit={onCreateChannel} className="mt-3 flex flex-col gap-2 px-2">
            <div className="flex gap-1.5">
              <input
                className="w-full rounded-lg border border-white/10 bg-sidebar-hover px-2 py-1.5 text-xs text-white placeholder:text-sidebar-ink-dim focus:border-primary focus:outline-none"
                placeholder="new-channel"
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value)}
              />
              <button type="submit" className="rounded-lg bg-primary px-2.5 text-white hover:bg-primary-deep">
                +
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-sidebar-ink-dim">
              <input
                type="checkbox"
                checked={newChannelPrivate}
                onChange={(e) => setNewChannelPrivate(e.target.checked)}
                className="accent-primary"
              />
              <Lock size={11} /> Private channel
            </label>
          </form>

          <div className="mt-6 px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-sidebar-ink-dim">
            Online — {Object.keys(onlineUsers).length}
          </div>
          <ul className="flex flex-col gap-1 px-2">
            {Object.entries(onlineUsers).map(([id, name]) => (
              <li key={id} className="flex items-center gap-2 py-0.5">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="truncate">
                  {name}
                  {id === user.id && <span className="text-sidebar-ink-dim"> (you)</span>}
                </span>
              </li>
            ))}
            {Object.keys(onlineUsers).length === 0 && (
              <li className="text-xs text-sidebar-ink-dim">Nobody online</li>
            )}
          </ul>
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
          <Avatar name={user.displayName} size="sm" online />
          <span className="truncate text-xs text-white">{user.displayName}</span>
        </div>
      </aside>

      {/* ---- Main pane ---- */}
      <section className="flex min-w-0 flex-1 flex-col bg-card">
        {disconnected && (
          <div className="flex items-center justify-center gap-2 bg-banner px-4 py-2 text-xs font-semibold text-white">
            <WifiOff size={14} /> Connection lost — reconnecting…
          </div>
        )}

        <header className="flex items-center gap-4 border-b border-line px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {activeChannel?.type === "PRIVATE" ? (
              <Lock size={17} className="text-ink-muted" />
            ) : (
              <Hash size={17} className="text-ink-muted" />
            )}
            <h1 className="truncate text-base font-bold">{activeChannel?.name ?? "…"}</h1>
            {activeChannel?.topic && (
              <span className="hidden truncate border-l border-line pl-3 text-xs text-ink-muted md:inline">
                {activeChannel.topic}
              </span>
            )}
          </div>
          <form onSubmit={onSearch} className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                className="input-field w-56 rounded-full py-1.5 pl-8"
                placeholder="Search workspace…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            {searchResults && (
              <button
                type="button"
                className="btn-ghost p-1.5"
                title="Close search"
                onClick={() => {
                  setSearchResults(null);
                  setSearchQ("");
                }}
              >
                <X size={16} />
              </button>
            )}
          </form>
          {accessToken && <NotificationsBell accessToken={accessToken} channelNames={channelNames} />}
        </header>

        {searchResults && (
          <div className="max-h-[45%] overflow-y-auto border-b border-line bg-surface px-5 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-muted">
              {searchResults.results.length === 0
                ? "No results"
                : `${searchResults.results.length}${searchResults.hasMore ? "+" : ""} results`}
            </p>
            <div className="flex flex-col gap-2">
              {searchResults.results.map((r) => (
                <button
                  key={r.messageId}
                  onClick={() => {
                    setActiveId(r.channelId);
                    setSearchResults(null);
                    setSearchQ("");
                  }}
                  className="card p-3 text-left transition-colors hover:border-primary/40"
                >
                  <div className="mb-1 flex items-baseline gap-2 text-xs">
                    <span className="font-semibold text-primary">#{r.channelName}</span>
                    <span className="font-semibold">{r.author.displayName}</span>
                    <span className="text-ink-faint">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm leading-6">{renderSnippet(r.snippet)}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {nextCursor && (
            <div className="mb-3 text-center">
              <button
                className="btn-secondary rounded-full px-4 py-1 text-xs"
                onClick={() => loadOlder().catch((e) => setError(String(e)))}
              >
                Load older messages
              </button>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="my-3 flex items-center gap-3 px-3">
                <span className="h-px flex-1 bg-line" />
                <span className="rounded-full border border-line bg-card px-3 py-0.5 text-[11px] font-semibold text-ink-muted">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
              {group.items.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  currentUserId={user.id}
                  onEdit={onEditMessage}
                  onDelete={onDeleteMessage}
                  onToggleReaction={onToggleReaction}
                  onOpenThread={openThread}
                />
              ))}
            </div>
          ))}
          {messages.length === 0 && (
            <p className="mt-10 text-center text-ink-muted">
              No messages yet — say something in {activeChannel ? `#${activeChannel.name}` : "this channel"}.
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="min-h-5 px-5 text-xs text-ink-muted">
          {typingNames.length > 0 &&
            `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`}
        </div>
        {error && <p className="px-5 pb-1 text-xs text-danger">{error}</p>}

        <div className="relative border-t border-line px-5 py-4">
          {mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-5 z-20 mb-1 w-64 rounded-xl border border-line bg-card p-1 shadow-md">
              {mentionMatches.map((m) => (
                <button
                  key={m.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-primary-tint"
                  onClick={() => pickMention(m)}
                >
                  <Avatar name={m.displayName} size="sm" />
                  <span className="text-sm">{m.displayName}</span>
                  {m.id === user.id && <span className="text-xs text-ink-faint">(you)</span>}
                </button>
              ))}
            </div>
          )}
          {pendingUploads.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingUploads.map((u) => (
                <span
                  key={u.id}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs"
                >
                  <Paperclip size={12} /> {u.fileName}
                  <button
                    type="button"
                    className="text-ink-faint hover:text-danger"
                    onClick={() => setPendingUploads((prev) => prev.filter((p) => p.id !== u.id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={onSend} className="flex items-center gap-2">
            <label className={`btn-ghost cursor-pointer p-2 ${uploading ? "animate-pulse" : ""}`} title="Attach a file">
              <Paperclip size={18} />
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
              className="input-field rounded-xl py-2.5"
              placeholder={activeChannel ? `Message #${activeChannel.name} — type @ to mention` : "Select a channel"}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              disabled={!activeId}
            />
            <button
              type="submit"
              className="btn-primary flex items-center gap-1.5 rounded-xl py-2.5"
              disabled={!activeId || uploading}
            >
              <SendHorizonal size={16} />
            </button>
          </form>
        </div>
      </section>

      {/* ---- Thread panel ---- */}
      {threadRoot && (
        <aside className="flex w-96 shrink-0 flex-col border-l border-line bg-card">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="flex items-center gap-2 font-semibold">
              <MessageSquareText size={16} className="text-primary" /> Thread
            </span>
            <button className="btn-ghost p-1.5" title="Close thread" onClick={() => setThreadRoot(null)}>
              <X size={16} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <div className="border-b border-line pb-2">
              <MessageRow
                message={threadRoot}
                currentUserId={user.id}
                onEdit={onEditMessage}
                onDelete={onDeleteMessage}
                onToggleReaction={onToggleReaction}
              />
            </div>
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
              {threadRoot.replyCount} {threadRoot.replyCount === 1 ? "reply" : "replies"}
            </p>
            {threadMessages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                currentUserId={user.id}
                onEdit={onEditMessage}
                onDelete={onDeleteMessage}
                onToggleReaction={onToggleReaction}
              />
            ))}
          </div>
          <form onSubmit={onSendReply} className="flex items-center gap-2 border-t border-line px-4 py-3">
            <input
              className="input-field rounded-xl py-2"
              placeholder="Reply…"
              value={threadDraft}
              onChange={(e) => setThreadDraft(e.target.value)}
            />
            <button type="submit" className="btn-primary rounded-xl px-3 py-2">
              <SendHorizonal size={15} />
            </button>
          </form>
        </aside>
      )}
    </main>
  );
}
