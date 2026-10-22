// 起動と全体の配線。
// URL：?f=施設フォルダ名 &n=最初の地点 &yaw=最初の向き &edit=1（編集モード）&embed=1（埋め込み）
//      &theme=light|dark &intro=0（ようこそ画面を出さない） &guide=1（すぐガイドを始める）
//      &lang=en（言語） &src=poster（どこから来たか。計測に載る） &demo=1（オフライン保存を出す）

import { PanoViewer, wrapDeg } from './viewer.js';
import { Loader } from './loader.js';
import { Overlay } from './overlay.js';
import { Minimap } from './minimap.js';
import { Gyro } from './gyro.js';
import { Guide } from './guide.js';
import { initAnalytics, track } from './analytics.js';
import { t, setLang, getLang, localize, LANGS } from './i18n.js';
import { $, h, openSheet, closeSheet, initSheet, toast, setLoading, initTheme, toggleTheme, showError } from './ui.js';

const params = new URLSearchParams(location.search);
const SIDE_QUERY = '(min-width: 720px) and (orientation: landscape)'; // css の #sheet.side と同じ条件
const ROTATE_SPEED = 4; // 自動回転の速さ（度/秒）
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
};
initTheme(params.get('theme'));
initSheet();
applyPrefs();

const app = {
  fid: null,
  tour: null,
  node: null,
  busy: false,
  idle: Promise.resolve(),
  navSeq: 0, // 新しい移動の操作のたびに増やす。歩いている途中の古い移動はこれを見て止まる
  editing: false,
  editor: null,
  src: (params.get('src') || '').slice(0, 40), // チラシ・ホームページなど、どこから来たか
  byId: (id) => app.tour.nodes.find((n) => n.id === id),
};
window.tourApp = app; // 確認用

main().catch((e) => {
  console.error(e);
  showError(t('err.title'), e.message);
});

