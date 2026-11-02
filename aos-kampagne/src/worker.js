// Einstieg für Cloudflare Workers: /api/* geht an die Schnittstelle, alles andere sind statische Dateien.
import { handle } from './server.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handle({ request, env, ctx });
    return env.ASSETS.fetch(request);
  },
};
