// Prova de la classe Room amb un ctx i uns sockets simulats (no és Cloudflare real).
import test from "node:test";
import assert from "node:assert/strict";

class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.att = null; this.closed = null; }
  accept() { this.accepted = true; }
  send(t) { this.sent.push(JSON.parse(t)); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
}
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.request = a; this.response = b; } };
let lastPair = null;
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWS(); this[1] = new FakeWS(); lastPair = this; } };
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init = {}) {
    if (init.status === 101) { super(null, { status: 200 }); this.status101 = true; this.webSocket = init.webSocket; }
    else super(body, init);
  }
};

const { Room } = await import("../src/index.js");
const { ROOM_TTL_MS } = await import("../src/logic.js");

function makeRoom() {
  const store = new Map();
  const sockets = [];
  const ctx = {
    alarmAt: null,
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => { store.set(k, structuredClone(v)); },
      deleteAll: async () => { store.clear(); },
      setAlarm: async (t) => { ctx.alarmAt = t; },
    },
    setWebSocketAutoResponse() {},
    getWebSockets: () => sockets,
    acceptWebSocket: (ws) => sockets.push(ws),
  };
  return { room: new Room(ctx, {}), sockets, store, ctx };
}
const upgrade = (code = "es-cau", key) => ({
  url: `https://x/ws/${code}${key ? "?k=" + key : ""}`,
  method: "GET",
  headers: { get: (h) => (h === "Upgrade" ? "websocket" : null) },
});
const init = (room, open = true, hostKey = "clau") => room.fetch(new Request("https://room/init", {
  method: "POST", body: JSON.stringify({ open, hostKey }),
}));

// ---------- Sales antigues (codi amb lletres): com abans ----------

test("antiga: connexió rep estat inicial i els altres reben el recompte", async () => {
  const { room, sockets } = makeRoom();
  const r1 = await room.fetch(upgrade());
  assert.equal(r1.status101, true);
  assert.equal(sockets[0].sent[0].t, "state");
  assert.equal(sockets[0].sent[0].song, null);
  await room.fetch(upgrade());
  assert.deepEqual(sockets[0].sent.at(-1), { t: "n", n: 2 });
});

test("antiga: set es difon a tots i es persisteix", async () => {
  const { room, sockets, store } = makeRoom();
  await room.fetch(upgrade()); await room.fetch(upgrade());
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 42, who: "Pep", cid: "a" }));
  for (const s of sockets) {
    const m = s.sent.at(-1);
    assert.equal(m.t, "state"); assert.equal(m.song, 42); assert.equal(m.seq, 1); assert.equal(m.who, "Pep");
  }
  assert.equal(store.get("s").song, 42);
});

test("límit de freqüència i missatges invàlids", async () => {
  const { room, sockets } = makeRoom();
  await room.fetch(upgrade());
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 1 }));
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 2 }));
  assert.equal(sockets[0].sent.at(-1).e, "slow");
  await room.webSocketMessage(sockets[0], "garbage");
  assert.equal(sockets[0].sent.at(-1).e, "bad_json");
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 999 }));
  assert.equal(sockets[0].sent.at(-1).e, "bad_song");
});

test("en tancar, els altres reben el nou recompte", async () => {
  const { room, sockets } = makeRoom();
  await room.fetch(upgrade()); await room.fetch(upgrade());
  await room.webSocketClose(sockets[1]);
  assert.deepEqual(sockets[0].sent.at(-1), { t: "n", n: 1 });
});

test("sala plena i petició sense WebSocket", async () => {
  const { room, sockets } = makeRoom();
  const r = await room.fetch({ url: "https://x/ws/es-cau", method: "GET", headers: { get: () => null } });
  assert.equal(r.status, 426);
  for (let i = 0; i < 80; i++) sockets.push(new FakeWS());
  const full = await room.fetch(upgrade());
  assert.equal(full.status, 503);
});

// ---------- Taules amb codi de 6 xifres ----------

test("taula: un codi que no s'ha creat es rebutja amb no_room i es tanca (4004)", async () => {
  const { room, sockets } = makeRoom();
  const r = await room.fetch(upgrade("471203"));
  assert.equal(r.status101, true);
  const server = lastPair[1];
  assert.deepEqual(server.sent, [{ t: "err", e: "no_room" }]);
  assert.equal(server.closed.code, 4004);
  assert.equal(sockets.length, 0);
});

test("taula: es crea, no es pot crear dues vegades, i s'hi pot entrar", async () => {
  const { room, sockets, ctx } = makeRoom();
  assert.equal((await init(room)).status, 201);
  assert.equal((await init(room)).status, 409);
  assert.ok(ctx.alarmAt > Date.now());
  await room.fetch(upgrade("471203"));
  const m = sockets[0].sent[0];
  assert.equal(m.t, "state"); assert.equal(m.init, true); assert.equal(m.open, true); assert.equal(m.host, false);
  assert.ok(m.exp > Date.now());
});

