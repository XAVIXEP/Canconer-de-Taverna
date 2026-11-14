// Lògica de l'aplicació: lector, cercador, acords, mida de lletra i Taula.
// Necessita js/canconer-data.js carregat abans.

const COVER_IMG = "img/portada-coberta.jpg";
const ACORDS_IMG = "img/acords.jpg";
let cachedCoverDataUrl = null;
let customCoverIllustrationUrl = localStorage.getItem('canconer_cover_img') || null;

// Estat global de l'aplicació
let currentView = 0; // 0 = Portada, 'index', 'proleg', 'presentacio', 'acords', 'convencions', o número 1..125
let showChords = true;
let isFacsimil = false;
try { isFacsimil = localStorage.getItem('canconer_facsimil') === '1'; } catch (e) {}
let activeIndexCategoryFilter = null;
// Les funcions de la Taula (connexió en viu) són a js/taula.js.

/* =========================================================================
   FORMATADOR DE LLETRA I ACORDS EN SUPERÍNDEX
   ========================================================================= */
// Un grup entre parèntesis és d'acords si tots els seus elements ho són:
// (la), (DO7 x4), (sol - DO7), (MI7 - la&emsp;&emsp;FA)...
const CHORD_TOKEN = /^(?:(?:DO|RE|MI|FA|SOL|LA|SI|do|re|mi|fa|sol|la|si)(?:#|b)?(?:7|m|dis[123])?|dis[123]|x\d+)$/;
const OLD_CHORD_GROUP = /^(DO#?7?|do#?|RE7?|re|MIb?7?|mi|FA#?7?|fa#?|SOL#?7?|sol#?|LA7?|la|SIb?7?|si|dis[123]|[A-Z0-9#/\s-]+)$/;
// Un acord subratllat al Cançoner («tocar només les cordes de dalt a baix una sola vegada»)
// s'escriu amb un _ davant: (_la), (LA - _MI7 - LA).
const UL_MARK = /(^|[\s;(-])_(?=[A-Za-z])/g;
function chordUnderlines(inner) {
  return inner.replace(/(^|[\s;-])_([^\s;&-]+)/g, '$1<u class="chord-ul">$2</u>');
}
function isChordGroup(inner) {
  inner = inner.replace(UL_MARK, '$1');
  if (OLD_CHORD_GROUP.test(inner)) return true;
  const toks = inner.split(/\s*(?:&emsp;|-|\s)\s*/).filter(Boolean);
  return toks.length > 0 && toks.every(t => CHORD_TOKEN.test(t));
}

function formatLyricLine(line) {
  return line
    .replace(/\{([^}]+)\}/g, '<em class="font-serif-title italic" style="font-size:0.95em">$1</em>')
    .replace(/\[_?([^\]]+)\]/g, '<span class="chord">($1)</span>')
    .replace(/\(([^()]{1,120})\)/g, (m, inner) => isChordGroup(inner) ? `<span class="chord">(${chordUnderlines(inner)})</span>` : m);
}

function formatLyrics(text) {
  if (!text) return "";
  if (text.trim() === "***") {
    return `<div class="text-center tracking-[0.75em] my-2 text-[#4a3b2c]">* * *</div>`;
  }
  // Cada vers és un bloc (.vl). Si una línia només té acords, s'amaga sencera quan es lleven els acords.
  // fitLyrics() redueix la lletra perquè cada vers càpiga en una sola línia.
  const lines = text.split('\n');
  return lines.map(line => {
    const html = formatLyricLine(line);
    if (!html.trim()) return '<div class="vl vl-empty"></div>';
    const rest = html.replace(/<span class="chord">.*?<\/span>/g, '').trim();
    const cls = rest ? 'vl' : 'vl chord-only-line';
    return `<div class="${cls}"><span class="vt">${html}</span></div>`;
  }).join('');
}

/* =========================================================================
   VISTES DE PORTADA, ÍNDEX I CANÇONS + RENDER PRINCIPAL
   ========================================================================= */
function renderCoverHTML() {
  return `
    <div class="w-full">
      <div class="cover-frame"><img src="${COVER_IMG}" alt="Portada del Cançoner de Taverna: havaneres, ranxeres, boleros i altres cançons d'avui i de sempre" class="cover-img"></div>
      <button onclick="goToPage('index')" class="cover-open">Obrir el cançoner</button>
      <button onclick="goToPage('proleg')" class="cover-link">Pròleg (V) &rsaquo;</button>
    </div>
  `;
}

function filterByCategory(catId) {
  if (activeIndexCategoryFilter === catId) {
    activeIndexCategoryFilter = null;
  } else {
    activeIndexCategoryFilter = catId;
  }
  render();
}

function renderIndexHTML() {
  const filtered = activeIndexCategoryFilter
    ? FULL_INDEX.filter(s => s.cats.includes(activeIndexCategoryFilter))
    : FULL_INDEX;

  const half = Math.ceil(filtered.length / 2);
  const col1 = filtered.slice(0, half);
  const col2 = filtered.slice(half);

  const renderItem = (item) => {
    const catObj = SONG_CATEGORIES[item.cat] || SONG_CATEGORIES.desempre;
    return `
      <div onclick="goToPage(${item.p})" class="group flex items-baseline gap-2 py-0.5 cursor-pointer hover:bg-black/5 px-1.5 rounded transition">
        ${catDotsHTML(item.cats, "self-center")}
        <span class="font-bold text-[#2b2118] w-7 text-right text-xs sm:text-sm shrink-0">${item.p}.</span>
        <span class="uppercase tracking-wide text-xs sm:text-[0.86rem] text-[#17120e] group-hover:text-[#7c3711] group-hover:font-semibold truncate">${item.t}</span>
      </div>
    `;
  };

  return `
    <div class="flex-1 flex flex-col justify-between">
      <div>
        <div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h1 class="font-serif-title italic font-bold text-[2.8rem] sm:text-[3.2rem] text-[#17120e] leading-none">
            Índex
          </h1>
          ${activeIndexCategoryFilter ? `
            <button onclick="filterByCategory(null)" class="text-xs font-sans px-2.5 py-1 rounded bg-[#2b2118] text-[#f3e6be] hover:bg-black transition">
              Mostrant: ${SONG_CATEGORIES[activeIndexCategoryFilter].label} (Veure totes ✕)
            </button>
          ` : ''}
        </div>

        <!-- Preliminars en nombres romans com al Cançoner -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5 pb-3 border-b border-[#baa279]/60 text-xs sm:text-sm font-lyrics">
          <div onclick="goToPage('proleg')" class="cursor-pointer hover:text-[#7c3711] font-semibold"><strong>V.</strong> PRÒLEG</div>
          <div onclick="goToPage('presentacio')" class="cursor-pointer hover:text-[#7c3711] font-semibold"><strong>VII.</strong> PRESENTACIÓ</div>
          <div onclick="goToPage('acords')" class="cursor-pointer hover:text-[#7c3711] font-semibold"><strong>IX.</strong> ELS ACORDS</div>
          <div onclick="goToPage('convencions')" class="cursor-pointer hover:text-[#7c3711] font-semibold"><strong>X.</strong> CONVENCIONS</div>
        </div>

        <!-- Llegenda de colors (toca un color per filtrar) -->
        <div class="mb-5 pb-3 border-b border-[#baa279]/60 font-lyrics text-xs sm:text-sm text-[#2b2118]">
        <div class="flex flex-wrap items-center" style="column-gap:1.1rem;row-gap:0.45rem">
          ${Object.values(SONG_CATEGORIES).map(cat => `
            <button onclick="filterByCategory('${cat.id}')" class="flex items-center gap-1.5 hover:underline cursor-pointer ${activeIndexCategoryFilter === cat.id ? 'font-bold underline' : ''}">
              <span class="cat-dot" style="background-color: ${cat.color}"></span>
              <span>${cat.label}${cat.sup ? `<sup>${cat.sup}</sup>` : ''}</span>
            </button>
          `).join('')}
        </div>
        </div>

        <!-- Llistat en 2 columnes -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0.5 font-lyrics">
          <div>${col1.map(renderItem).join('')}</div>
          <div>${col2.map(renderItem).join('')}</div>
        </div>
      </div>

      <!-- Notes de la llegenda -->
      <div class="mt-8 pt-4 border-t border-[#baa279]/60 font-lyrics text-xs sm:text-sm text-[#2b2118]">
        <div class="text-[11px] text-[#4a3b2c] leading-snug space-y-0.5 pt-1">
          <p><sup>1</sup> Cançons que a Menorca s'han adoptat com a pròpies més enllà de la procedència de l'autor.</p>
          <p><sup>2</sup> Cançons de procedència mexicana o amb una estructura musical semblant.</p>
        </div>
        <p class="feedback-line feedback-paper">Ens ajudes a millorar-lo? <button onclick="openFeedback()" class="feedback-link">Dona'ns la teva opinió</button></p>
      </div>
    </div>
  `;
}

function renderSongPageHTML(pageNum) {
  const songMeta = FULL_INDEX.find(s => s.p === pageNum) || FULL_INDEX[0];
  const songData = TRANSCRIBED_SONGS[pageNum];
  const prevSong = pageNum > 1 ? FULL_INDEX.find(s => s.p === pageNum - 1) : null;
  const nextSong = pageNum < 125 ? FULL_INDEX.find(s => s.p === pageNum + 1) : null;

  let bodyContent = "";
  if (songData && songData.stanzas) {
    bodyContent = `
      ${songData.intro ? `<div class="chord-only-line font-lyrics italic font-semibold text-base text-[#2b2118] mb-3">${songData.intro.replace(/\(([^()]{1,200})\)/g, (m, inner) => isChordGroup(inner) ? `(${chordUnderlines(inner)})` : m)}</div>` : ''}
      <div class="lyrics-container song-lyrics space-y-5">
        ${songData.stanzas.map(st => `<div class="stanza">${formatLyrics(st)}</div>`).join('')}
      </div>
      ${songData.footnote ? `<div class="mt-8 pt-3 border-t border-[#baa279]/40 text-sm text-[#4a3b2c] font-lyrics italic">${songData.footnote}</div>` : ''}
    `;
  } else {
    bodyContent = `<div class="lyrics-container space-y-5">${renderFallbackSongStanzas(songMeta)}</div>`;
  }

  return `
    <div class="flex-1 flex flex-col justify-between">
      <div>
        <!-- Capçalera amb Títol i Autor -->
        <div class="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 mb-3">
          <h1 class="font-serif-title italic font-bold text-[2.4rem] sm:text-[2.9rem] text-[#17120e] leading-none">
            ${songMeta.t}
          </h1>
          <span class="font-serif-title italic text-base sm:text-lg text-[#2b2118] sm:text-right">
            ${songMeta.auth}
          </span>
        </div>

        <!-- Bloc RITME i TO -->
        <div class="mb-6 font-serif-title text-xs sm:text-sm font-bold tracking-wider uppercase text-[#1f1812] leading-snug">
          <div>RITME: <span class="normal-case font-semibold">${songMeta.r}</span></div>
          <div>TO: <span class="normal-case font-semibold">${songMeta.to}</span></div>
        </div>

        ${bodyContent}
      </div>

      <!-- Peu de pàgina amb navegació Anterior / Número / Següent -->
      <div class="pt-4 mt-10 border-t border-[#baa279]/50 flex items-center justify-between text-base sm:text-lg font-serif-title italic text-[#4a3b2c]">
        ${prevSong
          ? `<button onclick="goToPage(${prevSong.p})" class="hover:text-black transition truncate max-w-[42%] text-left">&lsaquo; ${prevSong.t}</button>`
          : `<button onclick="goToPage('index')" class="hover:text-black transition">&lsaquo; Índex</button>`}
        <span class="not-italic font-bold text-[#17120e] px-2">${songMeta.p}</span>
        ${nextSong
          ? `<button onclick="goToPage(${nextSong.p})" class="hover:text-black transition truncate max-w-[42%] text-right">${nextSong.t} &rsaquo;</button>`
          : `<button onclick="goToPage('index')" class="hover:text-black transition">Índex &rsaquo;</button>`}
      </div>
    </div>
  `;
}

/* =========================================================================
   MODE FACSÍMIL: les pàgines escanejades del cançoner original
   ========================================================================= */
// Pàgines del PDF escanejat (img/facsimil/pNNN.webp) per a cada vista.
// La cançó n és a la pàgina n+5 del PDF; el Popurri (125) ocupa de la 130 a la 137.
// El Pròleg i la Presentació no són a l'escanejat.
function facsimilPages(view) {
  if (view === 0) return [1];
  if (view === 'index') return [2, 3];
  if (view === 'acords') return [4];
  if (view === 'convencions') return [5];
  if (view === 125) return [130, 131, 132, 133, 134, 135, 136, 137];
  if (typeof view === 'number' && view >= 1 && view <= 124) return [view + 5];
  return [];
}
const facsimilSrc = (n) => `img/facsimil/p${String(n).padStart(3, '0')}.webp`;

function renderFacsimilHTML(view) {
  const pages = facsimilPages(view);
  if (!pages.length) return null;
  const meta = typeof view === 'number' ? FULL_INDEX.find(s => s.p === view) : null;
  const imgs = pages.map((n, i) => `
    <img class="facsimil-img" src="${facsimilSrc(n)}" alt="${meta ? 'Pàgina ' + view + ' del cançoner original: ' + meta.t : 'Pàgina original del cançoner'}${pages.length > 1 ? ' (' + (i + 1) + '/' + pages.length + ')' : ''}"
         ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"
         onerror="facsimilFail(this)">`).join('');
  let nav = '';
  if (typeof view === 'number') {
    const idx = FULL_INDEX.findIndex(s => s.p === view);
    const prev = FULL_INDEX[idx - 1], next = FULL_INDEX[idx + 1];
    nav = `
      <div class="facsimil-nav font-serif-title italic">
        ${prev ? `<button onclick="goToPage(${prev.p})">&lsaquo; ${prev.t}</button>` : `<button onclick="goToPage('index')">&lsaquo; Índex</button>`}
        <span class="not-italic font-bold">${view}</span>
        ${next ? `<button onclick="goToPage(${next.p})">${next.t} &rsaquo;</button>` : `<button onclick="goToPage('index')">Índex &rsaquo;</button>`}
      </div>`;
  }
  return `<div class="facsimil-pages">${imgs}</div>${nav}`;
}

function facsimilFail(img) {
  const p = document.createElement('p');
  p.className = 'facsimil-missing';
  p.textContent = navigator.onLine === false
    ? "Aquesta pàgina escanejada encara no està desada al mòbil. Obre-la un cop amb internet i després es veurà sense connexió."
    : "No s'ha pogut carregar la pàgina escanejada.";
  img.replaceWith(p);
}
window.facsimilFail = facsimilFail;

// Precarrega la pàgina escanejada següent perquè passar de cançó sigui immediat
function facsimilPreloadNext(view) {
  if (typeof view !== 'number' || view >= 125) return;
  const next = facsimilPages(view + 1)[0];
  if (next) { const im = new Image(); im.decoding = 'async'; im.src = facsimilSrc(next); }
}

function handleCoverImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    customCoverIllustrationUrl = e.target.result;
    try { localStorage.setItem('canconer_cover_img', customCoverIllustrationUrl); } catch(err) {}
    render();
    showToast("Imatge de portada actualitzada!");
  };
  reader.readAsDataURL(file);
}

