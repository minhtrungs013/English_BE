import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173').split(',').map((s) => s.trim()) });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Wordbook API').setVersion('0.2.0').addBearerAuth().build());
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(config.get('PORT', 3000));
  await app.listen(port);
  Logger.log('Wordbook API on http://localhost:' + port + '/api  (docs: /api/docs)', 'Bootstrap');
}
void bootstrap();