async function main() {
  if (location.protocol === 'file:') throw new Error(t('err.file'));
  // 施設ごとの入口ページ（tools/make_pages.py で作る）では、meta tour-facility に施設のフォルダ名が入っている
  const fixedFid = document.querySelector('meta[name="tour-facility"]')?.content || '';
  const fid = params.get('f') || fixedFid;
  app.fixedFid = fixedFid;
  if (!fid) return showChooser();
  if (!/^[\w-]+$/.test(fid)) throw new Error(t('err.fid'));
  app.fid = fid;
  // 編集モードは手元の PC（localhost）でだけ開ける。公開中のサイトでは ?edit=1 を付けても普通に表示する
  app.editing = params.get('edit') === '1' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  app.embed = params.get('embed') === '1' || window.self !== window.top;
  document.body.classList.toggle('embed', app.embed);

  const base = `facilities/${fid}/`;
  app.loader = new Loader(base);
  let tour = null;
  try {
    const r = await fetch(base + 'tour.json', { cache: 'no-cache' });
    if (r.ok) tour = await r.json();
    else if (!app.editing) throw new Error(t('err.notour', { path: `facilities/${fid}/tour.json` }));
  } catch (e) {
    if (!app.editing) throw e instanceof SyntaxError ? new Error(t('err.json', { msg: e.message })) : e;
  }
  app.tour = normalize(tour || { name: '新しい施設', nodes: [] });
  app.loader.rev = app.tour.rev || '';

  // 言語：URL の lang → 前に選んだ言語 → 端末の言語。施設が訳を用意している言語だけ（編集モードは日本語）
  app.langs = ['ja', ...(app.tour.languages || []).filter((l) => l !== 'ja' && LANGS.includes(l))];
  const want = params.get('lang') || store.get('tour-lang') || (navigator.language || 'ja').slice(0, 2);
  if (!app.editing && want !== 'ja' && app.langs.includes(want)) {
    try {
      const r = await fetch(base + `tour.${want}.json`, { cache: 'no-cache' });
      if (r.ok) { app.tour = localize(app.tour, await r.json()); setLang(want); }
    } catch { /* 訳が読めなければ日本語で出す */ }
  } else {
    setLang('ja');
  }
  loadFont(JSON.stringify(app.tour));

  // 画面の部品
  app.viewer = new PanoViewer($('#pano'));
  app.overlay = new Overlay(app.viewer, $('#arrows'), $('#pins'), {
    onLink: (l) => { if (app.busy) return; app.guide.pause(); app.navSeq++; goTo(l.to, { link: l }); },
    onPin: (p) => { app.guide.pause(); setRotate(false); showPin(p); },
    isEditing: () => app.editing && app.editor?.active(),
    onEdit: (kind, item) => app.editor?.editMarker(kind, item),
    onMoved: () => app.editor?.changed(),
    safeBottom,
    exits: $('#exits'),
  });
  app.mini = new Minimap($('#minimap'), { full: false, loader: app.loader });
  app.gyro = new Gyro(app.viewer);
  app.guide = new Guide(app, { walkTo, goTo, onState: guideState });
  app.viewer.on('change', updateMaps);
  app.viewer.on('tap', (e) => app.editor?.tap(e));
  app.viewer.on('interact', () => {
    hideHint();
    setRotate(false);
    app.guide.pause();
  });
  let lostTimer;
  app.viewer.on('lost', () => {
    lostTimer = setTimeout(() => showError(t('lost.title'), t('lost.body'), true), 2500);
  });
  app.viewer.on('restored', () => {
    clearTimeout(lostTimer);
    const node = app.node;
    if (node) app.loader.image(node.image).then((img) => { if (app.node === node) app.viewer.setImage(img, node.heading || 0); }).catch(() => {});
  });

  bindControls();

  if (app.editing) {
    const { Editor } = await import('./editor.js');
    app.editor = new Editor(app, { goTo, refresh, showMap, walkTo });
    app.tour = app.editor.loadDraft(app.tour);
  } else {
    initAnalytics(app.tour);
  }
  refresh();

  const nParam = params.get('n');
  const startId = nParam && app.byId(nParam) ? nParam : app.tour.start || app.tour.nodes[0]?.id;
  const intro = !app.editing && !nParam && params.get('intro') !== '0' && params.get('guide') !== '1';
  if (intro) showIntro();
  else $('#hud').hidden = false;

  if (startId) {
    const yaw = params.get('yaw');
    await goTo(startId, { initial: true, yaw: yaw != null && !isNaN(+yaw) ? +yaw : null });
    $('#introGuide').disabled = $('#introFree').disabled = false;
    if (intro) {
      if (document.body.classList.contains('intro') && !app.viewer.reduced) app.viewer.autoRotate = ROTATE_SPEED; // ようこそ画面の後ろでゆっくり回す
    } else if (!app.editing) {
      track('tour_start', { from: 'link', src: app.src, lang: getLang() });
      if (params.get('guide') === '1') app.guide.start();
      else showHint();
    }
  }
}

// 文字（Zen Maru Gothic）を、このページで使う文字だけに絞って読み込む（全部だと約 900KB、絞ると 150KB ほど）
// 使う文字＝画面の固定の文字＋ tour.json の文字＋ JS が出す文字（main/guide/ui/i18n のソースから拾う）
async function loadFont(extra = '') {
  try {
    const srcs = await Promise.all(['./main.js', './guide.js', './ui.js', './i18n.js'].map((f) => fetch(new URL(f, import.meta.url)).then((r) => r.text()).catch(() => '')));
    const all = document.body.textContent + extra + srcs.join('') + '0123456789０１２３４５６７８９ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz・、。（）「」！？ー〜：／';
    const chars = [...new Set([...all].filter((c) => c > ' ' && !/[\u0000-\u001f]/.test(c)))].join('');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'fontLink';
    link.href = `https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap&text=${encodeURIComponent(chars)}`;
    document.head.append(link);
  } catch { /* 文字が読めなくても、端末の文字で表示できる */ }
}

// 見る人の好み（文字の大きさ・ガイドの速さ）
function applyPrefs() {
  document.documentElement.classList.toggle('large-text', store.get('tour-large') === '1');
}

// 足りない値を補う（手で書いた JSON でも動くように）
function normalize(tr) {
  tr.nodes = Array.isArray(tr.nodes) ? tr.nodes : [];
  for (const n of tr.nodes) {
    n.links = Array.isArray(n.links) ? n.links : [];
    n.pins = Array.isArray(n.pins) ? n.pins : [];
    n.heading = +n.heading || 0;
  }
  return tr;
}

