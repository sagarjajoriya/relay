import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ChannelsModule } from "../channels/channels.module";
import { PresenceController } from "./presence.controller";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  imports: [JwtModule.register({}), ChannelsModule],
  controllers: [PresenceController],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
