// Lògica pura de la Taula: sense dependències de Cloudflare, per poder-la provar amb Node.

export const MAX_SONG = 125;        // el cançoner té 125 cançons
export const MAX_SOCKETS = 80;      // connexions simultànies per sala
export const MIN_GAP_MS = 800;      // temps mínim entre dos enviaments d'un mateix mòbil
export const MAX_MSG_BYTES = 512;   // mida màxima d'un missatge del client
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;   // una taula caduca després de 2 h sense activitat

/** Un codi de taula és un número de 6 xifres (100000-999999). */
export function isTableCode(code) {
  return typeof code === "string" && /^[1-9]\d{5}$/.test(code);
}

/** Genera un codi de taula a partir d'un enter aleatori de 32 bits. */
export function tableCodeFrom(rand32) {
  return String(100000 + (rand32 >>> 0) % 900000);
}

/** Una taula està caducada si fa més de ROOM_TTL_MS de la darrera activitat. */
export function isExpired(meta, now) {
  return !meta || now - meta.last >= ROOM_TTL_MS;
}

/** Normalitza el codi de sala: minúscules, sense accents, a-z 0-9 i guions. Retorna null si no és vàlid. */
export function normRoom(raw) {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s.-]/g, "");
  if (isTableCode(digits)) return digits;
  const s = raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Codis antics amb lletres (p. ex. "es-cau"): es mantenen mentre hi hagi mòbils amb la versió anterior.
  // Un codi només de xifres ha de ser un codi de taula vàlid.
  if (!/[a-z]/.test(s)) return null;
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

/** Construeix el missatge d'estat que s'envia als clients. `init` = true en connectar.
 *  `extra` afegeix camps propis de les taules amb codi (open, host, exp). */
export function stateMessage(state, n, init, extra) {
  return {
    ...(extra || {}),
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

/** Comprova l'origen (capçalera Origin) contra una llista separada per comes.
 *  "*" = tot permès. "https://*.exemple.dev" = qualsevol subdomini d'exemple.dev. */
export function originAllowed(origin, allowedCsv) {
  const list = String(allowedCsv || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (list.includes("*")) return true;
  if (!origin) return false;
  return list.some((p) => {
    if (p === origin) return true;
    const i = p.indexOf("://*.");
    if (i < 0) return false;
    const scheme = p.slice(0, i + 3), suffix = p.slice(i + 4);     // "https://", ".exemple.dev"
    if (!origin.startsWith(scheme) || !origin.endsWith(suffix)) return false;
    const sub = origin.slice(scheme.length, origin.length - suffix.length);
    return /^[a-z0-9-]+$/i.test(sub);
  });
}
