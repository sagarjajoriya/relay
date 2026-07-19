import { z } from "zod";
import { MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentResponse } from "./attachments";

export const sendMessageSchema = z
  .object({
    content: z.string().max(4000).default(""),
    attachmentIds: z.array(z.string().min(1)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .refine((v) => v.content.trim().length > 0 || (v.attachmentIds?.length ?? 0) > 0, {
    message: "message needs text or at least one attachment",
    path: ["content"],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const listMessagesQuerySchema = z.object({
  // Opaque keyset cursor; pass the previous page's nextCursor to fetch older.
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export interface MessageAuthor {
  id: string;
  displayName: string;
}

// Aggregated per emoji; userIds let each viewer derive "did I react" from the
// same shared broadcast payload (viewer-specific fields can't ride WS events).
export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

export const reactionEmojiSchema = z.string().min(1).max(32);

export const MENTION_TOKEN_REGEX = /<@([a-z0-9]+)>/g;

// The canonical message shape. REST returns this today; M3 will broadcast the
// identical object over WebSocket as `message.created` / `message.updated`, so
// this interface is the single contract both transports share.
export interface MessageResponse {
  id: string;
  channelId: string;
  workspaceId: string;
  author: MessageAuthor;
  // Thread fields: parentId set on replies (excluded from channel timeline);
  // replyCount/lastReplyAt maintained on the parent.
  parentId: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  reactions: ReactionSummary[];
  // Users referenced by <@id> tokens in content, resolved server-side.
  mentions: MessageAuthor[];
  // null when the message is a tombstone (soft-deleted).
  content: string | null;
  // Empty for tombstones; download URLs are short-lived pre-signed GETs.
  attachments: AttachmentResponse[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface PaginatedMessages {
  // Newest-first. Feed nextCursor back to load the older page.
  messages: MessageResponse[];
  nextCursor: string | null;
}
