// Taula: sala en línia on qui sap quina cançó sona l'envia a tothom.
//
// - Per entrar cal un nom i el codi de 6 xifres de la taula (o escanejar-ne el QR).
// - «Crea'n una» demana al servidor una taula nova; qui la crea decideix si tothom pot enviar.
// - Quan algú envia una cançó, surt un avís al mig de la pantalla amb el botó «Anar-hi».
//   Mai no es canvia de pàgina automàticament.
// Necessita js/app.js (goToPage, showToast, currentView) i js/vendor/qrcode.js.

// Adreça del servidor de la Taula (Cloudflare Worker). Buida = sense servidor.
const TAULA_SERVER_URL = "wss://canconer-de-taverna.xavixep4.workers.dev";
const TAULA_CLOSE_NO_ROOM = 4004;

const taula = {
  ws: null, status: 'off',        // 'off' | 'connecting' | 'on' | 'retry'
  code: null,                     // codi de la taula on som (o on intentam entrar)
  n: 0, open: true, host: false, lastSeq: 0,
  retry: 0, timer: null, ping: null, want: false,
  view: 'home',                   // vista del modal: 'home' | 'create' | 'room' | 'scan'
  error: '', busy: false,
  prompt: null,                   // cançó de l'avís central
};
const taulaCid = Math.random().toString(36).slice(2, 10);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
const $t = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function taulaUrl() { return (typeof window.__TAULA_URL__ === 'string' ? window.__TAULA_URL__ : TAULA_SERVER_URL).replace(/\/+$/, ''); }
function taulaHttpUrl() { return taulaUrl().replace(/^ws/, 'http'); }
function taulaWho() { return lsGet('taula_who', '').trim(); }
function normCode(raw) { const d = String(raw || '').replace(/[\s.-]/g, ''); return /^[1-9]\d{5}$/.test(d) ? d : null; }
function prettyCode(c) { return c ? c.slice(0, 3) + ' ' + c.slice(3) : ''; }
function taulaKeys() { try { return JSON.parse(lsGet('taula_keys', '{}')) || {}; } catch (e) { return {}; } }
function taulaJoinLink(code) { return `${location.origin}${location.pathname}?taula=${code || taula.code}`; }
function taulaCanSend() { return taula.status === 'on' && (taula.open || taula.host); }
function titleOfPage(p) { const it = FULL_INDEX.find(x => x.p === p); return it ? it.t : ''; }
/** Extreu un codi de taula d'un text escanejat: un enllaç amb ?taula=… o les 6 xifres soles. */
function codeFromScan(text) {
  const m = String(text || '').match(/[?&]taula=([\d\s.-]+)/);
  return normCode(m ? m[1] : text);
}

// ---------------------------------------------------------------- Pintar

function taulaPaint() {
  const colors = { off: '#78716c', connecting: '#f59e0b', on: '#22c55e', retry: '#f59e0b' };
  const dot = $t('navTableDot');
  if (dot) { dot.style.background = colors[taula.status]; dot.style.animation = (taula.status === 'connecting' || taula.status === 'retry') ? 'pulse 1.4s ease-in-out infinite' : ''; }
  const lab = $t('navTableLabel');
  if (lab) lab.textContent = taula.status === 'on' ? `Taula · ${taula.n}` : (taula.status === 'off' ? 'Taula' : 'Taula…');
  // El botó «Enviar aquesta pàgina» només es veu si som dins una taula i hi podem enviar
  const send = $t('btnSendPage');
  if (send) send.style.display = taulaCanSend() ? '' : 'none';
  if (!$t('tableModal').classList.contains('hidden')) taulaRenderModal();
}