/* Mida de la lletra:
   - 'fit' (Ajustada): cada vers sempre en una sola línia, com al cançoner; la lletra es redueix el que calgui.
   - 'big' (Gran): lletra gran fixa; els versos llargs es parteixen i la continuació queda sagnada. */
let textSize = 'fit';
try { if (localStorage.getItem('canconer_text_size') === 'big') textSize = 'big'; } catch (e) {}

function paintSizeBtn() {
  const b = document.getElementById('sizeBtn');
  if (!b) return;
  const big = textSize === 'big';
  b.title = big ? 'Lletra gran (toca per ajustar cada vers a una línia)' : 'Lletra ajustada: cada vers en una línia (toca per lletra gran)';
  b.style.background = big ? '#7d5635' : '';
  b.style.color = big ? '#fff5e3' : '';
}

function toggleTextSize() {
  textSize = textSize === 'big' ? 'fit' : 'big';
  try { localStorage.setItem('canconer_text_size', textSize); } catch (e) {}
  paintSizeBtn();
  fitLyrics();
  showToast(textSize === 'big' ? 'Lletra gran: els versos llargs es parteixen en dues línies.' : 'Lletra ajustada: cada vers en una sola línia, com al cançoner.');
}

function fitLyrics() {
  paintSizeBtn();
  const lc = document.querySelector('.song-lyrics');
  if (!lc) return;
  lc.style.fontSize = '';
  lc.classList.remove('lyrics-fit', 'lyrics-big');
  if (textSize === 'big') { lc.classList.add('lyrics-big'); return; }
  const base = parseFloat(getComputedStyle(lc).fontSize);
  const avail = lc.clientWidth;          // amplada real, abans d'impedir els salts de línia
  lc.classList.add('lyrics-measuring');
  let widest = 0;
  lc.querySelectorAll('.vt').forEach(el => {
    if (el.offsetParent !== null) widest = Math.max(widest, el.getBoundingClientRect().width);
  });
  lc.classList.remove('lyrics-measuring');
  lc.classList.add('lyrics-fit');        // mai no es parteix un vers
  if (widest > avail && avail > 0) {
    lc.style.fontSize = Math.max(8, Math.floor(base * avail / widest * 0.99 * 10) / 10) + 'px';
  }
}
let fitTimer = null;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitLyrics, 120); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitLyrics);

