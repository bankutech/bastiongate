import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { config } from './config';

export async function boot() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 2 * 1024 * 1024,
      trustProxy: config.trustProxy,
      ignoreTrailingSlash: true,
    }),
    { rawBody: true },
  );
  if (config.corsOrigins.length) {
    app.enableCors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['content-type', 'authorization'] });
  }
  (app.getHttpAdapter().getInstance() as any).addHook('onSend', async (_req: unknown, reply: any) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
  });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  return app;
}

if (require.main === module) {
  boot();
}