// 施設の名前・ロゴ・色などを画面に反映
export function refresh() {
  const tr = app.tour;
  document.title = `${tr.name || ''}｜${t('title.suffix')}${tr.sample ? t('title.sample') : ''}`;
  $('#facilityName').textContent = tr.name || '';
  $('#sampleBadge').hidden = !tr.sample;
  const logo = $('#brandLogo');
  logo.hidden = !tr.logo;
  if (tr.logo) logo.src = app.loader.url(tr.logo);
  document.documentElement.style.setProperty('--accent', tr.accent || '#2f9e83');
  document.documentElement.style.setProperty('--accent-strong', readableOn(tr.accent || '#2f9e83'));
  app.mini.build(tr);
  $('#minimap').hidden = !tr.floorplan?.image;
  $('#btnMap').hidden = !tr.floorplan?.image;
  $('#btnContact').hidden = !hasContact(tr) && !hasInfo(tr);
  if (app.node) app.overlay.setNode(app.node, nodeLabel);
  updatePlace();
  updateMaps();
}

// 下の操作（ドック）の上端。矢印やピンがこれより下に来たら隠す
function safeBottom() {
  if ($('#hud').hidden) return app.viewer.ch;
  const d = $('#dock').getBoundingClientRect(), s = $('#stage').getBoundingClientRect();
  return d.top - s.top;
}

// 白い文字を載せても読める濃さ（コントラスト比 4.5 以上）になるまで色を暗くする
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lum = () => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (let k = 0; k < 30 && 1.05 / (lum() + 0.05) < 4.5; k++) [r, g, b] = [r, g, b].map((c) => Math.round(c * 0.93));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function nodeLabel(id) {
  const n = app.byId(id);
  return n ? n.room || n.name || n.id : id;
}

// 「お部屋」に並ぶ地点（部屋名ごとに最初の 1 つ）
function roomEntries() {
  const seen = new Set();
  return app.tour.nodes.filter((n) => n.room && !seen.has(n.room) && seen.add(n.room));
}

// ---- 地点の移動 ----
export async function goTo(id, { link = null, initial = false, yaw = null } = {}) {
  // 前の移動が終わるのを待つ。待っているあいだに新しい操作が来たら、この移動はやめる
  const seq = app.navSeq;
  while (app.busy) await app.idle;
  if (seq !== app.navSeq && !initial) return;
  const node = app.byId(id);
  if (!node) return;
  if (node === app.node && !initial) return;
  app.busy = true;
  let done;
  app.idle = new Promise((r) => { done = r; });
  setLoading(true);
  try {
    const heading = node.heading || 0;
    // 高画質版がまだ手元になければ、小さい下見画像で先に切り替える
    const quick = node.preview && !app.loader.has(node.image);
    let img;
    try {
      img = await app.loader.image(quick ? node.preview : node.image);
    } catch (e) {
      if (!quick) throw e;
      img = await app.loader.image(node.image);
    }
    setLoading(false);
    const v = app.viewer;
    const startYaw = yaw ?? node.startYaw;
    if (initial || !app.node) {
      v.setImage(img, heading);
      v.lookAt(startYaw != null ? startYaw + heading : 0, -6);
    } else if (link) {
      await v.transition(img, heading, { lookYaw: link.yaw + (app.node.heading || 0) });
    } else {
      await v.transition(img, heading, { endYaw: startYaw != null ? startYaw + heading : v.yaw });
    }
    app.node = node;
    app.overlay.setNode(node, nodeLabel);
    updatePlace();
    updateMaps();
    updateUrl();
    app.editor?.nodeChanged();
    if (!app.editing) track('view_spot', { spot: node.id, spot_name: node.name || node.room || node.id });
    if (quick) {
      app.loader.image(node.image).then((full) => {
        if (app.node === node) app.viewer.replaceImage(full);
        else full.close?.();
      }).catch((e) => { if (app.node === node) toast(t('hq.fail', { msg: e.message })); });
    }
    prefetchAround(node);
  } catch (e) {
    console.error(e);
    toast(e.message || t('photo.fail'));
  } finally {
    setLoading(false);
    app.busy = false;
    done();
  }
}

