// 編集モード（?edit=1）。写真をクリックしてピンや矢印を置き、JSON に書き出す。
// 作業中の内容はブラウザに下書きとして自動で残る（同じ施設をもう一度開くと続きから）。

import { wrapDeg } from './viewer.js';
import { $, h, openSheet, closeSheet, toast } from './ui.js';
import { runChecks, referencedFiles, hasExif } from './checks.js';
import { makeZip } from './zip.js';

const r1 = (x) => Math.round(x * 10) / 10;
const TOOLS = [
  ['view', '見て試す', '矢印で歩けます。置いたものは動きません。'],
  ['edit', '動かす・直す', '矢印やピンをドラッグで動かせます。押すと中身を直せます。'],
  ['pin', 'ピンを置く', '写真の上をクリックすると、そこに解説ピンを置きます。'],
  ['arrow', '矢印を置く', '床をクリックすると、そこに移動の矢印を置きます。'],
];

export class Editor {
  constructor(app, fn) {
    this.app = app;
    this.fn = fn; // { goTo, refresh, showMap }
    this.tool = 'edit';
    this.key = `tour-draft:${app.fid}`;
    document.body.classList.add('editing');
    this.panel = h('aside', { id: 'editor', 'aria-label': '編集' });
    document.body.append(this.panel);
    this._bindDrop();
    this.render();
  }

  active() { return this.tool !== 'view'; }

  loadDraft(tour) {
    try {
      const s = localStorage.getItem(this.key);
      if (s) {
        toast('前回の下書きから続けます（「下書きを捨てる」で元に戻せます）', 4500);
        const t = JSON.parse(s);
        for (const n of t.nodes || []) { n.links ||= []; n.pins ||= []; n.heading = +n.heading || 0; }
        return t;
      }
    } catch { /* 下書きが壊れていたら使わない */ }
    return tour;
  }

  // render: false にすると編集パネルは描き直さない（入力欄のフォーカスを保つ）
  changed({ refresh = false, render = true } = {}) {
    try { localStorage.setItem(this.key, JSON.stringify(this.app.tour)); } catch { /* 保存できなくても続ける */ }
    if (refresh) this.fn.refresh();
    else this.app.overlay.update();
    if (render) this.render();
  }

  nodeChanged() { this.render(); }

  // ---- 写真の上をクリックしたとき ----
  tap(e) {
    const node = this.app.node;
    if (!node || (this.tool !== 'pin' && this.tool !== 'arrow')) return;
    const d = this.app.viewer.dirAt(e.clientX, e.clientY);
    const yaw = r1(wrapDeg(d.yaw - node.heading));
    if (this.tool === 'pin') this.pinForm(null, { yaw, pitch: r1(d.pitch) });
    else this.arrowForm(null, { yaw, pitch: r1(Math.min(d.pitch, -8)) });
  }

  editMarker(kind, item) {
    if (kind === 'pin') this.pinForm(item);
    else this.arrowForm(item);
  }

