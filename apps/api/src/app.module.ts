import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env.validation";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ChannelsModule } from "./channels/channels.module";
import { MessagesModule } from "./messages/messages.module";
import { RealtimeModule } from "./realtime/realtime.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AuthModule,
    UsersModule,
    WorkspacesModule,
    EventEmitterModule.forRoot(),
    ChannelsModule,
    MessagesModule,
    RealtimeModule,
  ],
})
export class AppModule {}