// 矢印をたどって歩いて行く。遠すぎるときはそのまま切り替える
export async function walkTo(id) {
  const seq = ++app.navSeq;
  while (app.busy) await app.idle;
  if (seq !== app.navSeq || !app.node || app.node.id === id) return;
  const path = route(app.node.id, id);
  if (path && path.length <= 4) {
    for (const l of path) {
      if (seq !== app.navSeq) return; // 別の操作が来たので止める
      await goTo(l.to, { link: l });
      if (app.node.id !== l.to) return; // 途中で止まった
    }
  } else {
    await goTo(id);
  }
}

// 矢印のつながりで一番近い道順（幅優先探索）
function route(from, to) {
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const id = q.shift();
    if (id === to) break;
    for (const l of app.byId(id)?.links || []) {
      if (!prev.has(l.to) && app.byId(l.to)) { prev.set(l.to, { id, l }); q.push(l.to); }
    }
  }
  if (!prev.has(to)) return null;
  const path = [];
  for (let cur = to; prev.get(cur); cur = prev.get(cur).id) path.unshift(prev.get(cur).l);
  return path;
}

// 隣は下見画像だけ。高画質は、回線に余裕があるときだけ、次に行きそうな 1 地点（ガイドの次・部屋送りの次）を読む
function prefetchAround(node) {
  const conn = navigator.connection;
  if (conn?.saveData) return;
  const next = (node.links || []).map((l) => app.byId(l.to)).filter(Boolean);
  const list = next.map((n) => n.preview || n.image);
  const fast = !conn || conn.effectiveType === '4g';
  if (fast) {
    const likely = app.guide.active ? app.byId(app.guide.steps()[app.guide.i + 1]?.node) : neighborsInOrder().next;
    const hop = likely && route(node.id, likely.id)?.[0];
    const target = hop ? app.byId(hop.to) : null;
    if (target) list.push(target.image);
  }
  app.loader.prefetch(list);
}

function updateUrl() {
  const u = new URL(location.href);
  if (!app.fixedFid) u.searchParams.set('f', app.fid);
  u.searchParams.set('n', app.node.id);
  u.searchParams.delete('yaw');
  u.searchParams.delete('guide');
  history.replaceState(null, '', u);
}

function updateMaps() {
  if (!app.viewer) return;
  const hf = app.viewer.hfov();
  app.mini.update(app.node, app.viewer.yaw, hf);
  app.bigMap?.update(app.node, app.viewer.yaw, hf);
}

// ---- 今いる場所と、前後の部屋 ----
function updatePlace() {
  const node = app.node;
  $('#placeName').textContent = node ? node.name || node.room || node.id : '';
  const rooms = roomEntries();
  const i = rooms.indexOf(node);
  $('#placeIndex').textContent = i >= 0 ? `${i + 1} / ${rooms.length}` : '';
  const { prev, next } = neighborsInOrder();
  $('#btnPrev').disabled = !prev;
  $('#btnNext').disabled = !next;
}

function neighborsInOrder() {
  const nodes = app.tour.nodes;
  const rooms = roomEntries();
  const cur = nodes.indexOf(app.node);
  let prev = null, next = null;
  for (const r of rooms) {
    const k = nodes.indexOf(r);
    if (k < cur) prev = r;
    if (k > cur && !next) next = r;
  }
  return { prev, next };
}

// ---- ボタン ----
function bindControls() {
  $('#btnZoomIn').addEventListener('click', () => app.viewer.zoomBy(0.78));
  $('#btnZoomOut').addEventListener('click', () => app.viewer.zoomBy(1.28));
  $('#btnRotate').addEventListener('click', () => setRotate(!app.viewer.autoRotate));

  if (Gyro.supported()) {
    $('#btnGyro').hidden = false;
    $('#btnGyro').addEventListener('click', async () => {
      try {
        if (app.gyro.on) app.gyro.disable();
        else { await app.gyro.enable(); setRotate(false); toast(t('gyro.on'), 2200); }
      } catch {
        toast(t('gyro.denied'));
      }
      $('#btnGyro').setAttribute('aria-pressed', String(app.gyro.on));
    });
  }

  const root = document.documentElement;
  if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
    $('#btnFull').hidden = false;
    $('#btnFull').addEventListener('click', () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    });
    const sync = () => $('#btnFull').setAttribute('aria-pressed', String(!!(document.fullscreenElement || document.webkitFullscreenElement)));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  $('#btnPrev').addEventListener('click', () => { const x = neighborsInOrder().prev; if (x) { app.guide.stop(); walkTo(x.id); } });
  $('#btnNext').addEventListener('click', () => { const x = neighborsInOrder().next; if (x) { app.guide.stop(); walkTo(x.id); } });
  $('#placeButton').addEventListener('click', showRooms);

  $('#btnGuide').addEventListener('click', () => {
    if (app.guide.active) app.guide.stop();
    else { setRotate(false); app.guide.start(); }
  });
  $('#btnRooms').addEventListener('click', showRooms);
  $('#btnMap').addEventListener('click', () => showMap());
  $('#minimap').addEventListener('click', () => showMap());
  $('#btnContact').addEventListener('click', showContact);
  $('#btnMore').addEventListener('click', showMore);
}

