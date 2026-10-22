// 写真の読み込み。圧縮されたままの形（Blob）でためておき、表示する直前に画像にする。
// 先読みは同時に 2 本まで、表示に要るものを優先する。

import { t } from './i18n.js';

export class Loader {
  constructor(base) {
    this.base = base;
    this.blobs = new Map();     // path -> Blob（新しく使ったものほど後ろ）
    this.inflight = new Map();  // path -> Promise<Blob>
    this.local = new Map();     // 編集モードで手元から選んだファイル path -> { file, url }
    this.queue = [];
    this.running = 0;
    this.maxBlobs = 24;
    this.rev = ''; // tour.json の rev。写真を差し替えたとき、古い写真が残らないように URL に付ける
  }

  url(path) {
    if (!path) return '';
    if (this.local.has(path)) return this.local.get(path).url;
    if (/^(https?:|blob:|data:)/.test(path)) return path;
    return this.base + path + (this.rev ? `?v=${encodeURIComponent(this.rev)}` : '');
  }

  addLocal(path, file) {
    const old = this.local.get(path);
    if (old) URL.revokeObjectURL(old.url);
    this.local.set(path, { file, url: URL.createObjectURL(file) });
    this.blobs.delete(path);
  }

  has(path) { return this.local.has(path) || this.blobs.has(path); }

  blob(path) {
    if (this.local.has(path)) return Promise.resolve(this.local.get(path).file);
    if (this.blobs.has(path)) {
      const b = this.blobs.get(path);
      this.blobs.delete(path);
      this.blobs.set(path, b);
      return Promise.resolve(b);
    }
    if (this.inflight.has(path)) return this.inflight.get(path);
    // 20 秒で打ち切る（通信が止まったときに、ずっと待たないように）
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const p = fetch(this.url(path), { signal: ctl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`「${path}」が見つかりません（${r.status}）`);
        return r.blob();
      })
      .finally(() => clearTimeout(timer))
      .then((b) => {
        this.inflight.delete(path);
        this.blobs.set(path, b);
        while (this.blobs.size > this.maxBlobs) this.blobs.delete(this.blobs.keys().next().value);
        return b;
      }, (e) => {
        this.inflight.delete(path);
        if (e?.name === 'AbortError') throw new Error(t('net.timeout'));
        throw e instanceof TypeError ? new Error(`「${path}」を読み込めませんでした`) : e;
      });
    this.inflight.set(path, p);
    return p;
  }

  async image(path) {
    const b = await this.blob(path);
    if (window.createImageBitmap) {
      try { return await createImageBitmap(b); } catch { /* 下の方法で読む */ }
    }
    const img = new Image();
    const u = URL.createObjectURL(b);
    img.src = u;
    await img.decode();
    URL.revokeObjectURL(u);
    return img;
  }

  // 先読み。新しい依頼が来たら古い待ち行列は捨てる（もう隣ではないため）。
  prefetch(paths) {
    this.queue = paths.filter((p) => p && !this.has(p) && !this.inflight.has(p));
    this._pump();
  }

  _pump() {
    while (this.running < 2 && this.queue.length) {
      const p = this.queue.shift();
      this.running++;
      this.blob(p).catch(() => {}).finally(() => { this.running--; this._pump(); });
    }
  }
}
