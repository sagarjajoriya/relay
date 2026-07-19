import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import {
  addChannelMemberSchema,
  createChannelSchema,
  type AddChannelMemberInput,
  type CreateChannelInput,
} from "@relay/contracts";
import { CurrentUser, type RequestUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ChannelsService } from "./channels.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post("workspaces/:workspaceId/channels")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelInput,
  ) {
    return this.channels.create(user.userId, workspaceId, body);
  }

  @Get("workspaces/:workspaceId/channels")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string) {
    return this.channels.list(user.userId, workspaceId);
  }

  @Get("channels/:channelId")
  get(@CurrentUser() user: RequestUser, @Param("channelId") channelId: string) {
    return this.channels.get(user.userId, channelId);
  }

  @Post("channels/:channelId/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentUser() user: RequestUser, @Param("channelId") channelId: string) {
    await this.channels.markRead(user.userId, channelId);
  }

  @Get("workspaces/:workspaceId/unread")
  unread(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string) {
    return this.channels.unreadCounts(user.userId, workspaceId);
  }

  @Post("channels/:channelId/members")
  addMember(
    @CurrentUser() user: RequestUser,
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(addChannelMemberSchema)) body: AddChannelMemberInput,
  ) {
    return this.channels.addMember(user.userId, channelId, body.userId);
  }
}