function setRotate(on) {
  app.viewer.autoRotate = on ? ROTATE_SPEED : 0;
  $('#btnRotate').setAttribute('aria-pressed', String(on));
}

function guideState(active, finished) {
  $('#stepper').hidden = active;
  $('#btnGuide').classList.toggle('on', active);
  $('#btnGuide').querySelector('span').textContent = t(active ? 'tb.guiding' : 'tb.guide');
  if (finished) {
    toast(t('thanks'), 3500);
    if (hasContact(app.tour) || hasInfo(app.tour)) {
      $('#btnContact').classList.add('pulse');
      setTimeout(() => $('#btnContact').classList.remove('pulse'), 6000);
    }
  }
}

// ---- ようこそ画面 ----
function showIntro() {
  const tr = app.tour;
  $('#introName').textContent = tr.name || '';
  $('#introTagline').textContent = tr.tagline || '';
  $('#introTagline').hidden = !tr.tagline;
  $('#introSample').hidden = !tr.sample;
  if (tr.logo) { $('#introLogo').src = app.loader.url(tr.logo); $('#introLogo').hidden = false; }
  const steps = app.guide.steps();
  const sec = steps.reduce((s, x) => s + app.guide.duration(x) / 1000 + 2.5, 0);
  $('#introGuideTime').textContent = steps.length ? t('intro.min', { n: Math.max(1, Math.round(sec / 60)) }) : '';
  $('#introGuide').hidden = !steps.length;
  $('#intro').hidden = false;
  $('#introGuide').disabled = $('#introFree').disabled = true; // 最初の写真が出るまで待つ
  document.body.classList.add('intro');
  const begin = (guide) => {
    document.body.classList.remove('intro');
    $('#intro').classList.add('leaving');
    setTimeout(() => { $('#intro').hidden = true; }, 350);
    $('#hud').hidden = false;
    setRotate(false);
    track('tour_start', { from: guide ? 'intro_guide' : 'intro_free', src: app.src, lang: getLang() });
    if (guide) app.guide.start();
    else showHint();
  };
  $('#introGuide').addEventListener('click', () => begin(true), { once: true });
  $('#introFree').addEventListener('click', () => begin(false), { once: true });
}

// ---- 部屋の一覧 ----
function showRooms() {
  const rooms = roomEntries();
  const curRoom = app.node?.room;
  const list = h('ul', { class: 'room-list' }, rooms.map((n, i) => {
    const thumb = h('span', { class: 'room-thumb' });
    const src = n.preview || n.image;
    if (src) {
      thumb.style.backgroundImage = `url("${app.loader.url(src)}")`;
      thumb.style.backgroundPosition = `${(((n.startYaw || 0) / 360 + 0.5) * 100).toFixed(1)}% 50%`;
    }
    return h('li', {},
      h('button', {
        type: 'button',
        class: n.room === curRoom ? 'current' : '',
        'aria-current': n.room === curRoom ? 'true' : null,
        onclick: () => { closeSheet(); app.guide.stop(); app.navSeq++; goTo(n.id); },
      }, thumb, h('span', { class: 'room-num' }, String(i + 1)), h('span', { class: 'room-name' }, n.room),
      n.room === curRoom ? h('span', { class: 'here' }, t('here')) : null));
  }));
  openSheet({ title: t('rooms.title'), body: rooms.length ? list : h('p', { class: 'muted' }, t('rooms.empty')) });
}

