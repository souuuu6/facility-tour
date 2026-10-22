// 見取り図。小さい表示（今いる場所のまわり）と、大きい表示（全体・点を押して移動）の 2 通り。

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export class Minimap {
  // opts: { full, loader, onSelect(id), onPlace(x, y) }
  constructor(container, opts) {
    this.c = container;
    this.o = opts;
    this.placing = false;
  }

  build(tour) {
    this.tour = tour;
    const fp = tour.floorplan;
    this.c.replaceChildren();
    if (!fp || !fp.image) { this.svg = null; return; }
    const W = fp.width || 1000, H = fp.height || 1000;
    this.W = W; this.H = H;
    const M = Math.max(W, H);
    this.unit = this.o.full ? M / 90 : M / 120; // 点の大きさの基準
    const svg = el('svg', { class: 'map-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
    svg.append(el('rect', { x: 0, y: 0, width: W, height: H, class: 'map-paper' }));
    const img = el('image', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'xMidYMid meet' });
    img.setAttribute('href', this.o.loader.url(fp.image));
    svg.append(img);

    // 地点どうしのつながり（うすい線）
    const byId = new Map(tour.nodes.map((n) => [n.id, n]));
    const edges = el('g', { class: 'map-edges' });
    const seen = new Set();
    for (const n of tour.nodes) {
      for (const l of n.links || []) {
        const m = byId.get(l.to);
        const key = [n.id, l.to].sort().join('|');
        if (!m || !n.map || !m.map || seen.has(key)) continue;
        seen.add(key);
        edges.append(el('line', { x1: n.map.x, y1: n.map.y, x2: m.map.x, y2: m.map.y, 'stroke-width': this.unit * 0.35 }));
      }
    }
    svg.append(edges);

    this.cone = el('path', { class: 'map-cone' });
    svg.append(this.cone);

    this.dots = new Map();
    for (const n of tour.nodes) {
      if (!n.map) continue;
      const g = el('g', { class: 'map-dot', transform: `translate(${n.map.x} ${n.map.y})` });
      const t = el('title');
      t.textContent = n.name || n.id;
      g.append(t, el('circle', { r: this.unit * (this.o.full ? 2.4 : 2) }), el('circle', { class: 'hit', r: this.unit * 4.5 }));
      if (this.o.full) {
        g.addEventListener('click', (e) => {
          if (this.placing) return;
          e.stopPropagation();
          this.o.onSelect?.(n.id);
        });
      }
      this.dots.set(n.id, g);
      edges.after(g);
    }
    this.me = el('circle', { class: 'map-me', r: this.unit * 2.6 });
    svg.append(this.me);

    if (this.o.full) {
      svg.addEventListener('click', (e) => {
        if (!this.placing) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        this.o.onPlace?.(Math.round(p.x), Math.round(p.y));
      });
    }
    this.svg = svg;
    this.c.append(svg);
    if (!this.o.full) { this.name = document.createElement('span'); this.name.className = 'map-name'; this.c.append(this.name); }
  }

  update(node, worldYaw, hfov) {
    if (!this.svg) return;
    for (const [id, g] of this.dots) g.classList.toggle('current', id === node?.id);
    if (this.name) this.name.textContent = node ? node.room || node.name || '' : '';
    const m = node?.map;
    this.me.style.display = this.cone.style.display = m ? '' : 'none';
    if (!m) {
      this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
      return;
    }
    this.me.setAttribute('cx', m.x);
    this.me.setAttribute('cy', m.y);
    const R = this.unit * (this.o.full ? 11 : 13);
    const half = Math.min(hfov, 110) / 2;
    const a0 = ((worldYaw - half - 90) * Math.PI) / 180, a1 = ((worldYaw + half - 90) * Math.PI) / 180;
    const p = (a) => `${(m.x + Math.cos(a) * R).toFixed(1)} ${(m.y + Math.sin(a) * R).toFixed(1)}`;
    this.cone.setAttribute('d', `M ${m.x} ${m.y} L ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)} Z`);
    if (!this.o.full) {
      const S = Math.min(this.W, this.H) * 0.5;
      this.svg.setAttribute('viewBox', `${m.x - S / 2} ${m.y - S / 2} ${S} ${S}`);
    }
  }

  setPlacing(on) {
    this.placing = on;
    this.c.classList.toggle('placing', on);
  }
}
