import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { parseClientMsg } from '../shared/protocol';
import { Room } from './room';
import type { Client } from './room';

const PORT = Number(process.env.PORT ?? 8080);
const REGION = process.env.REGION ?? 'local';
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 12);
const STATIC_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// ───────────────────────────────────────── rooms

const rooms: Room[] = [];
let roomSeq = 0;

function pickRoom(): Room | null {
  // fill the busiest room that still has space → players meet each other
  const open = rooms.filter((r) => r.hasSpace).sort((a, b) => b.humans - a.humans);
  if (open.length) return open[0];
  if (rooms.length >= MAX_ROOMS) return null;
  const room = new Room(`${REGION}-${++roomSeq}`);
  room.start();
  rooms.push(room);
  console.log(`[room] created ${room.id}`);
  return room;
}

setInterval(() => {
  // reap idle rooms, keep one warm
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i];
    if (rooms.length > 1 && r.idleMs > 60_000) {
      r.stop();
      rooms.splice(i, 1);
      console.log(`[room] closed ${r.id}`);
    }
  }
}, 15_000);

// ───────────────────────────────────────── http

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Client not built. Run `npm run build` or use `npm run dev`.');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(STATIC_DIR, path);
  if (!file.startsWith(STATIC_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  const ext = extname(file);
  const immutable = file.includes(`${join(STATIC_DIR, 'assets')}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    const humans = rooms.reduce((n, r) => n + r.humans, 0);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, region: REGION, rooms: rooms.length, players: humans }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

// ───────────────────────────────────────── websockets

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  const room = pickRoom();
  if (!room) {
    ws.close(1013, 'server full');
    return;
  }
  const client: Client = { ws, name: '', skin: 0, coreId: null, joined: false, msgBudget: 40, lastSeen: Date.now() };
  room.add(client);
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 10_000);

  ws.on('message', (data, isBinary) => {
    if (isBinary || !Room.allowMessage(client)) return;
    const msg = parseClientMsg(data.toString());
    if (msg) room.handle(client, msg);
  });
  ws.on('close', () => {
    clearInterval(heartbeat);
    room.remove(client);
  });
  ws.on('error', () => ws.terminate());
  void req;
});

server.listen(PORT, () => {
  console.log(`Moonbite server · region=${REGION} · http://localhost:${PORT} · ws path /ws`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} — shutting down`);
    for (const r of rooms) r.stop();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
