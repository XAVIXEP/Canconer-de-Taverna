// Desplaçament automàtic de la lletra mentre es toca o es canta.
// Botó ▶ a les pàgines de cançó; amb − i + es canvia la velocitat (es recorda).
// S'atura en arribar al final, en tocar la pantalla per moure't tu, o en canviar de pàgina.
// Mentre va, la pantalla no s'apaga (si el mòbil ho permet).

const AS_SPEEDS = [8, 11, 15, 20, 26, 33, 41, 50, 60, 72];   // píxels per segon, nivells 1-10
const autoscroll = { on: false, raf: 0, last: 0, carry: 0, level: 4, wake: null };
try { const l = parseInt(localStorage.getItem('canconer_scroll_speed'), 10); if (l >= 1 && l <= 10) autoscroll.level = l; } catch (e) {}

function asPaint() {
  const box = document.getElementById('autoScroll');
  if (!box) return;
  const onSong = typeof currentView === 'number' && currentView >= 1;
  box.classList.toggle('hidden', !onSong);
  box.classList.toggle('as-on', autoscroll.on);
  document.getElementById('asPlay').setAttribute('aria-label', autoscroll.on ? 'Aturar el desplaçament' : 'Desplaçament automàtic');
  document.getElementById('asPlay').innerHTML = autoscroll.on
    ? '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
  document.getElementById('asLevel').textContent = autoscroll.level;
}

function asAtBottom() {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
}

function asStep(t) {
  if (!autoscroll.on) return;
  if (autoscroll.last) {
    const dt = Math.min(100, t - autoscroll.last);   // si la pestanya s'ha adormit, no fa un salt
    autoscroll.carry += AS_SPEEDS[autoscroll.level - 1] * dt / 1000;
    const px = Math.floor(autoscroll.carry);
    if (px >= 1) { window.scrollBy(0, px); autoscroll.carry -= px; }
    if (asAtBottom()) { asStop(); return; }
  }
  autoscroll.last = t;
  autoscroll.raf = requestAnimationFrame(asStep);
}

async function asStart() {
  if (asAtBottom()) window.scrollTo(0, 0);
  autoscroll.on = true; autoscroll.last = 0; autoscroll.carry = 0;
  autoscroll.raf = requestAnimationFrame(asStep);
  asPaint();
  try { if (navigator.wakeLock) autoscroll.wake = await navigator.wakeLock.request('screen'); } catch (e) { autoscroll.wake = null; }
}

function asStop() {
  if (!autoscroll.on) return;
  autoscroll.on = false;
  cancelAnimationFrame(autoscroll.raf);
  if (autoscroll.wake) { autoscroll.wake.release().catch(() => {}); autoscroll.wake = null; }
  asPaint();
}

function autoScrollToggle() { autoscroll.on ? asStop() : asStart(); }

function autoScrollSpeed(delta) {
  autoscroll.level = Math.max(1, Math.min(10, autoscroll.level + delta));
  try { localStorage.setItem('canconer_scroll_speed', String(autoscroll.level)); } catch (e) {}
  asPaint();
}

// Si toques la pantalla per moure't, el desplaçament s'atura (no lluita amb el dit)
const asUserScroll = (e) => {
  if (!autoscroll.on) return;
  if (e.target && e.target.closest && e.target.closest('#autoScroll')) return;
  asStop();
};
window.addEventListener('touchstart', asUserScroll, { passive: true });
window.addEventListener('wheel', asUserScroll, { passive: true });
window.addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && !/INPUT|TEXTAREA/.test(e.target.tagName)) asStop(); });
// En tornar a la web, el bloqueig de pantalla s'ha perdut: es torna a demanar
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && autoscroll.on && navigator.wakeLock) {
    try { autoscroll.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
});

window.autoScrollToggle = autoScrollToggle;
window.autoScrollSpeed = autoScrollSpeed;
window.asStop = asStop;
window.asPaint = asPaint;