function taulaRenderModal() {
  const body = $t('taulaBody');
  if (!body) return;
  // No es repinta mentre s'escriu en un camp de la mateixa vista (es perdria el focus)
  const keep = {};
  body.querySelectorAll('input[id]').forEach(i => { keep[i.id] = i.type === 'checkbox' ? i.checked : i.value; });
  const focusId = document.activeElement && body.contains(document.activeElement) ? document.activeElement.id : null;
  const prevView = body.dataset.view;

  const inRoom = taula.status === 'on' || (taula.want && taula.view === 'room');
  let view = taula.view;
  if (view !== 'scan') view = inRoom ? 'room' : (view === 'room' ? 'home' : view);
  taula.view = view;
  if (prevView === 'scan' && view !== 'scan') taulaStopScan();
  body.dataset.view = view;

  const noServer = !taulaUrl();
  const err = taula.error ? `<p class="tl-error" role="alert">${esc(taula.error)}</p>` : '';
  const nameField = `
    <label class="tl-label" for="tlName">El teu nom</label>
    <input id="tlName" class="tl-input" type="text" maxlength="24" autocomplete="nickname" placeholder="Com et diuen?" value="${esc(taulaWho())}">`;

  if (view === 'home') {
    body.innerHTML = `
      <h3 class="tl-title">Taula</h3>
      <p class="tl-sub">Entra a una taula i rebràs les cançons que hi enviïn.</p>
      ${noServer ? '<p class="tl-error">Aquesta còpia de la web no té servidor de Taula configurat.</p>' : ''}
      ${nameField}
      <label class="tl-label" for="tlCode">Codi de la taula</label>
      <div class="tl-row">
        <input id="tlCode" class="tl-input tl-code" type="text" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000 000" value="${esc(prettyCode(taula.code || ''))}">
        <button id="tlJoin" class="tl-btn tl-primary" onclick="taulaJoinFromForm()" ${noServer || taula.busy ? 'disabled' : ''}>${taula.busy ? 'Entrant…' : 'Entrar'}</button>
      </div>
      ${err}
      <button class="tl-btn tl-wide" onclick="taulaStartScan()" ${noServer ? 'disabled' : ''}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
        Escanejar un codi QR
      </button>
      <div class="tl-sep"></div>
      <p class="tl-create">No tens cap taula? <button class="tl-link" onclick="taulaShow('create')" ${noServer ? 'disabled' : ''}>Crea'n una!</button></p>`;
  } else if (view === 'create') {
    body.innerHTML = `
      <h3 class="tl-title">Crear una taula</h3>
      <p class="tl-sub">Et donarem un codi de 6 xifres i un QR perquè la resta hi entri.</p>
      ${nameField}
      <label class="tl-check">
        <input id="tlOpen" type="checkbox" checked>
        <span><strong>Tothom pot enviar cançons</strong><br><small>Si ho desmarques, només tu podràs enviar-ne.</small></span>
      </label>
      ${err}
      <button id="tlCreate" class="tl-btn tl-primary tl-wide" onclick="taulaCreateFromForm()" ${taula.busy ? 'disabled' : ''}>${taula.busy ? 'Creant…' : 'Crear taula'}</button>
      <button class="tl-link tl-back" onclick="taulaShow('home')">&larr; Tornar</button>`;
  } else if (view === 'scan') {
    if (prevView !== 'scan') {
      body.innerHTML = `
        <h3 class="tl-title">Escanejar el QR</h3>
        <p class="tl-sub">Apunta la càmera al codi QR de la taula.</p>
        <div class="tl-video"><video id="tlVideo" playsinline muted></video></div>
        <p id="tlScanMsg" class="tl-sub"></p>
        <button class="tl-link tl-back" onclick="taulaShow('home')">&larr; Tornar</button>`;
    }
    return;
  } else {   // room
    const on = taula.status === 'on';
    const people = on ? `${taula.n} ${taula.n === 1 ? 'connectat' : 'connectats'}` : 'Reconnectant…';
    body.innerHTML = `
      <p class="tl-kicker">Ets a la taula</p>
      <h3 class="tl-roomcode">${esc(prettyCode(taula.code))}</h3>
      <p class="tl-sub tl-center"><span class="tl-dot" style="background:${on ? '#22c55e' : '#f59e0b'}"></span>${people}${taula.host ? ' · l\'has creada tu' : ''}</p>
      <div class="tl-qr" id="tlQr" aria-label="Codi QR per entrar a la taula">${taulaQrSvg(taulaJoinLink())}</div>
      <p class="tl-sub tl-center">Escaneja'l amb la càmera per entrar-hi, o escriu el codi.</p>
      <button class="tl-btn tl-wide" onclick="taulaCopyLink()">Copiar l'enllaç de la taula</button>
      <div class="tl-sep"></div>
      ${taula.open || taula.host ? `
        <label class="tl-label" for="tlPage">Enviar una pàgina concreta</label>
        <div class="tl-row">
          <input id="tlPage" class="tl-input" type="number" inputmode="numeric" min="1" max="125" placeholder="Núm. de pàgina (1-125)">
          <button class="tl-btn tl-primary" onclick="taulaSendFromForm()" ${on ? '' : 'disabled'}>Enviar</button>
        </div>
        <p class="tl-hint">${taula.open ? 'Tothom pot enviar cançons en aquesta taula.' : 'Només tu pots enviar cançons en aquesta taula.'}</p>`
      : '<p class="tl-hint">En aquesta taula només envia cançons qui l\'ha creada.</p>'}
      ${err}
      <p class="tl-hint">Hi ets com a <strong>${esc(taulaWho())}</strong>. La taula es tanca després de 2 h sense activitat.</p>
      <button class="tl-btn tl-danger tl-wide" onclick="taulaLeave()">Sortir de la taula</button>`;
  }

  // Recupera el que s'estava escrivint
  if (prevView === view) {
    for (const [id, v] of Object.entries(keep)) {
      const el = $t(id); if (!el) continue;
      if (el.type === 'checkbox') el.checked = v; else el.value = v;
    }
    if (focusId && $t(focusId)) $t(focusId).focus();
  }
}

