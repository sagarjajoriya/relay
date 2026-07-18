import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import IORedis from "ioredis";
import { validateEnv } from "./config/env.validation";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ChannelsModule } from "./channels/channels.module";
import { MessagesModule } from "./messages/messages.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SearchModule } from "./search/search.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // BullMQ workers block on Redis reads; ioredis must not cap retries
        // per request or long-poll commands get killed under reconnects.
        connection: new IORedis(config.get<string>("REDIS_URL")!, { maxRetriesPerRequest: null }),
      }),
    }),
    AuthModule,
    UsersModule,
    WorkspacesModule,
    EventEmitterModule.forRoot(),
    ChannelsModule,
    MessagesModule,
    RealtimeModule,
    NotificationsModule,
    SearchModule,
  ],
})
export class AppModule {}
