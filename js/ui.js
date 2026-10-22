// 画面まわりの小さな部品：下から出るパネル、トースト、読み込み中の表示、テーマ切り替え。

import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

// ---- 下から出るパネル ----
let sheetClose = null;
let sheetTimer = null;
let sheetOpenedAt = 0;
let sheetReturnFocus = null;
// side: 横長の画面では右側に出す（解説用）。clear: 背景を暗くしない
export function openSheet({ title, body, wide = false, side = false, clear = false, onClose }) {
  const sheet = $('#sheet');
  closeSheet(true);
  clearTimeout(sheetTimer);
  $('#sheetTitle').textContent = title || '';
  const content = $('#sheetBody');
  content.replaceChildren(body);
  content.scrollTop = 0;
  sheet.classList.toggle('wide', wide);
  sheet.classList.toggle('side', side);
  $('#backdrop').classList.toggle('clear', clear);
  if (!sheetReturnFocus) sheetReturnFocus = document.activeElement;
  sheet.hidden = false;
  $('#backdrop').hidden = false;
  sheetOpenedAt = performance.now();
  for (const id of ['#hud', '#stage']) $(id).inert = true; // パネルが開いているあいだ、後ろは操作できない
  requestAnimationFrame(() => {
    sheet.classList.add('open');
    $('#backdrop').classList.add('open');
  });
  sheetClose = onClose || null;
  $('#sheetClose').focus({ preventScroll: true });
}

export function closeSheet(immediate = false) {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  const fn = sheetClose;
  sheetClose = null;
  sheet.classList.remove('open');
  $('#backdrop').classList.remove('open');
  for (const id of ['#hud', '#stage']) $(id).inert = false;
  if (!immediate) { sheetReturnFocus?.focus?.({ preventScroll: true }); sheetReturnFocus = null; }
  const done = () => { sheet.hidden = true; $('#backdrop').hidden = true; };
  clearTimeout(sheetTimer);
  if (immediate) done(); else sheetTimer = setTimeout(done, 260);
  fn?.();
}

export function initSheet() {
  $('#sheetClose').addEventListener('click', () => closeSheet());
  // スマホでは、ピンから指を離した直後の click が出たばかりの背景に当たるので、少しのあいだ無視する
  $('#backdrop').addEventListener('click', () => { if (performance.now() - sheetOpenedAt > 400) closeSheet(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  // つまみを下に引くと閉じる
  const grip = $('#sheetGrip');
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    $('#sheet').style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
  });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    $('#sheet').style.transform = '';
    if (dy > 70) closeSheet();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ---- トースト ----
let toastTimer;
export function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- 読み込み中 ----
let loadTimer;
export function setLoading(on) {
  clearTimeout(loadTimer);
  if (on) loadTimer = setTimeout(() => $('#loading').classList.add('show'), 250);
  else $('#loading').classList.remove('show');
}

// ---- テーマ（自動・ライト・ダーク） ----
function storage(fn) { try { return fn(window.localStorage); } catch { return null; } }

export function initTheme(param) {
  const saved = param || storage((s) => s.getItem('tour-theme'));
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
}

export function toggleTheme() {
  const cur = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  storage((s) => s.setItem('tour-theme', next));
  toast(t(next === 'dark' ? 'theme.dark' : 'theme.light'), 1600);
}

export function showError(title, detail, reload = false) {
  $('#fatal').hidden = false;
  $('#fatalTitle').textContent = title;
  $('#fatalDetail').textContent = detail || '';
  if (reload && !$('#fatalReload')) {
    $('#fatalDetail').after(h('button', { id: 'fatalReload', type: 'button', class: 'btn-big primary', onclick: () => location.reload() }, t('reload')));
  }
}
