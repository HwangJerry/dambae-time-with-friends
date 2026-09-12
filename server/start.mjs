import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';

// Workerd executes the built Worker locally. No Cloudflare account is used.
const modulePaths = (await readdir('dist/server', { recursive: true })).filter(
  (path) => path.endsWith('.js'),
);
modulePaths.sort((a, b) =>
  a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b),
);
const runtime = new Miniflare({
  ...convertV4MiniflareOptions({
    host: '127.0.0.1',
    port: 0,
    workers: [
      {
        name: 'smoking-room',
        modules: modulePaths.map((path) => ({
          type: 'ESModule',
          path: `dist/server/${path}`,
        })),
        modulesRules: [{ type: 'ESModule', include: ['**/*.js', '**/*.mjs'] }],
        compatibilityDate: '2026-05-15',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'smoking-room' },
        assets: {
          directory: 'dist/client',
          routerConfig: { has_user_worker: true },
        },
        bindings: Object.fromEntries(
          ['TURN_URLS', 'TURN_SHARED_SECRET']
            .filter((key) => process.env[key])
            .map((key) => [key, process.env[key]]),
        ),
      },
    ],
  }),
  resourcePersistencePath: resolve(process.env.DATA_DIR || '.data'),
});
await runtime.ready;
const db = await runtime.getD1Database('DB');
await db
  .prepare('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY)')
  .run();
for (const name of (await readdir('drizzle'))
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  const applied = await db
    .prepare('SELECT name FROM app_migrations WHERE name = ?')
    .bind(name)
    .first();
  if (applied) continue;
  const sql = await readFile(`drizzle/${name}`, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  await db.batch([
    ...statements.map((s) => db.prepare(s)),
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').bind(name),
  ]);
  console.log(`Applied migration: ${name}`);
}
// Public listener starts only after migrations. Streaming proxy preserves SSE/RSC.
const { request: httpRequest } = await import('node:http');
const target = await runtime.ready;
const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  const upstream = httpRequest(
    new URL(req.url, target),
    {
      method: req.method,
      headers: { ...req.headers, host: req.headers.host },
    },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || '127.0.0.1',
  () => console.log('Smoking room ready'),
);
async function shutdown() {
  server.close();
  server.closeAllConnections();
  await runtime.dispose();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
