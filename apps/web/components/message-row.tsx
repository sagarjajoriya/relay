"use client";

import { useState, type ReactNode } from "react";
import { Check, Download, FileText, MessageSquareText, Pencil, SmilePlus, Trash2, X } from "lucide-react";
import type { MessageResponse } from "@relay/contracts";
import { Avatar } from "./avatar";

export const REACTION_SET = ["👍", "❤️", "🔥", "😂", "🎉", "👀"];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

// Content is plain text with canonical <@userId> mention tokens; render them
// as highlighted chips using the server-resolved mention list.
function renderContent(message: MessageResponse): ReactNode[] {
  const nameById = new Map(message.mentions.map((m) => [m.id, m.displayName]));
  const parts = (message.content ?? "").split(/(<@[a-z0-9]+>)/g);
  return parts.map((part, i) => {
    const match = /^<@([a-z0-9]+)>$/.exec(part);
    if (!match) return <span key={i}>{part}</span>;
    const name = nameById.get(match[1]);
    return name ? (
      <span key={i} className="rounded bg-primary-tint px-1 font-semibold text-primary">
        @{name}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

export function MessageRow({
  message,
  currentUserId,
  onEdit,
  onDelete,
  onToggleReaction,
  onOpenThread,
}: {
  message: MessageResponse;
  currentUserId: string;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (id: string, emoji: string, reacted: boolean) => Promise<void>;
  // Absent inside the thread panel — replies can't open threads of their own.
  onOpenThread?: (message: MessageResponse) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isOwn = message.author.id === currentUserId;
  const tombstone = message.deletedAt !== null;

  async function saveEdit() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await onEdit(message.id, draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative flex gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-100/70">
      <div className="pt-0.5">
        <Avatar name={tombstone ? "?" : message.author.displayName} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${tombstone ? "text-ink-faint" : ""}`}>
            {message.author.displayName}
          </span>
          <span className="text-[11px] text-ink-faint">{formatTime(message.createdAt)}</span>
        </div>

        {tombstone ? (
          <p className="text-sm italic text-ink-faint">This message was deleted</p>
        ) : editing ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              className="input-field py-1.5"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <button className="btn-ghost p-1.5 text-success hover:text-success" onClick={saveEdit} disabled={busy} title="Save">
              <Check size={16} />
            </button>
            <button className="btn-ghost p-1.5" onClick={() => setEditing(false)} title="Cancel">
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            {message.content && (
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {renderContent(message)}
                {message.editedAt && <span className="ml-1 text-[11px] italic text-ink-faint">(edited)</span>}
              </p>
            )}
            {message.attachments.map((a) =>
              a.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={a.id}
                  src={a.downloadUrl}
                  alt={a.fileName}
                  className="mt-2 max-h-60 max-w-xs rounded-lg border border-line object-cover"
                />
              ) : (
                <a
                  key={a.id}
                  href={a.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex w-fit items-center gap-3 rounded-xl border border-line bg-gray-50 px-4 py-3 transition-colors hover:border-primary/40"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-card text-primary shadow-sm">
                    <FileText size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{a.fileName}</span>
                    <span className="text-xs text-ink-muted">{formatSize(a.sizeBytes)}</span>
                  </span>
                  <Download size={16} className="ml-2 text-ink-muted" />
                </a>
              ),
            )}

            {message.reactions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {message.reactions.map((r) => {
                  const mine = r.userIds.includes(currentUserId);
                  return (
                    <button
                      key={r.emoji}
                      onClick={() => onToggleReaction(message.id, r.emoji, mine)}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                        mine
                          ? "border-primary/50 bg-primary-tint font-semibold text-primary"
                          : "border-line bg-gray-50 hover:border-primary/30"
                      }`}
                    >
                      <span>{r.emoji}</span>
                      <span>{r.count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {onOpenThread && message.replyCount > 0 && (
              <button
                onClick={() => onOpenThread(message)}
                className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                <MessageSquareText size={13} />
                {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
              </button>
            )}
          </>
        )}
      </div>

      {!tombstone && !editing && (
        <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border border-line bg-card p-0.5 shadow-sm group-hover:flex">
          <div className="relative">
            <button className="btn-ghost p-1.5" title="Add reaction" onClick={() => setPickerOpen((v) => !v)}>
              <SmilePlus size={14} />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-8 z-20 flex gap-1 rounded-xl border border-line bg-card p-1.5 shadow-md">
                {REACTION_SET.map((emoji) => (
                  <button
                    key={emoji}
                    className="rounded-lg p-1 text-base hover:bg-gray-100"
                    onClick={() => {
                      const mine = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(currentUserId);
                      onToggleReaction(message.id, emoji, !!mine);
                      setPickerOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          {onOpenThread && (
            <button className="btn-ghost p-1.5" title="Reply in thread" onClick={() => onOpenThread(message)}>
              <MessageSquareText size={14} />
            </button>
          )}
          {isOwn && (
            <>
              <button
                className="btn-ghost p-1.5"
                title="Edit message"
                onClick={() => {
                  setDraft(message.content ?? "");
                  setEditing(true);
                }}
              >
                <Pencil size={14} />
              </button>
              <button className="btn-ghost p-1.5 hover:text-danger" title="Delete message" onClick={() => onDelete(message.id)}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