function render() {
  const sheet = document.getElementById('bookSheet');
  const pageBody = document.getElementById('pageBody');
  const chordCheckbox = document.getElementById('chordToggle');
  const facsimilCheckbox = document.getElementById('facsimilToggle');

  if (!sheet || !pageBody) return;

  if (chordCheckbox) chordCheckbox.checked = showChords;
  if (facsimilCheckbox) facsimilCheckbox.checked = isFacsimil;

  if (showChords) {
    sheet.classList.remove('no-chords');
  } else {
    sheet.classList.add('no-chords');
  }

  const facsimilHTML = isFacsimil ? renderFacsimilHTML(currentView) : null;
  sheet.classList.toggle('facsimil-mode', !!facsimilHTML);

  sheet.classList.toggle('cover-mode', currentView === 0 && !facsimilHTML);
  if (facsimilHTML) {
    pageBody.innerHTML = facsimilHTML;
    facsimilPreloadNext(currentView);
  } else if (currentView === 0) {
    pageBody.innerHTML = renderCoverHTML();
  } else if (currentView === 'index') {
    pageBody.innerHTML = renderIndexHTML();
  } else if (currentView === 'proleg') {
    pageBody.innerHTML = renderProlegHTML();
  } else if (currentView === 'presentacio') {
    pageBody.innerHTML = renderPresentacioHTML();
  } else if (currentView === 'acords') {
    pageBody.innerHTML = renderChordsChartHTML();
  } else if (currentView === 'convencions') {
    pageBody.innerHTML = renderConventionsHTML();
  } else if (typeof currentView === 'number') {
    pageBody.innerHTML = renderSongPageHTML(currentView);
  }

  if (window.lucide) {
    try { lucide.createIcons(); } catch (e) {}
  }
  fitLyrics();
  // Peu: els enllaços preliminars només a la portada; el botó d'enviar, només a les cançons
  const foot = document.getElementById('footLinks');
  if (foot) foot.classList.toggle('hidden', currentView !== 0);
  const fb = document.getElementById('footFeedback');
  if (fb) fb.style.display = currentView === 0 ? '' : 'none';
  if (typeof taulaPaint === 'function') taulaPaint();
  if (typeof asPaint === 'function') asPaint();
}