// ---- 見取り図（大） ----
export function showMap({ placing = false } = {}) {
  if (!app.tour.floorplan?.image) return;
  const box = h('div', { class: 'bigmap' });
  app.bigMap = new Minimap(box, {
    full: true,
    loader: app.loader,
    onSelect: (id) => { closeSheet(); app.guide.stop(); app.navSeq++; goTo(id); },
    onPlace: (x, y) => { app.editor?.placeOnMap(x, y); },
  });
  app.bigMap.build(app.tour);
  app.bigMap.setPlacing(placing);
  updateMaps();
  const tip = t(placing ? 'map.place.tip' : 'map.tip');
  openSheet({ title: t(placing ? 'map.place.title' : 'map.title'), body: h('div', {}, box, h('p', { class: 'muted small' }, tip)), wide: true, onClose: () => { app.bigMap = null; } });
}

// ---- 解説 ----
function showPin(pin) {
  // ピンの方へ向いて少し寄る。
  // 横長の画面ではパネルが右に出るので左側の空きの真ん中へ、縦長では下のパネルの上へ寄せる
  const v = app.viewer;
  const before = v.fov;
  const fov = Math.max(40, Math.min(before, 100) * 0.6);
  const tan = Math.tan((fov * Math.PI) / 360);
  let nx = 0, ny = 0;
  if (matchMedia(SIDE_QUERY).matches) {
    const panel = 380 + 32;
    nx = (v.cw - panel) / 2 / v.cw * 2 - 1;
  } else {
    ny = 0.5;
  }
  const deg = (r) => (r * 180) / Math.PI;
  v.flyTo(pin.yaw + (app.node.heading || 0) - deg(Math.atan(nx * tan * (v.cw / v.ch))), pin.pitch - deg(Math.atan(ny * tan)), fov);
  track('open_pin', { spot: app.node.id, pin: pin.title || '' });

  const body = h('div', { class: 'pin-detail' });
  if (pin.image) body.append(h('img', { src: app.loader.url(pin.image), alt: '', loading: 'lazy' }));
  body.append(h('p', { class: 'pin-text' }, pin.text || ''));
  // 閉じたら拡大を元に戻す（向きはそのまま）
  openSheet({ title: pin.title || t('pin.default'), body, side: true, clear: true, onClose: () => v.flyTo(v.yaw, v.pitch, before, 450) });
}

// ---- 問い合わせ・はじめての方へ ----
// アイコンは下の固定の SVG だけを入れる
function iconSpan(svg) {
  const e = h('span', { class: 'contact-icon' });
  e.innerHTML = svg;
  return e;
}
const ICON = {
  cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  tel: '<svg viewBox="0 0 24 24"><path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
  info: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
};
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : null);

function hasContact(tr) {
  const c = tr.contact || {};
  return !!(safeUrl(c.reserve?.url) || c.tel || safeUrl(c.map) || safeUrl(c.web));
}
function hasInfo(tr) {
  const i = tr.info || {};
  return !!(i.hours?.length || i.closed || i.bring?.length || i.steps?.length || i.note);
}

function showContact() {
  const tr = app.tour, c = tr.contact || {};
  const items = [];
  const item = (kind, href, icon, label, sub, primary = false) => items.push(h('a', {
    class: `contact-item${primary ? ' primary' : ''}`,
    href,
    target: kind === 'tel' ? null : '_blank',
    rel: 'noopener',
    onclick: (e) => {
      track('contact_click', { kind, src: app.src });
      if (tr.sample) { e.preventDefault(); toast(t('contact.sampleToast')); }
    },
  }, iconSpan(icon), h('span', { class: 'contact-text' }, h('strong', {}, label), sub ? h('small', {}, sub) : null)));

  if (safeUrl(c.reserve?.url)) item('reserve', c.reserve.url, ICON.cal, c.reserve.label || t('contact.reserve'), c.reserve.note, true);
  if (c.tel) item('tel', `tel:${String(c.tel).normalize('NFKC').replace(/[^\d+]/g, '')}`, ICON.tel, t('contact.tel'), `${c.tel}${c.hours ? (getLang() === 'ja' ? `（${c.hours}）` : ` (${c.hours})`) : ''}`);
  if (safeUrl(c.map)) item('map', c.map, ICON.map, t('contact.map'), c.address);
  if (safeUrl(c.web)) item('web', c.web, ICON.web, t('contact.web'), null);
  const info = hasInfo(tr) ? h('button', { type: 'button', class: 'contact-item', onclick: showInfo },
    iconSpan(ICON.info), h('span', { class: 'contact-text' }, h('strong', {}, tr.info.title || t('info.title')), h('small', {}, t('info.sub')))) : null;
  const body = h('div', { class: 'contact' }, items, info, tr.sample && items.length ? h('p', { class: 'muted small' }, t('contact.sample')) : null);
  openSheet({ title: c.title || t('contact.title'), body });
}

