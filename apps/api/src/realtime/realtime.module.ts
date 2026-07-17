import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ChannelsModule } from "../channels/channels.module";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  imports: [JwtModule.register({}), ChannelsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
