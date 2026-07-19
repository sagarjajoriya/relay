export interface NotificationResponse {
  id: string;
  type: "MESSAGE" | "MENTION" | "THREAD_REPLY";
  workspaceId: string;
  channelId: string;
  messageId: string;
  // Snippet of the message at read time; null if the message was deleted.
  messagePreview: string | null;
  authorDisplayName: string | null;
  readAt: string | null;
  emailedAt: string | null;
  createdAt: string;
}
