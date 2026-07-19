"use client";

import { useState } from "react";
import { Check, Download, FileText, Pencil, Trash2, X } from "lucide-react";
import type { MessageResponse } from "@relay/contracts";
import { Avatar } from "./avatar";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function MessageRow({
  message,
  isOwn,
  onEdit,
  onDelete,
}: {
  message: MessageResponse;
  isOwn: boolean;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
                {message.content}
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
          </>
        )}
      </div>

      {isOwn && !tombstone && !editing && (
        <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border border-line bg-card p-0.5 shadow-sm group-hover:flex">
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
        </div>
      )}
    </div>
  );
}