/* =========================================================================
   PÀGINES V. PRÒLEG I VII. PRESENTACIÓ (ESTIL DEL CANÇONER)
   ========================================================================= */
function renderProlegHTML() {
  return `
    <div class="flex-1 flex flex-col justify-between">
      <div>
        <div class="flex items-baseline justify-between gap-2 mb-6">
          <h1 class="font-serif-title italic font-bold text-[2.8rem] sm:text-[3.2rem] text-[#17120e] leading-none">
            Pròleg
          </h1>
        </div>

        <div class="lyrics-container space-y-5 text-justify leading-relaxed">
          <p>Hi ha moments a Menorca que no s'expliquen amb rellotges, sinó amb acords de guiterra i veus que s'ajunten al voltant d'una taula. Ja sigui en un racó d'Es Cau a Cala Corb, a la fresca d'un porxo d'estiu o en una sobretaula improvisada entre amics i família, quan algú rasca el primer acord d'una havanera, d'un bolero o d'un valset, passa una cosa màgica: tothom deixa el que feia i es posa a cantar.</p>
          <p>El <em>Cançoner de Taverna</em> físic ha estat durant anys el fidel company d'aquestes vetlades. Però tots hem viscut aquell instant en què comença a sonar una cançó a mitja llum i la meitat de la taula encara va passant pàgines amunt i avall demanant: <em>«A quina pàgina és? Qui la té?»</em>. O el cas de qui vol seguir només la lletra i es perd entre tants d'acords intercalats enmig de les síl·labes.</p>
          <p>Aquest projecte neix precisament d'aquí: de les ganes de cuidar aquests moments compartits sense que la tecnologia ens separi ni ens faci perdre l'encant del paper. No volia fer una web freda de partitures, sinó mantenir intacta l'ànima del llibre original —el seu color de pàgina viscuda, la seva tipografia i la seva essència—, però donant-li vida perquè cantar junts sigui encara més fàcil i immediat.</p>
          <p>Perquè al cap i a la fi, les cançons de taverna no són per llegir-les en solitari: són per cantar-les mirant-nos als ulls, alçant el got i fent pinya.</p>
        </div>
      </div>

      <div class="pt-4 mt-10 border-t border-[#baa279]/50 flex items-center justify-between text-lg font-serif-title italic text-[#4a3b2c]">
        <button onclick="goToPage('index')" class="hover:text-black transition">&lsaquo; Índex</button>
        <span class="not-italic font-bold">V</span>
        <button onclick="goToPage('presentacio')" class="hover:text-black transition">Presentació &rsaquo;</button>
      </div>
    </div>
  `;
}

