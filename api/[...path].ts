import app from '../src/server/index.js';
import type { Request, Response } from 'express';

export default function handler(request: Request, response: Response): void {
  // The rewrite keeps all workspace endpoints on this single Vercel Function.
  const url = new URL(request.url, 'http://local.invalid');
  const route = url.searchParams.get('__workspaceRoute');
  if (route !== null) {
    if (route && !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(route)) {
      response.status(404).json({ error: 'Unknown workspace route.' });
      return;
    }
    url.searchParams.delete('__workspaceRoute');
    request.url = `/api/workspace${route ? `/${route}` : ''}${url.search}`;
  }
  app(request, response);
}