  // ---- ピンの入力 ----
  pinForm(pin, pos) {
    const node = this.app.node;
    const title = h('input', { type: 'text', value: pin?.title || '', placeholder: '例：0歳児のお部屋' });
    const text = h('textarea', { rows: 5, placeholder: '解説の文。言い切りや「地域No.1」のような比較の表現は避けます。' }, pin?.text || '');
    const image = h('input', { type: 'text', value: pin?.image || '', placeholder: 'photos/xxx.jpg（なくても可）' });
    const file = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' });
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const path = `photos/${f.name}`;
      this.app.loader.addLocal(path, f);
      image.value = path;
      toast(`書き出したら、この写真を photos フォルダに入れてください`);
    });
    const save = () => {
      const data = pin || { ...pos };
      data.title = title.value.trim();
      data.text = text.value.trim();
      if (image.value.trim()) data.image = image.value.trim(); else delete data.image;
      if (!pin) node.pins.push(data);
      closeSheet();
      this.changed({ refresh: true });
    };
    const body = h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); save(); } },
      field('タイトル', title),
      field('説明文', text),
      field('写真（任意）', h('div', { class: 'row' }, image, h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'えらぶ'), file)),
      h('div', { class: 'row end' },
        pin ? h('button', { type: 'button', class: 'btn danger', onclick: () => { node.pins.splice(node.pins.indexOf(pin), 1); closeSheet(); this.changed({ refresh: true }); } }, '消す') : null,
        h('button', { type: 'submit', class: 'btn primary' }, pin ? '保存' : 'ピンを置く')));
    openSheet({ title: pin ? 'ピンを直す' : '解説ピンを置く', body });
    setTimeout(() => title.focus(), 50);
  }

  // ---- 矢印の入力 ----
  arrowForm(link, pos) {
    const app = this.app, node = app.node;
    const others = app.tour.nodes.filter((n) => n.id !== node.id);
    if (!others.length) {
      toast('行き先になる地点がまだありません。先に写真を追加してください。');
      return;
    }
    const to = h('select', {}, others.map((n) => h('option', { value: n.id, selected: link?.to === n.id }, label(n))));
    const back = h('input', { type: 'checkbox', checked: true });
    const save = () => {
      const data = link || { ...pos };
      data.to = to.value;
      if (!link) {
        node.links.push(data);
        const target = app.byId(data.to);
        if (back.checked && !target.links.some((l) => l.to === node.id)) {
          // 反対向きの矢印。見取り図の向き（heading）を合わせてあればだいたい正しい位置に出る
          target.links.push({ to: node.id, yaw: r1(wrapDeg(data.yaw + node.heading + 180 - target.heading)), pitch: data.pitch });
        }
      }
      closeSheet();
      this.changed({ refresh: true });
    };
    const body = h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); save(); } },
      field('行き先', to),
      link ? null : h('label', { class: 'check' }, back, '行き先にも、ここへ戻る矢印を置く'),
      link ? null : h('p', { class: 'muted small' }, '戻る矢印の位置は、行き先で「動かす・直す」から調整できます。'),
      h('div', { class: 'row end' },
        link ? h('button', { type: 'button', class: 'btn', onclick: () => { closeSheet(); this.fn.goTo(link.to, { link }); } }, 'この矢印で進む') : null,
        link ? h('button', { type: 'button', class: 'btn danger', onclick: () => { node.links.splice(node.links.indexOf(link), 1); closeSheet(); this.changed({ refresh: true }); } }, '消す') : null,
        h('button', { type: 'submit', class: 'btn primary' }, link ? '保存' : '矢印を置く')));
    openSheet({ title: link ? '矢印を直す' : '移動の矢印を置く', body });
  }

  placeOnMap(x, y) {
    if (!this.app.node) return;
    this.app.node.map = { x, y };
    closeSheet();
    this.changed({ refresh: true });
    toast('位置を決めました。次に「見取り図の向き」を合わせてください。');
  }

  // ---- 写真の追加 ----
  addPhotos(files) {
    const app = this.app;
    const added = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const path = `panos/${f.name}`;
      app.loader.addLocal(path, f);
      const exist = app.tour.nodes.find((n) => n.image === path);
      if (exist) continue;
      const base = f.name.replace(/\.[^.]+$/, '');
      let id = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'spot';
      let k = 2;
      const stem = id;
      while (app.byId(id)) id = `${stem}-${k++}`;
      const node = { id, name: base, image: path, heading: 0, links: [], pins: [] };
      app.tour.nodes.push(node);
      added.push(node);
    }
    if (!added.length) return;
    // 撮影情報（位置情報を含むことがある）が残っていないか
    Promise.all(added.map(async (n) => {
      const f = app.loader.local.get(n.image)?.file;
      return f && hasExif(new Uint8Array(await f.slice(0, 65536).arrayBuffer())) ? n.image : null;
    })).then((list) => {
      const bad = list.filter(Boolean);
      if (bad.length) toast(`撮影情報（位置情報を含むことがある）が残った写真があります：${bad.join('、')}。公開前に tools/prepare_photos.py を通してください。`, 8000);
    });
    if (!app.tour.start) app.tour.start = added[0].id;
    this.changed({ refresh: true });
    toast(`${added.length} 枚を地点として追加しました。書き出したら写真を panos フォルダに入れてください。`, 5000);
    if (!app.node) this.fn.goTo(added[0].id, { initial: true });
  }

  setFloorplan(f) {
    const path = f.name;
    this.app.loader.addLocal(path, f);
    const img = new Image();
    img.onload = () => {
      this.app.tour.floorplan = { image: path, width: img.naturalWidth || 1000, height: img.naturalHeight || 1000 };
      this.changed({ refresh: true });
      toast('見取り図を設定しました。書き出したら、施設フォルダに入れてください。');
    };
    img.src = this.app.loader.url(path);
  }

  _bindDrop() {
    window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      document.body.classList.remove('dropping');
      this.addPhotos([...e.dataTransfer.files]);
    });
  }

  // ---- 書き出し・読み込み ----
  json() {
    // 編集パネルが用意しただけの空の枠は書き出さない
    const empty = (v) => v && typeof v === 'object' && (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);
    const skip = new Set(['contact', 'reserve', 'analytics', 'guides']);
    const out = JSON.stringify(this.app.tour, (k, v) => {
      if (!skip.has(k) || !v || typeof v !== 'object') return v;
      if (!Array.isArray(v)) v = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && !empty(x)));
      return empty(v) ? undefined : v;
    }, 2);
    return out + '\n';
  }

  // 写真を差し替えたときに古い写真が残らないよう、書き出すたびに版番号を新しくする
  bumpRev() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    this.app.tour.rev = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
    try { localStorage.setItem(this.key, JSON.stringify(this.app.tour)); } catch { /* 無視 */ }
  }

  download() {
    this.bumpRev();
    const a = h('a', { href: URL.createObjectURL(new Blob([this.json()], { type: 'application/json' })), download: 'tour.json' });
    document.body.append(a);
    a.click();
    a.remove();
    toast(`tour.json を書き出しました。facilities/${this.app.fid}/ に置き換えてください。`, 5000);
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.json());
      toast('JSON をコピーしました');
    } catch {
      openSheet({ title: 'JSON', body: h('textarea', { class: 'json-out', rows: 18, readOnly: true }, this.json()) });
    }
  }

  importJson(f) {
    f.text().then((s) => {
      const t = JSON.parse(s);
      if (!Array.isArray(t.nodes)) throw new Error('nodes がありません');
      for (const n of t.nodes) { n.links ||= []; n.pins ||= []; n.heading = +n.heading || 0; }
      this.app.tour = t;
      this.app.node = null;
      this.changed({ refresh: true });
      if (t.nodes.length) this.fn.goTo(t.start || t.nodes[0].id, { initial: true });
      toast('JSON を読み込みました');
    }).catch((e) => toast(`読み込めませんでした：${e.message}`));
  }

  discardDraft() {
    if (!confirm('ブラウザに残っている下書きを捨てて、tour.json の内容に戻します。よろしいですか？')) return;
    try { localStorage.removeItem(this.key); } catch { /* 無視 */ }
    location.reload();
  }

  move(list, i, d) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.changed({ refresh: true });
  }

  setLogo(f) {
    const path = `logo.${(f.name.split('.').pop() || 'png').toLowerCase()}`;
    this.app.loader.addLocal(path, f);
    this.app.tour.logo = path;
    this.changed({ refresh: true });
    toast(`書き出したら、ロゴを ${path} という名前で施設フォルダに入れてください（ZIP なら自動で入ります）`, 5000);
  }

  // ---- 自動ガイド ----
  stepForm(step) {
    const app = this.app, node = app.node;
    const text = h('textarea', { rows: 4, placeholder: '例：0歳児のお部屋です。大きな窓から光が入ります。' }, step?.text || '');
    const ms = h('input', { type: 'text', value: step?.ms ? String(step.ms / 1000) : '', placeholder: '空なら文の長さに合わせます' });
    const save = () => {
      const data = step || { node: node.id, look: [r1(wrapDeg(app.viewer.yaw - node.heading)), r1(app.viewer.pitch)] };
      data.text = text.value.trim();
      const sec = parseFloat(ms.value);
      if (sec > 0) data.ms = Math.round(sec * 1000); else delete data.ms;
      if (!step) this.editGuide().steps.push(data);
      closeSheet();
      this.changed();
    };
    const body = h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); save(); } },
      step ? h('p', { class: 'muted small' }, `地点：${label(app.byId(step.node) || { id: step.node })}`) : h('p', { class: 'muted small' }, `地点：${label(node)}（今見ている向きで案内します）`),
      field('案内の文', text),
      field('見せる秒数（任意）', ms),
      h('div', { class: 'row end' },
        step ? h('button', { type: 'button', class: 'btn', onclick: () => {
          if (app.node?.id !== step.node) { toast('その地点へ移動してから押してください'); return; }
          step.look = [r1(wrapDeg(app.viewer.yaw - app.node.heading)), r1(app.viewer.pitch)];
          toast('今の向きにしました');
        } }, '向きを今の向きにする') : null,
        step ? h('button', { type: 'button', class: 'btn danger', onclick: () => { const st = this.editGuide().steps; st.splice(st.indexOf(step), 1); closeSheet(); this.changed(); } }, '消す') : null,
        h('button', { type: 'submit', class: 'btn primary' }, step ? '保存' : '追加')));
    openSheet({ title: step ? '案内を直す' : '案内を追加', body });
    setTimeout(() => text.focus(), 50);
  }

  // 編集しているガイド（なければ 1 本目を作る）
  editGuide() {
    const t = this.app.tour;
    t.guides ||= [];
    if (!t.guides.length) t.guides.push({ id: 'tour', title: 'ひとめぐり', steps: [] });
    this.gi = Math.min(this.gi || 0, t.guides.length - 1);
    return t.guides[this.gi];
  }

  tryGuide(i) {
    this.tool = 'view';
    this.render();
    this.app.guide.start(i, this.gi || 0);
  }

  // ---- 公開前チェック ----
  async check() {
    const body = h('div', { class: 'checks' }, h('p', { class: 'muted' }, '確かめています…'));
    openSheet({ title: '公開前チェック', body });
    const res = await runChecks(this.app.tour, this.app.loader);
    const order = { error: 0, warn: 1, info: 2 };
    res.sort((a, b) => order[a.level] - order[b.level]);
    const n = (lv) => res.filter((r) => r.level === lv).length;
    const mark = { error: '要対応', warn: '確認', info: 'メモ' };
    body.replaceChildren(
      h('p', { class: 'check-sum' }, res.length ? `要対応 ${n('error')} 件・確認 ${n('warn')} 件・メモ ${n('info')} 件` : '問題は見つかりませんでした。'),
      h('ul', { class: 'check-list' }, res.map((r) => h('li', { class: r.level },
        h('span', { class: 'lv' }, mark[r.level]), h('span', {}, r.where ? h('strong', {}, `${r.where}：`) : null, r.text)))),
      h('p', { class: 'muted small' }, '言葉づかいの確認は機械的な目安です。最終的な表現は施設の方と確かめてください。'));
  }

  // ---- 納品用 ZIP：tour.json と、使っている写真・見取り図・ロゴをまとめる ----
  async zip() {
    const app = this.app, fid = app.fid;
    this.bumpRev();
    toast('ファイルを集めています…', 8000);
    const files = [{ name: `${fid}/tour.json`, data: new TextEncoder().encode(this.json()) }];
    const missing = [];
    const extra = (app.tour.languages || []).map((l) => `tour.${l}.json`);
    for (const path of [...referencedFiles(app.tour), ...extra]) {
      try {
        const b = await app.loader.blob(path);
        files.push({ name: `${fid}/${path}`, data: new Uint8Array(await b.arrayBuffer()) });
      } catch {
        missing.push(path);
      }
    }
    const a = h('a', { href: URL.createObjectURL(makeZip(files)), download: `${fid}.zip` });
    document.body.append(a);
    a.click();
    a.remove();
    toast(missing.length ? `${fid}.zip を書き出しました。見つからなかったファイル：${missing.join('、')}` : `${fid}.zip を書き出しました（${files.length} ファイル）。facilities/ に展開すれば公開できます。`, 7000);
  }

  // ---- 地点の削除 ----
  removeNode(node) {
    const app = this.app;
    if (!confirm(`地点「${label(node)}」を消します。ここへ向かう矢印も消えます。よろしいですか？`)) return;
    app.tour.nodes = app.tour.nodes.filter((n) => n !== node);
    for (const n of app.tour.nodes) n.links = n.links.filter((l) => l.to !== node.id);
    for (const g of app.tour.guides || []) g.steps = g.steps.filter((s) => s.node !== node.id);
    if (app.tour.start === node.id) app.tour.start = app.tour.nodes[0]?.id;
    const next = app.tour.nodes[0];
    app.node = null;
    this.changed({ refresh: true });
    if (next) this.fn.goTo(next.id, { initial: true });
  }

  // ---- パネルの描画 ----
  render() {
    const app = this.app, t = app.tour, node = app.node;
    const open = this.panel.classList.contains('collapsed') ? false : true;
    const tools = h('div', { class: 'seg' }, TOOLS.map(([k, name]) =>
      h('button', { type: 'button', class: k === this.tool ? 'on' : '', 'aria-pressed': String(k === this.tool), onclick: () => { this.tool = k; this.render(); } }, name)));
    const tip = TOOLS.find((x) => x[0] === this.tool)[2];

    const sections = [];

    if (node) {
      const heading = h('input', { type: 'range', min: -180, max: 180, step: 1, value: node.heading,
        oninput: (e) => { app.viewer.setHeading(+e.target.value); node.heading = +e.target.value; headVal.textContent = `${node.heading}°`; app.overlay.update(); },
        onchange: () => this.changed() });
      const headVal = h('span', { class: 'val' }, `${node.heading}°`);
      sections.push(h('section', {},
        h('h3', {}, 'この地点'),
        field('名前（画面の上に出る）', h('input', { type: 'text', value: node.name || '', onchange: (e) => { node.name = e.target.value.trim(); this.changed({ refresh: true, render: false }); } })),
        field('部屋名（「お部屋」の一覧に出す。廊下などは空に）', h('input', { type: 'text', value: node.room || '', onchange: (e) => { const v = e.target.value.trim(); if (v) node.room = v; else delete node.room; this.changed({ refresh: true, render: false }); } })),
        field('写真', h('input', { type: 'text', value: node.image || '', onchange: (e) => { node.image = e.target.value.trim(); this.changed(); } })),
        field('下見用の小さい写真（任意）', h('input', { type: 'text', value: node.preview || '', placeholder: 'panos/xxx_s.jpg', onchange: (e) => { const v = e.target.value.trim(); if (v) node.preview = v; else delete node.preview; this.changed(); } })),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', disabled: !t.floorplan?.image, onclick: () => this.fn.showMap({ placing: true }) }, node.map ? '見取り図の位置を直す' : '見取り図で位置を決める'),
          h('button', { type: 'button', class: 'btn', onclick: () => { node.startYaw = r1(wrapDeg(app.viewer.yaw - node.heading)); this.changed(); toast('今の向きを、この地点の最初の向きにしました'); } }, '今の向きを最初の向きに')),
        field(h('span', {}, '見取り図の向き合わせ ', headVal), heading),
        h('p', { class: 'muted small' }, '見取り図の扇形が、写真で見ている方向と同じになるように動かします。'),
        h('button', { type: 'button', class: 'btn danger ghost', onclick: () => this.removeNode(node) }, 'この地点を消す')));

      const items = [
        ...node.links.map((l) => h('li', {}, h('span', { class: 'kind kind-arrow' }, '矢印'), h('span', {}, `${label(app.byId(l.to) || { id: l.to })} へ`),
          h('button', { type: 'button', class: 'btn tiny', onclick: () => this.arrowForm(l) }, '直す'))),
        ...node.pins.map((p) => h('li', {}, h('span', { class: 'kind kind-pin' }, 'ピン'), h('span', {}, p.title || '（無題）'),
          h('button', { type: 'button', class: 'btn tiny', onclick: () => app.viewer.lookAt(p.yaw + node.heading, p.pitch) }, '見る'),
          h('button', { type: 'button', class: 'btn tiny', onclick: () => this.pinForm(p) }, '直す'))),
      ];
      sections.push(h('section', {}, h('h3', {}, 'この地点の矢印とピン'),
        items.length ? h('ul', { class: 'items' }, items) : h('p', { class: 'muted small' }, 'まだありません。上の「ピンを置く」「矢印を置く」から置けます。')));
    }

    const photoInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', onchange: (e) => this.addPhotos([...e.target.files]) });
    sections.push(h('section', {}, h('h3', {}, `地点（${t.nodes.length}）`),
      h('ul', { class: 'items nodes' }, t.nodes.map((n, i) => h('li', { class: n === node ? 'current' : '' },
        h('button', { type: 'button', class: 'link', onclick: () => this.fn.goTo(n.id) }, label(n)),
        h('button', { type: 'button', class: 'btn tiny', 'aria-label': '上へ', disabled: i === 0, onclick: () => this.move(t.nodes, i, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn tiny', 'aria-label': '下へ', disabled: i === t.nodes.length - 1, onclick: () => this.move(t.nodes, i, 1) }, '↓'),
        h('span', { class: 'muted small sub' }, `矢印${n.links.length}・ピン${n.pins.length}${n.map ? '' : '・位置なし'}`)))),
      h('p', { class: 'muted small' }, '↑↓ の順番が、「お部屋」の一覧と ‹ › で進む順番になります。'),
      h('button', { type: 'button', class: 'btn', onclick: () => photoInput.click() }, '360度写真を追加'), photoInput,
      h('p', { class: 'muted small' }, '写真をこの画面にドラッグ＆ドロップしても追加できます。1 枚が 1 地点になります。')));

    const fpInput = h('input', { type: 'file', accept: 'image/*,.svg', class: 'visually-hidden', onchange: (e) => e.target.files[0] && this.setFloorplan(e.target.files[0]) });
    const logoInput = h('input', { type: 'file', accept: 'image/*,.svg', class: 'visually-hidden', onchange: (e) => e.target.files[0] && this.setLogo(e.target.files[0]) });
    const text = (label_, get, set, placeholder = '') => field(label_, h('input', { type: 'text', value: get() || '', placeholder,
      onchange: (e) => { set(e.target.value.trim()); this.changed({ refresh: true, render: false }); } }));
    t.contact ||= {};
    const c = t.contact;
    const setOrDel = (obj, k) => (v) => { if (v) obj[k] = v; else delete obj[k]; };
    sections.push(h('section', {}, h('h3', {}, '施設の看板'),
      text('キャッチコピー（ようこそ画面に出る）', () => t.tagline, setOrDel(t, 'tagline'), '例：0〜5歳の子どもたちが、のびのび過ごす保育園です。'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => logoInput.click() }, t.logo ? 'ロゴを差し替える' : 'ロゴの画像をえらぶ'), logoInput,
        t.logo ? h('button', { type: 'button', class: 'btn danger ghost', onclick: () => { delete t.logo; this.changed({ refresh: true }); } }, 'ロゴを外す') : null),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!t.sample, onchange: (e) => { t.sample = e.target.checked; this.changed({ refresh: true }); } }), '「サンプル」と表示する（営業用のデモ）'),
      text('「このツアーについて」に出す写真の説明（任意）', () => t.credit, setOrDel(t, 'credit'))));

    sections.push(h('section', {}, h('h3', {}, '問い合わせボタン'),
      text('予約ボタンの文字', () => c.reserve?.label, (v) => { c.reserve ||= {}; setOrDel(c.reserve, 'label')(v); }, '見学を予約する'),
      text('予約ページの URL', () => c.reserve?.url, (v) => { c.reserve ||= {}; setOrDel(c.reserve, 'url')(v); }, 'https://...'),
      text('予約の補足', () => c.reserve?.note, (v) => { c.reserve ||= {}; setOrDel(c.reserve, 'note')(v); }, '例：平日 10:00〜16:00'),
      text('電話番号', () => c.tel, setOrDel(c, 'tel'), '例：03-1234-5678'),
      text('電話の受付時間', () => c.hours, setOrDel(c, 'hours')),
      text('地図の URL（Google マップの共有リンクなど）', () => c.map, setOrDel(c, 'map'), 'https://...'),
      text('住所（地図の下に出る）', () => c.address, setOrDel(c, 'address')),
      text('ホームページの URL', () => c.web, setOrDel(c, 'web'), 'https://...'),
      text('Google アナリティクスの測定 ID（任意）', () => t.analytics?.ga4, (v) => { t.analytics ||= {}; setOrDel(t.analytics, 'ga4')(v); }, 'G-XXXXXXXXXX'),
      h('p', { class: 'muted small' }, 'URL は https:// から始まるものだけが使われます。空の項目のボタンは出ません。')));

    // はじめての方へ（受付時間・お休み・持ち物・流れ）
    const info = t.info || {};
    const setInfo = (k, v) => {
      t.info ||= {};
      if (v == null || (Array.isArray(v) ? !v.length : v === '')) delete t.info[k]; else t.info[k] = v;
      if (!Object.keys(t.info).length) delete t.info;
      this.changed({ refresh: true, render: false });
    };
    const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const area = (label_, value, onchange, placeholder) => field(label_, h('textarea', { rows: 3, placeholder, onchange: (e) => onchange(e.target.value) }, value));
    sections.push(h('section', {}, h('h3', {}, 'はじめての方へ'),
      text('見出し', () => info.title, (v) => setInfo('title', v), 'はじめての方へ'),
      area('受付時間（1 行に「曜日｜時間」）', (info.hours || []).map((r) => r.join('｜')).join('\n'),
        (v) => setInfo('hours', lines(v).map((l) => { const [a, ...b] = l.split(/[｜|]/); return [a.trim(), b.join('｜').trim()]; })), '平日｜9:00〜12:00／15:00〜18:00'),
      text('お休み', () => info.closed, (v) => setInfo('closed', v), '例：日曜・祝日'),
      area('持ち物（1 行に 1 つ）', (info.bring || []).join('\n'), (v) => setInfo('bring', lines(v)), '保険証'),
      area('流れ（1 行に 1 つ）', (info.steps || []).join('\n'), (v) => setInfo('steps', lines(v)), 'ネットか電話で予約'),
      text('ひとこと', () => info.note, (v) => setInfo('note', v)),
      text('いつ時点の情報か', () => info.updated, (v) => setInfo('updated', v), '例：2026年10月'),
      h('p', { class: 'muted small' }, '入れた項目は「問い合わせ」と「その他」に出ます。古くならないよう、見直す時期を施設の方と決めておきます。')));

    // 自動ガイド：何本でも作れる（例：「園内をひとめぐり」「一日の流れ」）。編集するガイドをえらんで、案内を足していく
    t.guides ||= [];
    const g = this.editGuide();
    const steps = g.steps;
    const gi = t.guides.indexOf(g);
    sections.push(h('section', {}, h('h3', {}, `自動ガイド（${t.guides.length} 本）`),
      h('div', { class: 'row' },
        h('select', { 'aria-label': '編集するガイド', onchange: (e) => { this.gi = +e.target.value; this.render(); } },
          t.guides.map((x, k) => h('option', { value: k, selected: k === gi }, `${x.title || `ガイド${k + 1}`}（${x.steps.length}）`))),
        h('button', { type: 'button', class: 'btn tiny', onclick: () => { t.guides.push({ id: `g${Date.now().toString(36)}`, title: `ガイド${t.guides.length + 1}`, steps: [] }); this.gi = t.guides.length - 1; this.changed({ refresh: true }); } }, 'ガイドを増やす')),
      text('ガイドの名前（ようこそ画面とガイドの一覧に出る）', () => g.title, (v) => { g.title = v; }, '例：一日の流れ'),
      text('ひとこと説明（ガイドの一覧に出る）', () => g.desc, (v) => { if (v) g.desc = v; else delete g.desc; }, '例：登園からお迎えまでをたどります'),
      steps.length ? h('ol', { class: 'items guide-steps' }, steps.map((st, i) => h('li', {},
        h('button', { type: 'button', class: 'link', onclick: () => this.tryGuide(i) }, `${label(app.byId(st.node) || { id: st.node })}：${(st.text || '').slice(0, 18)}${(st.text || '').length > 18 ? '…' : ''}`),
        h('button', { type: 'button', class: 'btn tiny', 'aria-label': '上へ', disabled: i === 0, onclick: () => this.move(steps, i, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn tiny', 'aria-label': '下へ', disabled: i === steps.length - 1, onclick: () => this.move(steps, i, 1) }, '↓'),
        h('button', { type: 'button', class: 'btn tiny', onclick: () => this.stepForm(st) }, '直す'))))
        : h('p', { class: 'muted small' }, 'まだありません。空のままだと、部屋の順に自動で案内します。'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', disabled: !node, onclick: () => this.stepForm(null) }, '今の地点・向きを案内に追加'),
        steps.length ? h('button', { type: 'button', class: 'btn', onclick: () => this.tryGuide(0) }, '最初から試す') : null),
      h('p', { class: 'muted small' }, '案内したい方向を向いてから追加します。地点が離れていても、矢印をたどって歩いて移動します。'),
      t.guides.length > 1 ? h('button', { type: 'button', class: 'btn danger ghost', onclick: () => {
        if (!confirm(`ガイド「${g.title || ''}」を消します。よろしいですか？`)) return;
        t.guides.splice(gi, 1); this.gi = 0; this.changed({ refresh: true });
      } }, 'このガイドを消す') : null));

    sections.push(h('section', {}, h('h3', {}, '施設'),
      field('施設名', h('input', { type: 'text', value: t.name || '', onchange: (e) => { t.name = e.target.value.trim(); this.changed({ refresh: true, render: false }); } })),
      field('最初に表示する地点', h('select', { onchange: (e) => { t.start = e.target.value; this.changed(); } },
        t.nodes.map((n) => h('option', { value: n.id, selected: t.start === n.id }, label(n))))),
      field('テーマの色', h('input', { type: 'color', value: t.accent || '#2f9e83', onchange: (e) => { t.accent = e.target.value; this.changed({ refresh: true }); } })),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => fpInput.click() }, t.floorplan?.image ? '見取り図を差し替える' : '見取り図の画像をえらぶ'), fpInput)));

    const jsonInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', onchange: (e) => e.target.files[0] && this.importJson(e.target.files[0]) });
    sections.push(h('section', {}, h('h3', {}, '書き出し'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => this.check() }, '公開前チェック'),
        h('button', { type: 'button', class: 'btn', onclick: () => this.zip() }, '納品用にまとめる（ZIP）')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => this.download() }, 'tour.json を書き出す'),
        h('button', { type: 'button', class: 'btn', onclick: () => this.copy() }, 'コピー')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => jsonInput.click() }, 'JSON を読み込む'), jsonInput,
        h('button', { type: 'button', class: 'btn danger ghost', onclick: () => this.discardDraft() }, '下書きを捨てる')),
      h('p', { class: 'muted small' }, '作業中の内容はこのブラウザに自動で残ります。公開するには書き出した tour.json を施設フォルダに置きます。')));

    const scroll = this.panel.querySelector('.ed-body')?.scrollTop || 0;
    this.panel.replaceChildren(
      h('div', { class: 'ed-head' },
        h('strong', {}, '編集モード'),
        h('button', { type: 'button', class: 'btn tiny', onclick: () => { this.panel.classList.toggle('collapsed'); this.render(); } }, open ? 'たたむ' : 'ひらく')),
      h('div', { class: 'ed-body' }, tools, h('p', { class: 'tip' }, tip), ...sections));
    this.panel.querySelector('.ed-body').scrollTop = scroll;
  }
}

function field(name, input) {
  return h('label', { class: 'field' }, h('span', { class: 'field-name' }, name), input);
}

function label(n) {
  return n.room && n.name && n.room !== n.name ? `${n.name}（${n.room}）` : n.name || n.room || n.id;
}
