import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@relay/db";
import type { WorkspaceResponse } from "@relay/contracts";

@Injectable()
export class WorkspacesService {
  async create(userId: string, input: { name: string; slug: string }): Promise<WorkspaceResponse> {
    const existing = await prisma.workspace.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new ConflictException("A workspace with this slug already exists");
    }

    const workspace = await prisma.workspace.create({
      data: {
        name: input.name,
        slug: input.slug,
        members: {
          create: { userId, role: "OWNER" },
        },
      },
    });

    return this.toResponse(workspace, "OWNER");
  }

  async join(userId: string, slug: string): Promise<WorkspaceResponse> {
    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) {
      throw new NotFoundException("No workspace found with this slug");
    }

    const membership = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: {},
      create: { workspaceId: workspace.id, userId, role: "MEMBER" },
    });

    return this.toResponse(workspace, membership.role);
  }

  async listForUser(userId: string): Promise<WorkspaceResponse[]> {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    });

    return memberships.map((m) => this.toResponse(m.workspace, m.role));
  }

  private toResponse(
    workspace: { id: string; name: string; slug: string; createdAt: Date },
    role: WorkspaceResponse["role"],
  ): WorkspaceResponse {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
      createdAt: workspace.createdAt.toISOString(),
    };
  }
}
