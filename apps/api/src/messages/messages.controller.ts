import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  editMessageSchema,
  listMessagesQuerySchema,
  reactionEmojiSchema,
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
    return this.messages.send(user.userId, channelId, body);
  }

  @Get("channels/:channelId/messages")
  list(
    @CurrentUser() user: RequestUser,
    @Param("channelId") channelId: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.list(user.userId, channelId, query);
  }

  @Post("messages/:messageId/replies")
  reply(
    @CurrentUser() user: RequestUser,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.messages.reply(user.userId, messageId, body);
  }

  @Get("messages/:messageId/thread")
  thread(
    @CurrentUser() user: RequestUser,
    @Param("messageId") messageId: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.listThread(user.userId, messageId, query);
  }

  @Put("messages/:messageId/reactions/:emoji")
  react(
    @CurrentUser() user: RequestUser,
    @Param("messageId") messageId: string,
    @Param("emoji", new ZodValidationPipe(reactionEmojiSchema)) emoji: string,
  ) {
    return this.messages.react(user.userId, messageId, emoji);
  }

  @Delete("messages/:messageId/reactions/:emoji")
  unreact(
    @CurrentUser() user: RequestUser,
    @Param("messageId") messageId: string,
    @Param("emoji", new ZodValidationPipe(reactionEmojiSchema)) emoji: string,
  ) {
    return this.messages.unreact(user.userId, messageId, emoji);
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