function taulaQrSvg(text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
  } catch (e) { return ''; }
}

function taulaShow(view) {
  taula.error = '';
  const name = $t('tlName'); if (name) lsSet('taula_who', name.value.trim().slice(0, 24));
  taula.view = view;
  taulaRenderModal();
}

function openTableModal() {
  taula.error = '';
  if (taula.view === 'scan') taula.view = 'home';
  $t('tableModal').classList.remove('hidden');
  taulaRenderModal();
}

function closeTableModal() {
  const name = $t('tlName'); if (name && name.value.trim()) lsSet('taula_who', name.value.trim().slice(0, 24));
  taulaStopScan();
  if (taula.view === 'scan') taula.view = 'home';
  $t('tableModal').classList.add('hidden');
}

// ---------------------------------------------------------------- Formularis

/** Llegeix el nom del formulari; si falta, ho diu i retorna null. */
function taulaReadName() {
  const el = $t('tlName');
  const name = (el ? el.value : taulaWho()).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  if (!name) { taula.error = 'Escriu el teu nom per entrar a la taula.'; taulaRenderModal(); if ($t('tlName')) $t('tlName').focus(); return null; }
  lsSet('taula_who', name);
  return name;
}

function taulaJoinFromForm() {
  taula.error = '';
  if (!taulaReadName()) return;
  const code = normCode($t('tlCode').value);
  if (!code) { taula.error = 'El codi de la taula són 6 xifres.'; taulaRenderModal(); $t('tlCode').focus(); return; }
  taulaJoin(code);
}

