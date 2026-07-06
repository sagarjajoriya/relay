import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: config.get<string>("CORS_ORIGIN"), credentials: true });

  const port = config.get<number>("PORT")!;
  await app.listen(port);
  console.log(`Relay API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