test("taula: qui té la clau és host; un nou client rep l'última cançó", async () => {
  const { room, sockets } = makeRoom();
  await init(room, true, "secret");
  await room.fetch(upgrade("471203", "secret"));
  assert.equal(sockets[0].sent[0].host, true);
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 7, who: "Xavi" }));
  await room.fetch(upgrade("471203", "dolenta"));
  const m = sockets[1].sent[0];
  assert.equal(m.host, false); assert.equal(m.song, 7); assert.equal(m.who, "Xavi");
});

test("taula només-host: els altres no poden enviar, el host sí", async () => {
  const { room, sockets, store } = makeRoom();
  await init(room, false, "secret");
  await room.fetch(upgrade("471203", "secret"));
  await room.fetch(upgrade("471203"));
  assert.equal(sockets[1].sent[0].open, false);
  await room.webSocketMessage(sockets[1], JSON.stringify({ t: "set", song: 5 }));
  assert.equal(sockets[1].sent.at(-1).e, "host_only");
  assert.equal(store.get("s"), undefined);
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 9 }));
  assert.equal(sockets[1].sent.at(-1).song, 9);
});

test("taula: caduca després de 2 h sense activitat i el codi es pot tornar a crear", async () => {
  const { room, sockets, store, ctx } = makeRoom();
  await init(room);
  await room.fetch(upgrade("471203"));
  // Encara no ha caducat: l'alarma es reprograma
  await room.alarm();
  assert.equal(sockets[0].readyState, 1);
  // Simulam 2 h sense activitat
  const meta = store.get("meta"); meta.last = Date.now() - ROOM_TTL_MS - 1; store.set("meta", meta);
  await room.alarm();
  assert.equal(sockets[0].closed.code, 4004);
  assert.equal(sockets[0].sent.at(-1).e, "no_room");
  assert.equal(store.size, 0);
  assert.equal((await init(room)).status, 201);
});

test("taula: enviar una cançó allarga la caducitat", async () => {
  const { room, sockets, store, ctx } = makeRoom();
  await init(room);
  await room.fetch(upgrade("471203"));
  const meta = store.get("meta"); meta.last = Date.now() - ROOM_TTL_MS + 60000; store.set("meta", meta);
  await room.webSocketMessage(sockets[0], JSON.stringify({ t: "set", song: 3 }));
  assert.ok(Date.now() - store.get("meta").last < 1000);
  assert.ok(ctx.alarmAt - Date.now() > ROOM_TTL_MS - 1000);
});

// ---------- Worker (entrada HTTP) ----------

const worker = (await import("../src/index.js")).default;
function makeEnv() {
  const rooms = new Map();
  return {
    ALLOWED_ORIGINS: "https://xavixep.github.io,https://*.canconer.pages.dev",
    rooms,
    ROOM: {
      idFromName: (n) => n,
      get: (n) => { if (!rooms.has(n)) rooms.set(n, makeRoom()); return { fetch: (req) => rooms.get(n).room.fetch(req) }; },
    },
  };
}
const ORIGIN = "https://xavixep.github.io";

test("worker: /create retorna un codi de 6 xifres i la clau, amb CORS", async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request("https://srv/create", { method: "POST", headers: { Origin: ORIGIN }, body: JSON.stringify({ open: false }) }), env);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const d = await res.json();
  assert.match(d.code, /^[1-9]\d{5}$/); assert.match(d.hostKey, /^[0-9a-f]{32}$/); assert.equal(d.open, false);
  assert.equal(env.rooms.get(d.code).store.get("meta").open, false);
});

test("worker: /create rebutja orígens no permesos i respon al preflight", async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(new Request("https://srv/create", { method: "POST", headers: { Origin: "https://evil.dev" } }), env)).status, 403);
  assert.equal((await worker.fetch(new Request("https://srv/create", { method: "POST" }), env)).status, 403);
  const pre = await worker.fetch(new Request("https://srv/create", { method: "OPTIONS", headers: { Origin: "https://taula-qr.canconer.pages.dev" } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "https://taula-qr.canconer.pages.dev");
  assert.equal((await worker.fetch(new Request("https://srv/create", { headers: { Origin: ORIGIN } }), env)).status, 405);
});

test("worker: /ws amb codi creat connecta; amb codi inventat diu no_room; codi invàlid 400", async () => {
  const env = makeEnv();
  const d = await (await worker.fetch(new Request("https://srv/create", { method: "POST", headers: { Origin: ORIGIN } }), env)).json();
  const ws = (code, k) => new Request(`https://srv/ws/${encodeURIComponent(code)}${k ? "?k=" + k : ""}`, { headers: { Origin: ORIGIN, Upgrade: "websocket" } });
  const ok = await worker.fetch(ws(d.code.slice(0, 3) + " " + d.code.slice(3), d.hostKey), env);
  assert.equal(ok.status101, true);
  const first = env.rooms.get(d.code).sockets[0].sent[0];
  assert.equal(first.t, "state"); assert.equal(first.host, true);
  const other = d.code === "999999" ? "999998" : "999999";
  await worker.fetch(ws(other), env);
  assert.equal(lastPair[1].closed.code, 4004);
  assert.equal((await worker.fetch(ws("12345"), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://srv/ws/" + d.code, { headers: { Origin: "https://evil.dev", Upgrade: "websocket" } }), env)).status, 403);
});