async function taulaCreateFromForm() {
  taula.error = '';
  if (!taulaReadName()) return;
  const open = $t('tlOpen').checked;
  taula.busy = true; taulaRenderModal();
  try {
    const res = await fetch(taulaHttpUrl() + '/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ open }) });
    if (!res.ok) throw new Error('http ' + res.status);
    const d = await res.json();
    const keys = taulaKeys(); keys[d.code] = d.hostKey;
    // Només es guarden les claus de les darreres taules creades
    const trimmed = Object.fromEntries(Object.entries(keys).slice(-5));
    lsSet('taula_keys', JSON.stringify(trimmed));
    taula.busy = false;
    taulaJoin(d.code);
  } catch (e) {
    taula.busy = false;
    taula.error = navigator.onLine === false ? 'No tens connexió. Per crear una taula cal internet.' : 'No s\'ha pogut crear la taula. Torna-ho a provar.';
    taulaRenderModal();
  }
}

function taulaSendFromForm() {
  const val = parseInt($t('tlPage').value, 10);
  if (!(val >= 1 && val <= 125)) { showToast('Escriu un número de pàgina entre 1 i 125.'); return; }
  $t('tlPage').value = '';
  closeTableModal();
  goToPage(val);
  sendPage(val);
}

function taulaCopyLink() {
  const link = taulaJoinLink();
  const done = () => showToast('Enllaç de la taula copiat.');
  const fallback = () => {
    const temp = document.createElement('textarea');
    temp.value = link; document.body.appendChild(temp); temp.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(temp); done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, fallback);
  else fallback();
}

// ---------------------------------------------------------------- Connexió

function taulaClearTimers() { clearTimeout(taula.timer); clearInterval(taula.ping); taula.timer = null; taula.ping = null; }

/** Entra a una taula (o hi torna). */
function taulaJoin(code) {
  if (taula.ws) taulaDrop();
  taula.code = code; taula.want = true; taula.retry = 0; taula.lastSeq = 0; taula.error = ''; taula.busy = true;
  taulaConnect();
}

function taulaConnect() {
  const base = taulaUrl();
  if (!base || !taula.code) { taulaPaint(); return; }
  if (taula.ws && taula.ws.readyState <= 1) { taulaPaint(); return; }
  taulaClearTimers();
  taula.status = taula.retry ? 'retry' : 'connecting'; taulaPaint();
  const key = taulaKeys()[taula.code];
  let ws;
  try { ws = new WebSocket(`${base}/ws/${taula.code}${key ? '?k=' + encodeURIComponent(key) : ''}`); }
  catch (e) { taulaScheduleRetry(); return; }
  taula.ws = ws;
  ws.onopen = () => {
    taula.ping = setInterval(() => { try { if (ws.readyState === 1) ws.send('ping'); } catch (e) {} }, 30000);
  };
  ws.onmessage = (ev) => { if (taula.ws === ws && ev.data !== 'pong') taulaOnMessage(ev.data); };
  ws.onclose = (ev) => {
    if (taula.ws !== ws) return;
    taulaClearTimers(); taula.ws = null;
    if (ev.code === TAULA_CLOSE_NO_ROOM) { taulaGone(); return; }
    if (taula.want) taulaScheduleRetry(); else { taula.status = 'off'; taulaPaint(); }
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function taulaScheduleRetry() {
  // Si encara no havíem aconseguit entrar-hi mai, no s'insisteix per sempre
  if (taula.busy && taula.retry >= 3) {
    taulaDrop(); taula.want = false; taula.busy = false; taula.status = 'off';
    taula.error = 'No s\'ha pogut connectar amb la taula. Comprova la connexió i torna-ho a provar.';
    taulaPaint(); return;
  }
  taula.status = 'retry'; taulaPaint();
  const wait = Math.min(15000, 1000 * Math.pow(2, taula.retry++)) + Math.random() * 500;
  taula.timer = setTimeout(taulaConnect, wait);
}

/** Tanca la connexió sense tocar res més. */
function taulaDrop() {
  taulaClearTimers();
  const ws = taula.ws; taula.ws = null;
  if (ws) { try { ws.close(); } catch (e) {} }
}

/** La taula no existeix o ha caducat. */
function taulaGone() {
  const wasIn = !taula.busy;      // ja hi érem (o hi tornàvem); si no, és un codi acabat d'escriure
  taulaDrop();
  taula.want = false; taula.busy = false; taula.status = 'off'; taula.n = 0; taula.view = 'home';
  lsSet('taula_on', '0');
  taula.error = wasIn ? `La taula ${prettyCode(taula.code)} s'ha tancat.` : `La taula ${prettyCode(taula.code)} no existeix o ja s'ha tancat. Comprova el codi.`;
  if (wasIn) { showToast(taula.error); taula.code = null; lsDel('taula_room'); }
  taulaHidePrompt();
  taulaPaint();
}

function taulaLeave() {
  taulaDrop();
  taula.want = false; taula.busy = false; taula.status = 'off'; taula.n = 0; taula.code = null; taula.view = 'home'; taula.error = '';
  lsSet('taula_on', '0'); lsDel('taula_room');
  taulaHidePrompt();
  taulaPaint();
  showToast('Has sortit de la taula.');
}

function taulaOnMessage(text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m.t === 'n') { taula.n = m.n; taulaPaint(); return; }
  if (m.t === 'err') {
    if (m.e === 'slow') showToast('Massa de pressa: espera un segon abans d\'enviar una altra cançó.');
    else if (m.e === 'host_only') showToast('En aquesta taula només envia cançons qui l\'ha creada.');
    return;   // 'no_room' arriba també com a tancament 4004
  }
  if (m.t !== 'state') return;
  taula.n = m.n;
  if (m.init) {
    // Hem entrat (o hi hem tornat)
    const first = taula.busy;
    taula.status = 'on'; taula.retry = 0; taula.busy = false; taula.error = '';
    taula.open = m.open !== false; taula.host = !!m.host;
    lsSet('taula_room', taula.code); lsSet('taula_on', '1');
    if (first) { taula.view = 'room'; showToast(`Ets a la taula ${prettyCode(taula.code)}.`); }
  }
  taulaPaint();
  if (!m.song || m.seq === taula.lastSeq) return;
  taula.lastSeq = m.seq;
  // Cada enviament només s'avisa una vegada, encara que es recarregui la pàgina
  const mark = `${taula.code}:${m.seq}:${m.at || ''}`;
  if (lsGet('taula_seen', '') === mark) return;
  lsSet('taula_seen', mark);
  if (m.cid === taulaCid && !m.init) return;            // eco del que he enviat jo
  if (currentView === m.song) { if (!m.init) showToast(`Ara sona aquesta cançó${m.who ? ' (' + m.who + ')' : ''}.`); return; }
  taulaShowPrompt(m.song, m.who);
}

// ---------------------------------------------------------------- Avís central

function taulaShowPrompt(song, who) {
  taula.prompt = song;
  const t = titleOfPage(song);
  $t('taulaPromptPage').textContent = `Pàg. ${song}`;
  $t('taulaPromptTitle').textContent = t || '';
  $t('taulaPromptWho').textContent = who ? `L'ha enviada ${who}` : '';
  $t('taulaPrompt').classList.remove('hidden');
}
function taulaHidePrompt() { taula.prompt = null; $t('taulaPrompt').classList.add('hidden'); }
function taulaPromptGo() {
  const song = taula.prompt;
  taulaHidePrompt();
  if (song) { closeTableModal(); goToPage(song); }
}

// ---------------------------------------------------------------- Enviar

function sendPage(p) {
  if (!Number.isInteger(p) || p < 1 || p > 125) { showToast('Obre primer una cançó (pàgina 1-125) per poder-la enviar.'); return; }
  if (!taula.ws || taula.ws.readyState !== 1 || taula.status !== 'on') { showToast('No estàs connectat a cap taula.'); openTableModal(); return; }
  if (!taulaCanSend()) { showToast('En aquesta taula només envia cançons qui l\'ha creada.'); return; }
  const t = titleOfPage(p);
  taula.ws.send(JSON.stringify({ t: 'set', song: p, who: taulaWho(), cid: taulaCid }));
  showToast(`Enviada a la taula: pàg. ${p}${t ? ' · ' + t : ''}`);
}

function broadcastCurrentPage() {
  sendPage(typeof currentView === 'number' ? currentView : NaN);
}

// ---------------------------------------------------------------- Escàner de QR

const scan = { stream: null, raf: 0, canvas: null, busy: false };

function taulaLoadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/jsQR.js'; s.onload = resolve; s.onerror = () => reject(new Error('jsQR'));
    document.head.appendChild(s);
  });
}