function renderPresentacioHTML() {
  return `
    <div class="flex-1 flex flex-col justify-between">
      <div>
        <div class="flex items-baseline justify-between gap-2 mb-6">
          <h1 class="font-serif-title italic font-bold text-[2.8rem] sm:text-[3.2rem] text-[#17120e] leading-none">
            Presentació
          </h1>
        </div>

        <div class="lyrics-container space-y-4 text-justify leading-relaxed">
          <p>Em dic <strong>Xavier Enseñat</strong>, tenc <strong>22 anys</strong>, som <strong>des Castell</strong> i actualment estic estudiant <strong>Disseny Digital i Tecnologies Creatives</strong> a Lleida. Vaig crèixer escoltant al meu avi cantar aquestes cançons, i m'he adonat que no hi ha res més polit que la unió que es crea quan diverses generacions canten plegades una mateixa tonada.</p>
          <p>Amb allò que estic aprenent als meus estudis, m'he proposat digitalitzar aquest <em>Cançoner de Taverna</em> pensant cent per cent en l'experiència real de cantar en grup. Per això aquesta aplicació s'ha dissenyat amb tres idees molt clares:</p>
          <ul class="list-disc pl-6 space-y-2">
            <li><strong>Cerca immediata per títol, pàgina o tipologia:</strong> Tant si saps el número de pàgina del llibre com el títol o si us ve de gust encadenar menorquines, marineres, mexicanes o rumbes, hi arribes a l'instant sense perdre ni una estrofa.</li>
            <li><strong>Acords activables i desactivables:</strong> Els guitarristes tenen tots els acords col·locats exactament damunt la síl·laba original i l'opció de veure el <em>Facsímil</em> escanejat; i qui només vol cantar pot desactivar l'interruptor d'<em>Acords</em> perquè la lletra quedi totalment neta i clara.</li>
            <li><strong>Modo Taula en línia:</strong> Sovint algú comença a tocar una cançó i la resta del grup no sap quina és o a quina pàgina es troba. Amb el <em>Modo Taula</em>, la primera persona que la localitza prem «Enviar a la Taula» i la pàgina apareix automàticament a les pantalles de tots els companys. <em>Versió de prova: de moment només s'actualitzen les pestanyes obertes en aquest mateix dispositiu; la connexió entre mòbils arribarà amb el servidor.</em></li>
          </ul>
          <div class="mt-6 p-4 rounded border border-[#8c6239]/50 bg-[#e4cea0]/45 text-[1.05rem] leading-snug">
            <p class="font-bold text-[#2b2118] mb-1">Nota sobre aquesta edició (Versió de prova):</p>
            <p class="text-[#3d2f22]">Aquesta aplicació és actualment una <strong>versió de prova (prototip en desenvolupament)</strong> creada amb tot l'afecte per posar-la a prova a les nostres cantades, recollir suggeriments dels amics i músics i seguir polint cada detall.</p>
          </div>
          <p class="text-right font-serif-title italic text-xl pt-2">Que no s'aturi mai sa música ni ses ganes de cantar junts!</p>
        </div>
      </div>

      <div class="pt-4 mt-10 border-t border-[#baa279]/50 flex items-center justify-between text-lg font-serif-title italic text-[#4a3b2c]">
        <button onclick="goToPage('proleg')" class="hover:text-black transition">&lsaquo; Pròleg</button>
        <span class="not-italic font-bold">VII</span>
        <button onclick="goToPage('acords')" class="hover:text-black transition">Els acords &rsaquo;</button>
      </div>
    </div>
  `;
}

