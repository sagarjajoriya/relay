import { z } from "zod";

// DM is a valid ChannelType in the DB but not creatable via the M2 API — direct
// messages get their own find-or-create endpoint in a later milestone.
export const creatableChannelTypes = ["PUBLIC", "PRIVATE"] as const;
export type CreatableChannelType = (typeof creatableChannelTypes)[number];

export const createChannelSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "channel name must be lowercase alphanumeric with hyphens"),
  type: z.enum(creatableChannelTypes).default("PUBLIC"),
  topic: z.string().max(250).optional(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const addChannelMemberSchema = z.object({
  userId: z.string().min(1),
});
export type AddChannelMemberInput = z.infer<typeof addChannelMemberSchema>;

export interface ChannelResponse {
  id: string;
  workspaceId: string;
  type: "PUBLIC" | "PRIVATE" | "DM";
  name: string;
  topic: string | null;
  createdAt: string;
}
