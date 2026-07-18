import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: config.get<string>("CORS_ORIGIN"), credentials: true });

  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis(config.get<string>("REDIS_URL")!);
  app.useWebSocketAdapter(redisAdapter);

  const port = config.get<number>("PORT")!;
  await app.listen(port);
  console.log(`Relay API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
