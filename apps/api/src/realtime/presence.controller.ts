import { Controller, ForbiddenException, Get, Param, UseGuards } from "@nestjs/common";
import { prisma } from "@relay/db";
import type { PresenceUser } from "@relay/contracts";
import { CurrentUser, type RequestUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RealtimeGateway } from "./realtime.gateway";

@Controller("workspaces/:workspaceId/presence")
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly gateway: RealtimeGateway) {}

  @Get()
  async list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<PresenceUser[]> {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.userId } },
    });
    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }
    return this.gateway.onlineUsersInWorkspace(workspaceId);
  }
}
