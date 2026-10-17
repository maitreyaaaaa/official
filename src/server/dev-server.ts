import 'dotenv/config';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { app } from './index.js';
import { closeGraph } from './graph/client.js';

async function start(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The server requires NODE_ENV=development; serving stays disabled until authentication and authorization are implemented.');
  }

  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const host = '127.0.0.1';
  const server = createHttpServer(app);
  const vite = await createViteServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: { server }, port, host, hmr: { server } },
    appType: 'spa',
  });
  const clientEntryPaths = new Set(['/', '/review', '/method', '/guardrails', '/app']);
  const viteInternalPrefixes = ['/@', '/src/', '/node_modules/', '/assets/'];
  const indexTemplate = await readFile(resolve('index.html'), 'utf8');
  app.use(async (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const pathname = request.path.replace(/\/+$/, '') || '/';
    if (clientEntryPaths.has(pathname)
      || viteInternalPrefixes.some((prefix) => pathname.startsWith(prefix))
      || extname(pathname)) return next();

    try {
      const html = await vite.transformIndexHtml(request.originalUrl, indexTemplate);
      response.status(404).type('html').send(html);
    } catch (error) {
      next(error);
    }
  });
  app.use(vite.middlewares);

  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(JSON.stringify({ event: 'local_server_listen_failed', errorName: error.name }));
    void Promise.allSettled([vite.close(), closeGraph()]).then(() => {
      process.exitCode = 1;
    });
  });
  server.listen(port, host, () => {
    console.log(`official is listening on http://${host}:${port}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      void Promise.allSettled([vite.close(), closeGraph()]).then(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void start().catch((error: unknown) => {
  console.error('Could not start official.', error instanceof Error ? error.message : 'Unknown startup error.');
  process.exitCode = 1;
});