/* =========================================================================
   PÀGINES INTRODUCTÒRIES DEL PDF: ELS ACORDS (IX) I CONVENCIONS (X)
   ========================================================================= */
function renderChordsChartHTML() {
  return `
    <div class="flex-1 flex flex-col justify-between">
      <div>
        <h1 class="font-serif-title italic font-bold text-[2.8rem] text-[#17120e] mb-4">Els acords</h1>
        <img src="${ACORDS_IMG}" alt="Taula d'acords per a guitarra, amb les posicions de cada acord: do, do#, re, mib, mi, fa, fa#, sol, sol#, la, sib i si, cadascun en menor, major, sèptima i disminuït. Dis1 = DOdis, MIbdis, FA#dis, LAdis. Dis2 = DO#dis, MIdis, SOLdis, SIbdis. Dis3 = REdis, FAdis, SOL#dis, SIdis. RE# = MIb i LA# = SIb." style="display:block;width:100%;height:auto;mix-blend-mode:multiply">
      </div>

      <div class="pt-4 mt-8 border-t border-[#baa279]/50 flex items-center justify-between text-lg font-serif-title italic text-[#4a3b2c]">
        <button onclick="goToPage('presentacio')" class="hover:text-black transition">&lsaquo; Presentació</button>
        <span class="not-italic font-bold">IX</span>
        <button onclick="goToPage('convencions')" class="hover:text-black transition">Convencions &rsaquo;</button>
      </div>
    </div>
  `;
}

function renderConventionsHTML() {
  return `
    <div class="flex-1 flex flex-col justify-between">
      <div>
        <h1 class="font-serif-title italic font-bold text-[2.8rem] text-[#17120e] mb-6">Convencions</h1>
        <div class="space-y-3 font-lyrics text-[1.1rem] text-[#1c150f]">
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">do, re, mi...</span>
            <span class="col-span-2">Acord en mode menor</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">DO, RE, MI...</span>
            <span class="col-span-2">Acord en mode major</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">DO7, RE7, MI7...</span>
            <span class="col-span-2">Acord de sèptima</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">dis1, dis2, dis3</span>
            <span class="col-span-2">Acord disminuït</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic"><u>DO</u>, <u>RE</u>, <u>MI</u>...</span>
            <span class="col-span-2">Tocar totes les cordes de dalt a baix una sola vegada</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic"><u style="text-decoration-style:wavy">DO</u>, <u style="text-decoration-style:wavy">RE</u>, <u style="text-decoration-style:wavy">MI</u>...</span>
            <span class="col-span-2">Tocar fent trèmolo amb totes les cordes</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">c/2, c/3</span>
            <span class="col-span-2">Celleta al 2n i 3r trast respectivament</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">bis &nbsp;&rarr;&nbsp; *</span>
            <span class="col-span-2">La cançó continua repetint el fragment que segueix l'asterisc anteriorment més proper.</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">bis 2 &nbsp;&rarr;&nbsp; **</span>
            <span class="col-span-2">La cançó continua repetint el fragment que segueix el doble asterisc. Aquesta repetició (bis 2) es farà una vegada ja s'hagi fet la primera (bis 1).</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">bis x2, bis x3</span>
            <span class="col-span-2">Cal repetir el fragment que segueix l'asterisc tantes vegades com s'indiqui: dues (x2) o bé tres (x3).</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">final en bis</span>
            <span class="col-span-2">La cançó acaba en aquest punt una vegada feta la repetició.</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">DC</span>
            <span class="col-span-2"><em>Da cappo.</em> Es repeteix la cançó des de l'inici.</span>
          </div>
          <div class="grid grid-cols-3 py-2 border-b border-[#baa279]/50">
            <span class="font-bold italic">(ll.), (m.)</span>
            <span class="col-span-2">Indica qui és l'autor de la lletra (ll.) i qui és el de la música (m.). Quan només apareix un nom significa que aquest és l'autor tant de la lletra com de la música.</span>
          </div>
        </div>
        <p class="mt-6 text-sm text-[#4a3b2c] font-lyrics leading-relaxed">
          <strong>Nota:</strong> Aquest cançoner ha entrat a impremta abans que l'IEC publicàs la nova gramàtica normativa, per la qual cosa la part escrita en català es regeix amb les normes de la Gramàtica catalana de Pompeu Fabra (1918/1933).
        </p>
      </div>

      <div class="pt-4 mt-8 border-t border-[#baa279]/50 flex items-center justify-between text-lg font-serif-title italic text-[#4a3b2c]">
        <button onclick="goToPage('acords')" class="hover:text-black transition">&lsaquo; Els acords</button>
        <span class="not-italic font-bold">X</span>
        <button onclick="goToPage(1)" class="hover:text-black transition">1. A cara o creu &rsaquo;</button>
      </div>
    </div>
  `;
}

