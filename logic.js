// Lògica pura de la Taula: sense dependències de Cloudflare, per poder-la provar amb Node.

export const MAX_SONG = 125;        // el cançoner té 125 cançons
export const MAX_SOCKETS = 80;      // connexions simultànies per sala
export const MIN_GAP_MS = 800;      // temps mínim entre dos enviaments d'un mateix mòbil
export const MAX_MSG_BYTES = 512;   // mida màxima d'un missatge del client

/** Normalitza el codi de sala: minúscules, sense accents, a-z 0-9 i guions. Retorna null si no és vàlid. */
export function normRoom(raw) {
  if (typeof raw !== "string") return null;
  const s = raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(s) ? s : null;
}

/** Nom de qui envia: sense caràcters de control i com a màxim 24 caràcters. */
export function cleanWho(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 24);
}

/** Valida un missatge del client. Retorna {ok:true, msg} o {ok:false, e}. */
export function parseClientMessage(text) {
  if (typeof text !== "string" || text.length > MAX_MSG_BYTES) return { ok: false, e: "too_big" };
  let m;
  try { m = JSON.parse(text); } catch { return { ok: false, e: "bad_json" }; }
  if (!m || typeof m !== "object") return { ok: false, e: "bad_msg" };
  if (m.t === "set") {
    const song = m.song;
    if (!Number.isInteger(song) || song < 1 || song > MAX_SONG) return { ok: false, e: "bad_song" };
    return { ok: true, msg: { t: "set", song, who: cleanWho(m.who), cid: typeof m.cid === "string" ? m.cid.slice(0, 24) : "" } };
  }
  return { ok: false, e: "unknown" };
}

/** Aplica un "set" a l'estat anterior i retorna el nou estat. */
export function applySet(prev, msg, now) {
  return { song: msg.song, seq: ((prev && prev.seq) || 0) + 1, who: msg.who, cid: msg.cid, at: now };
}

/** Construeix el missatge d'estat que s'envia als clients. `init` = true en connectar. */
export function stateMessage(state, n, init) {
  return {
    t: "state",
    init: !!init,
    song: state ? state.song : null,
    seq: state ? state.seq : 0,
    who: state ? state.who : "",
    cid: state ? state.cid : "",
    at: state ? state.at : null,
    n,
  };
}

/** Comprova l'origen (capçalera Origin) contra una llista separada per comes. "*" = tot permès. */
export function originAllowed(origin, allowedCsv) {
  const list = String(allowedCsv || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (list.includes("*")) return true;
  if (!origin) return false;
  return list.includes(origin);
}