// 受付時間・お休み・持ち物・流れ（tour.json の info）
function showInfo() {
  const tr = app.tour, i = tr.info || {};
  track('open_info', { src: app.src });
  const sec = (title, ...children) => h('section', { class: 'info-sec' }, h('h3', {}, title), ...children);
  const body = h('div', { class: 'info' },
    i.hours?.length ? sec(t('info.hours'), h('table', { class: 'info-table' }, h('tbody', {}, i.hours.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b)))))) : null,
    i.closed ? sec(t('info.closed'), h('p', {}, i.closed)) : null,
    i.bring?.length ? sec(t('info.bring'), h('ul', { class: 'info-list' }, i.bring.map((x) => h('li', {}, x)))) : null,
    i.steps?.length ? sec(t('info.steps'), h('ol', { class: 'info-steps' }, i.steps.map((x) => h('li', {}, x)))) : null,
    i.note ? h('p', { class: 'info-note' }, i.note) : null,
    i.updated ? h('p', { class: 'muted small' }, t('info.updated', { d: i.updated })) : null,
    safeUrl(tr.contact?.web) ? h('a', { class: 'contact-item', href: tr.contact.web, target: '_blank', rel: 'noopener',
      onclick: (e) => { if (tr.sample) { e.preventDefault(); toast(t('contact.sampleToast')); } } },
    iconSpan(ICON.web), h('span', { class: 'contact-text' }, h('strong', {}, t('info.official')))) : null);
  openSheet({ title: i.title || t('info.title'), body });
}

// ---- その他 ----
function showMore() {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const large = document.documentElement.classList.contains('large-text');
  const slow = store.get('tour-slow') === '1';
  const row = (label, onclick, sub) => h('button', { type: 'button', class: 'menu-item', onclick }, h('strong', {}, label), sub ? h('small', {}, sub) : null);
  const canOffline = (app.tour.sample || params.get('demo') === '1') && 'serviceWorker' in navigator && window.isSecureContext;
  const otherLang = app.langs.find((l) => l !== getLang());
  const list = h('div', { class: 'menu' },
    hasInfo(app.tour) ? row(app.tour.info.title || t('info.title'), showInfo, t('info.sub')) : null,
    row(t('more.share'), () => { closeSheet(); share(); }, t('more.shareSub')),
    otherLang ? row(otherLang === 'ja' ? '日本語' : t('more.lang'), () => switchLang(otherLang), otherLang === 'ja' ? 'Show in Japanese' : t('more.langSub')) : null,
    row(t(large ? 'more.largeOff' : 'more.large'), () => {
      store.set('tour-large', large ? null : '1');
      applyPrefs();
      closeSheet();
      app.overlay.update();
    }),
    row(t(slow ? 'more.slowOff' : 'more.slow'), () => { store.set('tour-slow', slow ? null : '1'); closeSheet(); }),
    row(t(dark ? 'more.light' : 'more.dark'), () => { toggleTheme(); closeSheet(); }),
    canOffline ? row(t('more.offline'), () => { closeSheet(); saveOffline(); }, t('more.offlineSub')) : null,
    row(t('more.about'), () => showAbout()),
    app.embed ? row(t('more.open'), () => {
      const u = new URL(location.href);
      u.searchParams.delete('embed');
      window.open(u.toString(), '_blank', 'noopener');
    }) : null);
  openSheet({ title: t('more.title'), body: list });
}

function switchLang(l) {
  store.set('tour-lang', l);
  const u = new URL(location.href);
  u.searchParams.set('lang', l);
  if (app.node) u.searchParams.set('n', app.node.id);
  location.href = u.toString();
}