/* =========================================================================
   CONTINGUT DE RESERVA AMB SÍL·LABES I ACORDS PER A QUALSEVOL DE LES 125 CANÇONS
   ========================================================================= */
function renderFallbackSongStanzas(song) {
  const mainChord = song.to.replace(/\(c\/\d\)\s*/i, '').split(' ')[0] || 'DO';
  const domChord = mainChord.toUpperCase() === 'DO' ? 'SOL7' : (mainChord.toUpperCase() === 'SOL' ? 'RE7' : 'MI7');
  const subChord = mainChord.toUpperCase() === 'DO' ? 'FA' : (mainChord.toUpperCase() === 'SOL' ? 'DO' : 're');

  const sampleStanza1 = `Quan co[${mainChord}]mença a sonar es [${domChord}]nostre cant,\na la [${subChord}]vora de la mar [${domChord}]de Me[${mainChord}]norca,\ns'encén [${mainChord}]tota sa ta[${domChord}]verna escol[${mainChord}]tant\naquest [${domChord}]ritme de ${song.r} que mos [${mainChord}]porta. [_${mainChord}]`;

  const sampleStanza2 = `* Cantem [${subChord}]junts a sa taula de [${mainChord}]fusta,\namb a[${domChord}]mics i una copa de [${mainChord}]vi,\nque sa [${subChord}]nit marinera mos [${mainChord}]gusta\ni es re[${domChord}]cord mai no es pot esbor[${mainChord}]rar. {(bis)}`;

  return `
    <div class="stanza">${formatLyrics(sampleStanza1)}</div>
    <div class="stanza">${formatLyrics(sampleStanza2)}</div>
    <div class="pt-4 text-sm italic text-[#5c4a38] font-serif-title">
      Pàgina ${song.p} del Cançoner de Taverna (${song.t} — ${song.auth}). Pots activar "Facsímil" a dalt a la dreta per veure l'escaneig original del PDF.
    </div>
  `;
}

/* =========================================================================
   NAVEGACIÓ, CERCA BIDIRECCIONAL I CONTROLS
   ========================================================================= */
