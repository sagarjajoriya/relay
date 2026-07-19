"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import type { NotificationResponse } from "@relay/contracts";
import { api } from "@/lib/api";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NotificationsBell({
  accessToken,
  channelNames,
}: {
  accessToken: string;
  channelNames: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationResponse[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const data = await api.get<NotificationResponse[]>("/notifications", accessToken).catch(() => []);
    setItems(data);
  }

  // Load once for the badge; reload on every open for freshness.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!open) return;
    load();
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unread = items.filter((n) => n.readAt === null).length;

  return (
    <div className="relative" ref={panelRef}>
      <button className="btn-ghost relative p-2" onClick={() => setOpen((v) => !v)} title="Notifications">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-96 rounded-2xl border border-line bg-card shadow-[0px_4px_12px_rgba(0,0,0,0.05)]">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Notifications</div>
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li
                key={n.id}
                className={`border-l-2 px-4 py-3 ${
                  n.readAt === null ? "border-l-primary bg-primary-tint/40" : "border-l-transparent"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm">
                    <span className="font-semibold">{n.authorDisplayName ?? "Someone"}</span>{" "}
                    <span className="text-ink-muted">in #{channelNames[n.channelId] ?? "unknown"}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-ink-muted">
                  {n.messagePreview ?? <em>message deleted</em>}
                </p>
              </li>
            ))}
            {items.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-ink-muted">You&apos;re all caught up.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
