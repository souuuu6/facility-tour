// 写真の上に重ねるもの：床の矢印（SVG）と解説ピン（HTML）。
// 矢印は「目の高さ EYE m から見下ろした床の上」に置いた形を、その都度画面へ投影して描く。

import { wrapDeg } from './viewer.js';
import { t } from './i18n.js';

const RAD = Math.PI / 180;
const EYE = 1.4;
const NS = 'http://www.w3.org/2000/svg';

// 矢印（山形）と下に敷く円。単位は m、(横, 前)
const CHEVRON = [[-0.5, -0.12], [0, 0.34], [0.5, -0.12], [0.5, -0.36], [0, 0.08], [-0.5, -0.36]];
const DISC = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  return [Math.cos(a) * 0.62, Math.sin(a) * 0.62];
});

export function dirVec(worldYaw, pitch) {
  const y = worldYaw * RAD, p = pitch * RAD;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

export class Overlay {
  constructor(viewer, svg, layer, h) {
    this.viewer = viewer;
    this.svg = svg;
    this.layer = layer;
    this.h = h; // { onLink, onPin, isEditing, onEdit(kind, item), onMoved(), safeBottom(), exits, thumbFor(link), suggestTo() }
    this.items = [];
    this.exits = h.exits; // 画面に入っていない行き先のボタンを並べる場所（足もと：下の列）
    // 左右の行き先は、画面の左右の端に縦に並べる（下の列に置くと正面の矢印にかぶるため）
    this.sides = {};
    if (this.exits) for (const k of ['left', 'right']) {
      const e = document.createElement('div');
      e.className = `exits-side exits-${k}`;
      this.exits.after(e);
      this.sides[k] = e;
    }
    viewer.on('change', () => this.update());
  }

  setNode(node, nodeName) {
    this.node = node;
    this.svg.replaceChildren();
    this.layer.replaceChildren();
    this.exits?.replaceChildren();
    for (const e of Object.values(this.sides)) e.replaceChildren();
    this.items = [];
    // 矢印にマウスを乗せたときに出す、行き先の写真のカード
    this.card = document.createElement('div');
    this.card.className = 'arrow-card';
    this.card.hidden = true;
    this.card.append(document.createElement('span'), document.createElement('strong'));
    this.card.firstChild.className = 'arrow-card-img';
    this.layer.append(this.card);
    for (const link of node.links || []) this._addLink(link, nodeName(link.to));
    for (const pin of node.pins || []) this._addPin(pin);
    this.suggest();
    this.update();
  }

  _addLink(link, label) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'floor-arrow');
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', t('go', { label }));
    const disc = document.createElementNS(NS, 'polygon');
    disc.setAttribute('class', 'disc');
    const chev = document.createElementNS(NS, 'polygon');
    chev.setAttribute('class', 'chev');
    g.append(disc, chev);
    this.svg.append(g);
    const thumb = this.h.thumbFor?.(link);
    const tag = document.createElement('div');
    tag.className = 'arrow-label';
    tag.append(makeThumb(thumb, 24), textSpan(label));
    this.layer.append(tag);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'exit-chip';
    const chipText = textSpan('');
    chip.append(makeThumb(thumb, 22), chipText);
    chip.addEventListener('click', () => this.h.onLink(link));
    this.exits?.append(chip);
    const item = { kind: 'link', data: link, el: g, disc, chev, tag, chip, chipText, label, thumb };
    this._wire(item, g, () => this.h.onLink(link));
    // マウスを乗せる・キーボードで選ぶと、行き先の写真を大きめに見せる
    const showCard = () => {
      if (!thumb || this.h.isEditing()) return;
      setThumb(this.card.firstChild, thumb, 200, 112);
      this.card.lastChild.textContent = label;
      this.card.hidden = false;
      this.cardFor = item;
      this.update();
    };
    const hideCard = () => { if (this.cardFor === item) { this.card.hidden = true; this.cardFor = null; } };
    g.addEventListener('mouseenter', showCard);
    g.addEventListener('mouseleave', hideCard);
    g.addEventListener('focus', showCard);
    g.addEventListener('blur', hideCard);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.h.onLink(link); });
    this.items.push(item);
  }

  _addPin(pin) {
    const b = document.createElement('button');
    b.className = 'pin';
    b.type = 'button';
    b.setAttribute('aria-label', pin.title || t('pin.default'));
    b.innerHTML = '<span class="pin-ring"></span><span class="pin-dot"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="1.6"/><rect x="10.6" y="10" width="2.8" height="8" rx="1.4"/></svg></span>';
    const label = document.createElement('span');
    label.className = 'pin-label';
    label.textContent = pin.title || '';
    b.append(label);
    this.layer.append(b);
    const item = { kind: 'pin', data: pin, el: b };
    this._wire(item, b, () => this.h.onPin(pin));
    b.addEventListener('click', (e) => { if (e.detail === 0 && !this.h.isEditing()) this.h.onPin(pin); });
    this.items.push(item);
  }

  // 見るとき：クリックで実行。編集のとき：ドラッグで動かし、動かさずに離したら編集画面。
  _wire(item, el, action) {
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ }
      start = { x: e.clientX, y: e.clientY, moved: false };
    });
    el.addEventListener('pointermove', (e) => {
      if (!start || !this.h.isEditing()) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) start.moved = true;
      if (!start.moved) return;
      const d = this.viewer.dirAt(e.clientX, e.clientY);
      item.data.yaw = round1(wrapDeg(d.yaw - (this.node.heading || 0)));
      item.data.pitch = round1(item.kind === 'link' ? Math.min(d.pitch, -8) : d.pitch);
      this.update();
    });
    el.addEventListener('pointerup', (e) => {
      if (!start) return;
      const s = start;
      start = null;
      if (this.h.isEditing()) {
        if (s.moved) this.h.onMoved();
        else this.h.onEdit(item.kind, item.data);
      } else if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) {
        action();
      }
    });
    el.addEventListener('pointercancel', () => { start = null; });
  }

  update() {
    if (!this.node) return;
    if (this.exits) this.exits.style.bottom = `${Math.max(0, this.viewer.ch - (this.h.safeBottom?.() ?? this.viewer.ch)) + 8}px`;
    const v = this.viewer;
    const head = this.node.heading || 0;
    // ここより下は下の操作（と、その上の行き先ボタンの列）に隠れる
    // 矢印は下の操作（ドック）だけを基準にする。行き先ボタンの列を基準にすると、
    // 「矢印が隠れる → ボタンが出る → 列が場所を取る → さらに隠れる」の堂々めぐりになるため。
    // ピンと矢印の名前は、行き先ボタンの列とも重ならないようにする
    const dock = Math.min(v.ch, this.h.safeBottom?.() ?? v.ch);
    const exitsH = this.exits && !this.exits.hidden ? this.exits.offsetHeight : 0;
    const safe = dock - (exitsH ? exitsH + 8 : 0);
    for (const it of this.items) {
      const wy = (it.data.yaw || 0) + head;
      if (it.kind === 'pin') {
        const p = v.project(dirVec(wy, it.data.pitch || 0));
        const show = p && p.x > -20 && p.x < v.cw + 20 && p.y > -20 && p.y < safe - 16;
        it.el.style.visibility = show ? 'visible' : 'hidden';
        if (show) it.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        continue;
      }
      // 床の上の位置：pitch から距離を出す
      const pitch = Math.min(it.data.pitch ?? -30, -3);
      const dist = Math.min(EYE / Math.tan(-pitch * RAD), 12);
      const k = 0.55 + dist * 0.07; // 遠いほど少し大きく
      const s = Math.sin(wy * RAD), c = Math.cos(wy * RAD);
      const fwd = [s, 0, -c], side = [c, 0, s];
      const center = [fwd[0] * dist, -EYE, fwd[2] * dist];
      const toScreen = (pts) => {
        const out = [];
        for (const [x, f] of pts) {
          const q = v.project([
            center[0] + (side[0] * x + fwd[0] * f) * k,
            -EYE,
            center[2] + (side[2] * x + fwd[2] * f) * k,
          ]);
          if (!q) return null;
          out.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
        }
        return out.join(' ');
      };
      const disc = toScreen(DISC);
      const chev = disc && toScreen(CHEVRON);
      const c0 = v.project(center);
      const show = !!(disc && chev && c0 && c0.x > 24 && c0.x < v.cw - 24 && c0.y > 0 && c0.y < dock - 28);
      it.el.style.display = show ? '' : 'none';
      it.tag.style.visibility = show ? 'visible' : 'hidden';
      // 見えていない行き先は、下の操作の上にボタンで出す（← 左／→ 右／↓ 足もと）
      if (it.chip) {
        it.chip.hidden = show;
        if (!show) {
          const d = wrapDeg(wy - v.yaw);
          const below = Math.abs(d) < v.hfov() / 2;
          it.chipText.textContent = below ? `↓ ${it.label}` : d < 0 ? `← ${it.label}` : `${it.label} →`;
          const box = below ? this.exits : this.sides[d < 0 ? 'left' : 'right'];
          if (box && it.chip.parentNode !== box) box.append(it.chip);
        }
      }
      if (!show) continue;
      it.disc.setAttribute('points', disc);
      it.chev.setAttribute('points', chev);
      const below = v.project([center[0] - fwd[0] * 0.7 * k, -EYE, center[2] - fwd[2] * 0.7 * k]) || c0;
      const ty = Math.max(below.y, c0.y) + 6;
      it.tag.style.visibility = ty < safe - 24 ? 'visible' : 'hidden';
      it.tag.style.transform = `translate(${below.x}px, ${ty}px) translateX(-50%)`;
      if (this.cardFor === it) this.card.style.transform = `translate(${c0.x}px, ${Math.min(...disc.split(' ').map((q) => +q.split(',')[1])) - 10}px) translate(-50%, -100%)`;
    }
  }

  // おすすめの矢印（次の部屋への道）を光らせる
  suggest() {
    const to = this.h.isEditing?.() ? null : this.h.suggestTo?.();
    for (const it of this.items) {
      if (it.kind !== 'link') continue;
      const on = !!to && it.data.to === to;
      it.el.classList.toggle('suggest', on);
      it.tag.classList.toggle('suggest', on);
      it.chip.classList.toggle('suggest', on);
    }
  }
}

function textSpan(s) {
  const e = document.createElement('span');
  e.textContent = s;
  return e;
}

// 行き先の 360 度写真（下見用）の、着いたときに見える方向あたりを丸く切り抜いて見せる
function makeThumb(thumb, size) {
  const e = document.createElement('span');
  e.className = 'arrow-thumb';
  if (thumb) setThumb(e, thumb, size, size);
  else e.hidden = true;
  return e;
}

function setThumb(e, { url, x }, w, h) {
  // 横に 60 度ぶん見えるように拡大し、行き先で正面になる方向を真ん中に置く
  const scale = 6; // 360 / 60
  const iw = w * scale;
  const ih = iw / 2;
  const left = Math.max(0, Math.min(iw - w, x * iw - w / 2));
  e.style.width = `${w}px`;
  e.style.height = `${h}px`;
  e.style.backgroundImage = `url("${url}")`;
  e.style.backgroundSize = `${iw}px ${ih}px`;
  e.style.backgroundPosition = `${-left}px ${-(ih - h) / 2}px`;
}

function round1(x) { return Math.round(x * 10) / 10; }
