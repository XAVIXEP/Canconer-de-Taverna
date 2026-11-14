// Servidor de la Taula del Cançoner de Taverna (Cloudflare Worker + Durable Object).
//
// Una taula és una sala amb un codi de 6 xifres. Algú la crea (POST /create) i la resta
// s'hi connecta per WebSocket (/ws/<codi>). Quan algú envia una cançó (1-125), tothom la rep.
// Una taula caduca després de 2 h sense activitat. No es guarda cap dada personal.

import {
  normRoom, isTableCode, tableCodeFrom, isExpired, parseClientMessage, applySet, stateMessage,
  originAllowed, MAX_SOCKETS, MIN_GAP_MS, ROOM_TTL_MS,
} from "./logic.js";

const OPEN = 1;            // WebSocket.OPEN
const CLOSE_NO_ROOM = 4004; // la taula no existeix o ha caducat

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Respon "ping" -> "pong" sense despertar l'objecte (no consumeix temps d'execució).
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Sockets oberts, opcionalment excloent-ne un (útil en tancar). */
  live(except) {
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === OPEN);
  }

  broadcast(text, except) {
    for (const w of this.live(except)) {
      try { w.send(text); } catch { /* socket ja tancat */ }
    }
  }

  /** Anota activitat i reprograma la caducitat. */
  async touch(meta, now) {
    meta.last = now;
    await this.ctx.storage.put("meta", meta);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Creació d'una taula (només la crida el Worker)
    if (url.pathname === "/init" && request.method === "POST") {
      const now = Date.now();
      const old = await this.ctx.storage.get("meta");
      if (!isExpired(old, now)) return new Response("ocupat", { status: 409 });
      const body = await request.json();
      await this.ctx.storage.deleteAll();
      await this.touch({ open: body.open !== false, hostKey: String(body.hostKey), created: now, last: now }, now);
      return new Response("creada", { status: 201 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Cal una connexió WebSocket", { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("Sala plena", { status: 503 });
    }

    const code = url.pathname.split("/").pop();
    const managed = isTableCode(code);     // taula amb codi de 6 xifres (les antigues no en tenen)
    const now = Date.now();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    let meta = null;
    if (managed) {
      meta = await this.ctx.storage.get("meta");
      if (isExpired(meta, now)) {
        // No existeix: s'accepta la connexió només per poder dir-ho, i es tanca.
        server.accept();
        server.send(JSON.stringify({ t: "err", e: "no_room" }));
        server.close(CLOSE_NO_ROOM, "no_room");
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    this.ctx.acceptWebSocket(server);          // API d'hibernació
    const host = managed && !!meta.hostKey && url.searchParams.get("k") === meta.hostKey;
    server.serializeAttachment({ last: 0, m: managed, host });
    if (managed) await this.touch(meta, now);

    const state = (await this.ctx.storage.get("s")) || null;
    const n = this.live().length;
    const extra = managed ? { open: meta.open, host, exp: meta.last + ROOM_TTL_MS } : undefined;
    server.send(JSON.stringify(stateMessage(state, n, true, extra)));
    this.broadcast(JSON.stringify({ t: "n", n }), server);   // avisa els altres que hi ha un més

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string") return;
    const parsed = parseClientMessage(data);
    if (!parsed.ok) { ws.send(JSON.stringify({ t: "err", e: parsed.e })); return; }

    const att = ws.deserializeAttachment() || { last: 0 };
    const now = Date.now();

    let meta = null;
    if (att.m) {
      meta = await this.ctx.storage.get("meta");
      if (isExpired(meta, now)) { ws.send(JSON.stringify({ t: "err", e: "no_room" })); ws.close(CLOSE_NO_ROOM, "no_room"); return; }
      if (!meta.open && !att.host) { ws.send(JSON.stringify({ t: "err", e: "host_only" })); return; }
    }

    if (now - att.last < MIN_GAP_MS) { ws.send(JSON.stringify({ t: "err", e: "slow" })); return; }
    ws.serializeAttachment({ ...att, last: now });

    const prev = (await this.ctx.storage.get("s")) || null;
    const next = applySet(prev, parsed.msg, now);
    await this.ctx.storage.put("s", next);
    if (meta) await this.touch(meta, now);
    this.broadcast(JSON.stringify(stateMessage(next, this.live().length, false)));
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "adéu"); } catch { /* ja tancat */ }
    this.broadcast(JSON.stringify({ t: "n", n: this.live(ws).length }), ws);
  }

  async webSocketError(ws) {
    this.broadcast(JSON.stringify({ t: "n", n: this.live(ws).length }), ws);
  }

  /** Caducitat: si fa 2 h que no hi ha activitat, s'esborra la taula i es tanca tothom. */
  async alarm() {
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return;
    const now = Date.now();
    if (!isExpired(meta, now)) { await this.ctx.storage.setAlarm(meta.last + ROOM_TTL_MS); return; }
    for (const w of this.ctx.getWebSockets()) {
      try { w.send(JSON.stringify({ t: "err", e: "no_room" })); w.close(CLOSE_NO_ROOM, "expired"); } catch { /* ja tancat */ }
    }
    await this.ctx.storage.deleteAll();
  }
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("Cançoner de Taverna · Taula en marxa\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // Crear una taula nova: retorna el codi de 6 xifres i la clau de qui l'ha creada
    if (url.pathname === "/create") {
      if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response("Origen no permès", { status: 403 });
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
      if (request.method !== "POST") return new Response("Mètode no permès", { status: 405, headers: cors(origin) });
      let body = {};
      try { body = await request.json(); } catch { /* sense cos: opcions per defecte */ }
      const open = !(body && body.open === false);
      const hostKey = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      for (let i = 0; i < 8; i++) {
        const code = tableCodeFrom(crypto.getRandomValues(new Uint32Array(1))[0]);
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request("https://room/init", {
          method: "POST", body: JSON.stringify({ open, hostKey }), headers: { "content-type": "application/json" },
        }));
        if (res.status === 201) return json({ code, hostKey, open, ttlMs: ROOM_TTL_MS }, 201, origin);
      }
      return json({ e: "busy" }, 503, origin);
    }

    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!m) return new Response("No trobat", { status: 404 });

    if (!originAllowed(origin, env.ALLOWED_ORIGINS)) {
      return new Response("Origen no permès", { status: 403 });
    }

    let raw = m[1];
    try { raw = decodeURIComponent(raw); } catch { /* es queda tal qual */ }
    const room = normRoom(raw);
    if (!room) return new Response("Codi de sala no vàlid", { status: 400 });

    // Es reenvia amb el codi ja normalitzat perquè la sala sàpiga quin tipus de taula és
    const fwd = new URL(request.url);
    fwd.pathname = "/ws/" + room;
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request(fwd, request));
  },
};