async function taulaStartScan() {
  const name = $t('tlName'); if (name) lsSet('taula_who', name.value.trim().slice(0, 24));
  taula.error = ''; taula.view = 'scan';
  taulaRenderModal();
  const msg = (t) => { const el = $t('tlScanMsg'); if (el) el.textContent = t; };
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    msg('Obrint la càmera…');
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
      taulaLoadJsQR(),
    ]);
    if (taula.view !== 'scan') { stream.getTracks().forEach(t => t.stop()); return; }
    scan.stream = stream;
    const video = $t('tlVideo');
    video.srcObject = stream;
    await video.play();
    msg('');
    scan.canvas = scan.canvas || document.createElement('canvas');
    const tick = () => {
      if (taula.view !== 'scan' || !scan.stream) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
        scan.canvas.width = w; scan.canvas.height = h;
        const ctx = scan.canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const found = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (found && found.data) {
          const code = codeFromScan(found.data);
          if (code) { taulaScanned(code); return; }
          msg('Aquest QR no és d\'una taula del Cançoner.');
        }
      }
      scan.raf = requestAnimationFrame(tick);
    };
    scan.raf = requestAnimationFrame(tick);
  } catch (e) {
    taulaStopScan();
    taula.view = 'home';
    taula.error = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
      ? 'No hi ha permís per fer servir la càmera. Pots escanejar el QR amb la càmera del mòbil o escriure el codi.'
      : 'No s\'ha pogut obrir la càmera. Pots escanejar el QR amb la càmera del mòbil o escriure el codi.';
    taulaRenderModal();
  }
}

