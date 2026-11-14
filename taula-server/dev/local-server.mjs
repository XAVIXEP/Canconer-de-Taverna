// Servidor LOCAL de proves: executa la classe Room real darrere d'un WebSocket mínim (RFC 6455)
// fet a mà, perquè es pugui provar sense Cloudflare. NO és el servidor de producció.
// Ús: node dev/local-server.mjs [port] [carpeta-estàtica]   (per defecte 8787 i ..)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let pending = null;
class NetWS {
  constructor(sock) { this.sock = sock; this.readyState = 1; this.att = null; }
  accept() {}
  send(t) { if (this.readyState === 1) this.sock.write(frame(Buffer.from(t), 0x1)); }
  close(code = 1000) { if (this.readyState === 1) { this.readyState = 3; const b = Buffer.alloc(2); b.writeUInt16BE(code); try { this.sock.end(frame(b, 0x8)); } catch {} } }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
}
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.request = a; this.response = b; } };
globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = new NetWS(pending); pending.netws = this[1]; } };
const RealResponse = Response;
globalThis.Response = class extends RealResponse {
  constructor(b, i = {}) { if (i.status === 101) { super(null, { status: 200 }); this.is101 = true; } else super(b, i); }
};

const { Room, default: worker } = await import("../src/index.js");
const { normRoom, originAllowed } = await import("../src/logic.js");

function frame(buf, op) {
  const n = buf.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
  return Buffer.concat([head, buf]);
}
function* parse(state, chunk) {
  state.buf = Buffer.concat([state.buf, chunk]);
  for (;;) {
    const b = state.buf; if (b.length < 2) return;
    const op = b[0] & 15; let len = b[1] & 127, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) throw new Error("frame massa gran");
    const masked = (b[1] & 128) !== 0; if (masked) off += 4;
    if (b.length < off + len) return;
    const data = Buffer.from(b.subarray(off, off + len));
    if (masked) { const m = b.subarray(off - 4, off); for (let i = 0; i < len; i++) data[i] ^= m[i & 3]; }
    state.buf = b.subarray(off + len);
    yield { op, data };
  }
}

const port = Number(process.argv[2] || 8787);
const root = path.resolve(process.argv[3] || path.join(import.meta.dirname, "../.."));
const rooms = new Map();
const ALLOWED = process.env.ALLOWED_ORIGINS || "*";
const env = { ALLOWED_ORIGINS: ALLOWED, ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: (r) => getRoom(n).room.fetch(r) }) } };

function getRoom(name) {
  if (!rooms.has(name)) {
    const store = new Map(); const sockets = new Set();
    const ctx = {
      storage: {
        get: async (k) => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); },
        deleteAll: async () => { store.clear(); },
        setAlarm: async (t) => { clearTimeout(ctx.timer); ctx.timer = setTimeout(() => R.room.alarm(), Math.max(0, t - Date.now())); ctx.timer.unref(); },
      },
      setWebSocketAutoResponse(p) { this.auto = p; },
      getWebSockets: () => [...sockets],
      acceptWebSocket: (w) => sockets.add(w),
    };
    const R = { room: null, sockets, ctx, store };
    R.room = new Room(ctx, {});
    rooms.set(name, R);
  }
  return rooms.get(name);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") { res.end("ok\n"); return; }
  if (url.pathname === "/create") {          // passa pel Worker real
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const r = await worker.fetch(new Request("http://local/create", {
        method: req.method, headers: req.headers.origin ? { Origin: req.headers.origin } : {},
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    });
    return;
  }
  const f = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end("404"); return; }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
  res.setHeader("content-type", types[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
});

server.on("upgrade", async (req, sock) => {
  const u = new URL(req.url, "http://local");
  const m = u.pathname.match(/^\/ws\/([^/]+)$/);
  if (!m || !originAllowed(req.headers.origin, ALLOWED)) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const name = normRoom(decodeURIComponent(m[1]));
  if (!name) { sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
  const R = getRoom(name);
  if (R.sockets.size >= 80) { sock.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"); return; }
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  pending = sock;
  const fakeReq = { url: `http://local/ws/${name}${u.search}`, method: "GET", headers: { get: (h) => (h.toLowerCase() === "upgrade" ? "websocket" : null) } };
  await R.room.fetch(fakeReq);
  const ws = sock.netws; pending = null;
  const st = { buf: Buffer.alloc(0) };
  const drop = () => { if (ws.readyState === 3 && !R.sockets.has(ws)) return; ws.readyState = 3; R.sockets.delete(ws); R.room.webSocketClose(ws); };
  sock.on("data", async (c) => {
    try {
      for (const f of parse(st, c)) {
        if (f.op === 8) { sock.end(frame(Buffer.alloc(0), 8)); drop(); }
        else if (f.op === 9) sock.write(frame(f.data, 10));
        else if (f.op === 1) {
          const t = f.data.toString();
          if (R.ctx.auto && t === R.ctx.auto.request) ws.send(R.ctx.auto.response);   // com fa Cloudflare
          else await R.room.webSocketMessage(ws, t);
        }
      }
    } catch { sock.destroy(); }
  });
  sock.on("close", drop); sock.on("error", drop);
});

server.listen(port, () => console.log(`Local: http://localhost:${port}/  (ws://localhost:${port}/ws/<sala>)`));
