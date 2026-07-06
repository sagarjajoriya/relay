import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  editMessageSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  type EditMessageInput,
  type ListMessagesQuery,
  type SendMessageInput,
} from "@relay/contracts";
import { CurrentUser, type RequestUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MessagesService } from "./messages.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post("channels/:channelId/messages")
  send(
    @CurrentUser() user: RequestUser,
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.messages.send(user.userId, channelId, body.content);
  }

  @Get("channels/:channelId/messages")
  list(
    @CurrentUser() user: RequestUser,
    @Param("channelId") channelId: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.list(user.userId, channelId, query);
  }

  @Patch("messages/:messageId")
  edit(
    @CurrentUser() user: RequestUser,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(editMessageSchema)) body: EditMessageInput,
  ) {
    return this.messages.edit(user.userId, messageId, body.content);
  }

  @Delete("messages/:messageId")
  remove(@CurrentUser() user: RequestUser, @Param("messageId") messageId: string) {
    return this.messages.remove(user.userId, messageId);
  }
}
