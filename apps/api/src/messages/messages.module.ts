import { Module } from "@nestjs/common";
import { AttachmentsModule } from "../attachments/attachments.module";
import { ChannelsModule } from "../channels/channels.module";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";

@Module({
  imports: [ChannelsModule, AttachmentsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