async function share() {
  const u = new URL(location.href);
  for (const k of ['embed', 'edit', 'guide', 'intro', 'src', 'demo']) u.searchParams.delete(k);
  u.searchParams.set('src', 'share');
  if (app.node) {
    u.searchParams.set('n', app.node.id);
    u.searchParams.set('yaw', String(Math.round(wrapDeg(app.viewer.yaw - (app.node.heading || 0)))));
  }
  const url = u.toString();
  track('share', { spot: app.node?.id });
  try {
    if (navigator.share) { await navigator.share({ title: document.title, url }); return; }
    await navigator.clipboard.writeText(url);
    toast(t('share.copied'));
  } catch (e) {
    if (e?.name !== 'AbortError') openSheet({ title: t('share.title'), body: h('input', { class: 'link-out', value: url, readOnly: true, onfocus: (ev) => ev.target.select() }) });
  }
}

// ---- 電波がなくても見られるように保存（営業デモ用） ----
async function saveOffline() {
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const { referencedFiles } = await import('./checks.js');
    const urls = new Set(['./', 'index.html', 'css/tour.css', 'facilities/index.json',
      ...['main', 'viewer', 'loader', 'overlay', 'minimap', 'gyro', 'guide', 'analytics', 'ui', 'i18n', 'checks'].map((f) => `js/${f}.js`)]);
    const font = $('#fontLink')?.href;
    if (font) urls.add(font);
    // 施設の一覧にある施設（なければ今の施設だけ）
    let ids = [app.fid];
    try { ids = (await (await fetch('facilities/index.json')).json()).map((f) => f.id); } catch { /* 今の施設だけ */ }
    for (const id of ids) {
      const base = `facilities/${id}/`;
      let tr;
      try { tr = await (await fetch(base + 'tour.json', { cache: 'no-cache' })).json(); } catch { continue; }
      urls.add(`${id}/`);
      urls.add(base + 'tour.json');
      for (const l of tr.languages || []) urls.add(`${base}tour.${l}.json`);
      const rev = tr.rev ? `?v=${encodeURIComponent(tr.rev)}` : '';
      for (const f of referencedFiles(tr)) urls.add(base + f + rev);
    }
    const list = [...urls].map((u) => new URL(u, document.baseURI).href);
    const worker = reg.active || navigator.serviceWorker.controller;
    const onMsg = (e) => {
      if (e.data?.type === 'progress') toast(t('offline.saving', { done: e.data.done, total: e.data.total }), 4000);
      if (e.data?.type === 'precached') { toast(t('offline.done'), 4000); navigator.serviceWorker.removeEventListener('message', onMsg); }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'precache', urls: list });
  } catch (e) {
    console.error(e);
    toast(t('offline.fail'));
  }
}

function showAbout() {
  const tr = app.tour;
  openSheet({
    title: t('about.title'),
    body: h('div', { class: 'about' },
      tr.sample ? h('p', {}, h('span', { class: 'sample-badge' }, t('sample')), ` ${t('about.sample', { name: tr.name || '' })}`) : null,
      tr.credit ? h('p', {}, tr.credit) : null,
      h('h3', {}, t('about.how')),
      h('ul', {}, [1, 2, 3, 4, 5].map((n) => h('li', {}, t(`about.${n}`))))),
  });
}

// ---- はじめての案内 ----
let hintTimer;
function showHint() {
  if (store.get('tour-hint-seen')) return;
  $('#hint').hidden = false;
  hintTimer = setTimeout(hideHint, 6000);
}
function hideHint() {
  if ($('#hint').hidden) return;
  clearTimeout(hintTimer);
  $('#hint').classList.add('fade');
  setTimeout(() => { $('#hint').hidden = true; }, 400);
  store.set('tour-hint-seen', '1');
}

// ---- 施設の選択画面 ----
async function showChooser() {
  setLang('ja');
  const r = await fetch('facilities/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(t('err.index'));
  const list = await r.json();
  loadFont(JSON.stringify(list));
  $('#chooserList').replaceChildren(...list.map((f) => h('a', { class: 'facility-card', href: `?f=${encodeURIComponent(f.id)}` },
    h('span', { class: 'facility-thumb', style: f.thumb ? `background-image:url("facilities/${f.id}/${f.thumb}")` : '' }),
    h('span', { class: 'facility-text' }, h('strong', {}, f.name), h('span', {}, f.kind || '')))));
  $('#chooser').hidden = false;
}
