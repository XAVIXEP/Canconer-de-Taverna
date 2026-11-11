// Servidor de la Taula del Cançoner de Taverna (Cloudflare Worker + Durable Object).
// Cada sala és un Durable Object. Els mòbils s'hi connecten per WebSocket i reben,
// en temps real, quina cançó (1-125) ha enviat algú. No es guarda cap dada personal.

import {
  normRoom, parseClientMessage, applySet, stateMessage, originAllowed,
  MAX_SOCKETS, MIN_GAP_MS,
} from "taula-server/src/index.js";

const OPEN = 1; // WebSocket.OPEN

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

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Cal una connexió WebSocket", { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("Sala plena", { status: 503 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);          // API d'hibernació
    server.serializeAttachment({ last: 0 });

    const state = (await this.ctx.storage.get("s")) || null;
    const n = this.live().length;
    server.send(JSON.stringify(stateMessage(state, n, true)));
    this.broadcast(JSON.stringify({ t: "n", n }), server);   // avisa els altres que hi ha un més

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string") return;
    const parsed = parseClientMessage(data);
    if (!parsed.ok) { ws.send(JSON.stringify({ t: "err", e: parsed.e })); return; }

    const att = ws.deserializeAttachment() || { last: 0 };
    const now = Date.now();
    if (now - att.last < MIN_GAP_MS) { ws.send(JSON.stringify({ t: "err", e: "slow" })); return; }
    ws.serializeAttachment({ last: now });

    const prev = (await this.ctx.storage.get("s")) || null;
    const next = applySet(prev, parsed.msg, now);
    await this.ctx.storage.put("s", next);
    this.broadcast(JSON.stringify(stateMessage(next, this.live().length, false)));
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "adéu"); } catch { /* ja tancat */ }
    this.broadcast(JSON.stringify({ t: "n", n: this.live(ws).length }), ws);
  }

  async webSocketError(ws) {
    this.broadcast(JSON.stringify({ t: "n", n: this.live(ws).length }), ws);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("Cançoner de Taverna · Taula en marxa\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!m) return new Response("No trobat", { status: 404 });

    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
      return new Response("Origen no permès", { status: 403 });
    }

    let raw = m[1];
    try { raw = decodeURIComponent(raw); } catch { /* es queda tal qual */ }
    const room = normRoom(raw);
    if (!room) return new Response("Codi de sala no vàlid", { status: 400 });

    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
  },
};