function taulaStopScan() {
  cancelAnimationFrame(scan.raf);
  if (scan.stream) { scan.stream.getTracks().forEach(t => t.stop()); scan.stream = null; }
}

function taulaScanned(code) {
  taulaStopScan();
  taula.view = 'home'; taula.code = code; taula.error = '';
  taulaRenderModal();
  if (taulaWho()) taulaJoin(code);
  else { taula.error = 'Codi llegit. Escriu el teu nom i prem Entrar.'; taulaRenderModal(); if ($t('tlName')) $t('tlName').focus(); }
}

// ---------------------------------------------------------------- Arrencada

function taulaInit() {
  const fromLink = normCode(new URLSearchParams(location.search).get('taula'));
  if (fromLink) {
    // Es lleva el codi de l'adreça perquè recarregar no torni a entrar a una taula d'on has sortit
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    taula.code = fromLink;
    if (taulaUrl() && taulaWho()) taulaJoin(fromLink);
    else openTableModal();        // falta el nom: es demana amb el codi ja posat
  } else {
    const saved = normCode(lsGet('taula_room', ''));
    if (taulaUrl() && saved && taulaWho() && lsGet('taula_on', '0') === '1') {
      taula.code = saved; taula.want = true; taula.view = 'room';
      taulaConnect();
    }
  }
  taulaPaint();
  const wake = () => { if (taula.want && (!taula.ws || taula.ws.readyState > 1)) { taula.retry = 0; taulaConnect(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  window.addEventListener('online', wake);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target || !e.target.id) return;
    if (e.target.id === 'tlCode' || (e.target.id === 'tlName' && taula.view === 'home')) taulaJoinFromForm();
    else if (e.target.id === 'tlName' && taula.view === 'create') taulaCreateFromForm();
    else if (e.target.id === 'tlPage') taulaSendFromForm();
  });
}

window.openTableModal = openTableModal;
window.closeTableModal = closeTableModal;
window.broadcastCurrentPage = broadcastCurrentPage;
window.taulaShow = taulaShow;
window.taulaJoinFromForm = taulaJoinFromForm;
window.taulaCreateFromForm = taulaCreateFromForm;
window.taulaSendFromForm = taulaSendFromForm;
window.taulaCopyLink = taulaCopyLink;
window.taulaStartScan = taulaStartScan;
window.taulaLeave = taulaLeave;
window.taulaPromptGo = taulaPromptGo;
window.taulaHidePrompt = taulaHidePrompt;
window.__taula = taula;

taulaInit();
