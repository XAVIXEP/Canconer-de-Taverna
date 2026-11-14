import test from "node:test";
import assert from "node:assert/strict";
import { normRoom, cleanWho, parseClientMessage, applySet, stateMessage, originAllowed, isTableCode, tableCodeFrom, isExpired, ROOM_TTL_MS } from "../src/logic.js";

test("normRoom normalitza i valida", () => {
  assert.equal(normRoom("ES-CAU-MENORCA"), "es-cau-menorca");
  assert.equal(normRoom("  Es Cau  "), "es-cau");
  assert.equal(normRoom("Cançoner Ciutadella"), "canconer-ciutadella");
  assert.equal(normRoom("ab"), null);
  assert.equal(normRoom(""), null);
  assert.equal(normRoom(null), null);
  assert.equal(normRoom("a".repeat(41)), null);
  assert.equal(normRoom("---"), null);
});

test("cleanWho treu control i <>, talla a 24", () => {
  assert.equal(cleanWho("  Xavi<b>\n"), "Xavib");
  assert.equal(cleanWho("x".repeat(50)).length, 24);
  assert.equal(cleanWho(5), "");
});

test("parseClientMessage", () => {
  assert.deepEqual(parseClientMessage('{"t":"set","song":12,"who":"Anna","cid":"abc"}'),
    { ok: true, msg: { t: "set", song: 12, who: "Anna", cid: "abc" } });
  for (const bad of ['{"t":"set","song":0}', '{"t":"set","song":126}', '{"t":"set","song":"7"}',
    '{"t":"set","song":1.5}', '{"t":"x"}', "no json", "null"]) {
    assert.equal(parseClientMessage(bad).ok, false, bad);
  }
  assert.equal(parseClientMessage("x".repeat(600)).e, "too_big");
  assert.equal(parseClientMessage('{"t":"set","song":125}').ok, true);
  assert.equal(parseClientMessage('{"t":"set","song":1}').ok, true);
});

test("applySet incrementa seq", () => {
  const a = applySet(null, { song: 5, who: "", cid: "" }, 10);
  assert.equal(a.seq, 1);
  const b = applySet(a, { song: 6, who: "x", cid: "c" }, 20);
  assert.deepEqual(b, { song: 6, seq: 2, who: "x", cid: "c", at: 20 });
});

test("stateMessage", () => {
  assert.deepEqual(stateMessage(null, 1, true), { t: "state", init: true, song: null, seq: 0, who: "", cid: "", at: null, n: 1 });
  assert.equal(stateMessage({ song: 3, seq: 2, who: "a", cid: "c", at: 1 }, 4, false).song, 3);
});

test("originAllowed", () => {
  assert.equal(originAllowed("https://xavixep.github.io", "https://xavixep.github.io"), true);
  assert.equal(originAllowed("https://evil.com", "https://xavixep.github.io"), false);
  assert.equal(originAllowed(null, "https://xavixep.github.io"), false);
  assert.equal(originAllowed(null, "*"), true);
  assert.equal(originAllowed("http://localhost:8787", "https://a.io, http://localhost:8787"), true);
});

test("codis de taula de 6 xifres", () => {
  assert.equal(normRoom("471203"), "471203");
  assert.equal(normRoom(" 471 203 "), "471203");
  assert.equal(normRoom("471-203"), "471203");
  assert.equal(normRoom("012345"), null);     // no pot començar per 0
  assert.equal(normRoom("12345"), null);      // només xifres però no en són 6
  assert.equal(normRoom("1234567"), null);
  assert.equal(isTableCode("471203"), true);
  assert.equal(isTableCode("es-cau"), false);
  for (const r of [0, 1, 899999, 900000, 4294967295]) assert.equal(isTableCode(tableCodeFrom(r)), true);
});

test("caducitat", () => {
  assert.equal(isExpired(undefined, 0), true);
  assert.equal(isExpired({ last: 1000 }, 1000 + ROOM_TTL_MS - 1), false);
  assert.equal(isExpired({ last: 1000 }, 1000 + ROOM_TTL_MS), true);
});

test("originAllowed amb comodí de subdomini", () => {
  const list = "https://xavixep.github.io,https://canconer.pages.dev,https://*.canconer.pages.dev";
  assert.equal(originAllowed("https://taula-qr.canconer.pages.dev", list), true);
  assert.equal(originAllowed("https://canconer.pages.dev", list), true);
  assert.equal(originAllowed("https://xavixep.github.io", list), true);
  assert.equal(originAllowed("https://a.b.canconer.pages.dev", list), false);
  assert.equal(originAllowed("https://evil.dev/.canconer.pages.dev", list), false);
  assert.equal(originAllowed("http://taula-qr.canconer.pages.dev", list), false);
  assert.equal(originAllowed("https://xcanconer.pages.dev", list), false);
});