function goToPage(target) {
  if (typeof asStop === 'function') asStop();   // canviar de pàgina atura el desplaçament automàtic
  currentView = target;
  document.getElementById('searchDropdown').classList.add('hidden');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleChords(checked) {
  showChords = checked;
  render();
}

function toggleFacsimil(checked) {
  isFacsimil = checked;
  try { localStorage.setItem('canconer_facsimil', checked ? '1' : '0'); } catch (e) {}
  render();
  if (checked && facsimilPages(currentView).length === 0) showToast('Aquesta pàgina no és a l\'escanejat original.');
}

function normalizeText(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function handleSearchInput(val) {
  const drop = document.getElementById('searchDropdown');
  const q = val.trim();
  if (!q) {
    drop.classList.add('hidden');
    return;
  }

  // Si és un número de pàgina directe (1-125), navega immediatament i mostra coincidència
  const num = parseInt(q);
  if (!isNaN(num) && String(num) === q && num >= 1 && num <= 125) {
    goToPage(num);
  }

  const normQ = normalizeText(q);

  // Comprovar si l'usuari està cercant per tipologia (menorquines, marineres, mexicanes, de sempre, rumbes)
  const matchedCategories = Object.values(SONG_CATEGORIES).filter(cat =>
    normalizeText(cat.label).includes(normQ)
  );

  // Ordre de prioritat: títol (exacte > comença per > paraula que comença per > conté),
  // després autor, i al final ritme o tipologia.
  const scoreOf = (s) => {
    const t = normalizeText(s.t);
    if (String(s.p) === q) return 0;
    if (t === normQ) return 1;
    if (t.startsWith(normQ)) return 2;
    if ((' ' + t).includes(' ' + normQ)) return 3;
    if (t.includes(normQ)) return 4;
    if (normalizeText(s.auth).includes(normQ)) return 5;
    if (normalizeText(s.r).includes(normQ)) return 6;
    if (s.cats.some(k => normalizeText(SONG_CATEGORIES[k].label).includes(normQ))) return 7;
    return -1;
  };
  const scored = FULL_INDEX.map(s => ({ s, sc: scoreOf(s) })).filter(x => x.sc >= 0);
  scored.sort((x, y) => x.sc - y.sc || x.s.p - y.s.p);
  const matches = scored.slice(0, 14).map(x => x.s);
  const titleMatches = scored.filter(x => x.sc <= 4).length;

  if (matches.length === 0 && matchedCategories.length === 0) {
    drop.innerHTML = `<div class="px-3.5 py-2 text-xs text-[#9c8269]">Cap cançó ni tipologia trobada amb "${q}"</div>`;
    drop.classList.remove('hidden');
    return;
  }

  let html = '';

  // Si coincideix amb una tipologia, oferir un accés directe per filtrar tot l'índex per aquesta tipologia
  let catRows = '';
  if (matchedCategories.length > 0 && normQ.length >= 3) {
    catRows = matchedCategories.map(cat => `
      <div onclick="selectCategoryFromSearch('${cat.id}')" class="px-3.5 py-2 bg-[#281d14] hover:bg-[#38291d] cursor-pointer flex items-center justify-between text-xs sm:text-sm transition">
        <div class="flex items-center gap-2">
          <span class="cat-dot" style="background-color: ${cat.color}"></span>
          <span class="text-[#f3e6be] font-semibold">Veure totes les cançons «${cat.label}» a l'Índex</span>
        </div>
        <span class="text-[11px] text-amber-300 font-semibold">${FULL_INDEX.filter(s => s.cats.includes(cat.id)).length} cançons &rsaquo;</span>
      </div>
    `).join('');
  }

  const rowHTML = (m) => {
    const tipus = m.cats.map(k => SONG_CATEGORIES[k].label).join(', ');
    return `
      <div onclick="selectSearchResult(${m.p})" class="px-3.5 py-2 hover:bg-[#2e2117] cursor-pointer flex items-start gap-2.5 text-sm transition">
        <span class="pt-1 shrink-0">${catDotsHTML(m.cats)}</span>
        <div class="flex-1" style="min-width:0">
          <div class="leading-snug"><span class="font-bold text-amber-300">${m.p}.</span> <span class="text-[#f3e6be] font-medium">${m.t}</span></div>
          <div class="text-[11px] sm:text-xs text-[#9c8269] italic leading-snug">${tipus} · ${m.r}</div>
        </div>
      </div>
    `;
  };
  // Primer les cançons que coincideixen pel títol, després l'accés a la tipologia, després la resta
  html += matches.slice(0, titleMatches).map(rowHTML).join('');
  html += catRows;
  html += matches.slice(titleMatches).map(rowHTML).join('');

  drop.innerHTML = html;
  drop.classList.remove('hidden');
  placeSearchDropdown();
}

// Al mòbil, el desplegable va just davall de la capçalera i ocupa tot l'ample i l'alt disponible
function placeSearchDropdown() {
  const drop = document.getElementById('searchDropdown');
  if (!drop) return;
  if (window.innerWidth > 640) { drop.style.top = ''; drop.style.maxHeight = '70vh'; return; }
  const input = document.getElementById('searchInput');
  const top = Math.round(input.getBoundingClientRect().bottom + 6);
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  drop.style.top = top + 'px';
  drop.style.maxHeight = Math.max(160, vh - top - 8) + 'px';
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => {
  const d = document.getElementById('searchDropdown');
  if (d && !d.classList.contains('hidden')) placeSearchDropdown();
});

function selectCategoryFromSearch(catId) {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchDropdown').classList.add('hidden');
  activeIndexCategoryFilter = catId;
  goToPage('index');
}

function handleSearchKeydown(event) {
  if (event.key === 'Enter') {
    const q = event.target.value.trim();
    const num = parseInt(q);
    if (!isNaN(num) && num >= 1 && num <= 125) {
      selectSearchResult(num);
      return;
    }
    const firstRow = document.querySelector('#searchDropdown [onclick^="selectSearchResult"]');
    if (firstRow) firstRow.click();
  }
}

function selectSearchResult(pageNum) {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchDropdown').classList.add('hidden');
  goToPage(pageNum);
}

/* =========================================================================
   MODO TAULA (SINCRONITZACIÓ EN VIU ENTRE DISPOSITIUS)
   ========================================================================= */
function showToast(msg) {
  const toast = document.getElementById("toast");
  document.getElementById("toastMsg").innerText = msg;
  toast.classList.remove("translate-y-20", "opacity-0");
  setTimeout(() => {
    toast.classList.add("translate-y-20", "opacity-0");
  }, 3400);
}

// Exposar totes les funcions al context global window per evitar qualsevol ReferenceError en atributs onclick
// Enquesta d'opinió (Tally). S'hi passa la pàgina on era i el tipus d'aparell, sense cap dada personal.
const FEEDBACK_FORM_URL = 'https://tally.so/r/4aJbyO';
function openFeedback() {
  const aparell = window.innerWidth <= 640 ? 'mobil' : (window.innerWidth <= 1024 ? 'tauleta' : 'ordinador');
  const url = `${FEEDBACK_FORM_URL}?pagina=${encodeURIComponent(String(currentView))}&aparell=${aparell}`;
  if (navigator.onLine === false) { showToast("Per enviar la teva opinió cal connexió a internet."); return; }
  window.open(url, '_blank', 'noopener');
}
window.openFeedback = openFeedback;
window.goToPage = goToPage;
window.toggleChords = toggleChords;
window.toggleTextSize = toggleTextSize;
window.toggleFacsimil = toggleFacsimil;
window.handleSearchInput = handleSearchInput;
window.handleSearchKeydown = handleSearchKeydown;
window.selectSearchResult = selectSearchResult;
window.selectCategoryFromSearch = selectCategoryFromSearch;
window.filterByCategory = filterByCategory;
window.handleCoverImageUpload = handleCoverImageUpload;
window.render = render;

// Render inicial en carregar el document
render();

// Mode sense connexió: el service worker desa l'aplicació al mòbil
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker no registrat:', e));
  });
}
