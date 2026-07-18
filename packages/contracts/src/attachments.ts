import { z } from "zod";

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export const requestUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, "must be a valid MIME type"),
  // Client-declared; re-verified against the real object at link time.
  sizeBytes: z.coerce.number().int().positive(),
});
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export interface RequestUploadResponse {
  attachmentId: string;
  // Pre-signed PUT — the client uploads bytes directly to object storage;
  // they never transit the API.
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface AttachmentResponse {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  // Short-lived pre-signed GET; the bucket itself is never public.
  downloadUrl: string;
}
