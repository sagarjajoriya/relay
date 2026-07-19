import { z } from "zod";

export const workspaceRoles = ["OWNER", "ADMIN", "MEMBER"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const joinWorkspaceSchema = z.object({
  slug: z.string().min(2).max(50),
});
export type JoinWorkspaceInput = z.infer<typeof joinWorkspaceSchema>;

export interface WorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMemberResponse {
  id: string;
  displayName: string;
  role: WorkspaceRole;
}
