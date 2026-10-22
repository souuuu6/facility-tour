// 自動ガイド。tour.json の guide（なければ部屋の順）にそって歩き、字幕で案内する。
// 見回したり矢印を押したりすると一時停止する。

import { $ } from './ui.js';
import { track } from './analytics.js';
import { t } from './i18n.js';

export class Guide {
  constructor(app, { walkTo, goTo, onState }) {
    this.app = app;
    this.walkTo = walkTo;
    this.goTo = goTo;
    this.onState = onState;
    this.active = false;
    this.paused = false;
    this.i = 0;
    this.token = 0;
    $('#guidePlay').addEventListener('click', () => this.toggle());
    $('#guideNext').addEventListener('click', () => this.go(this.i + 1));
    $('#guidePrev').addEventListener('click', () => this.go(this.i - 1));
    $('#guideClose').addEventListener('click', () => this.stop());
  }

  steps() {
    const t = this.app.tour;
    if (t.guide?.length) return t.guide;
    // ガイドが書かれていなければ、部屋名のついた地点を順に回る
    const seen = new Set();
    return t.nodes.filter((n) => n.room && !seen.has(n.room) && seen.add(n.room)).map((n) => ({
      node: n.id,
      look: [n.startYaw || 0, -5],
      text: n.pins[0]?.text ? `${t('guide.auto', { room: n.room })}${n.pins[0].text}` : t('guide.auto', { room: n.room }),
    }));
  }

  // 1 ステップを見せる長さ：文の長さに合わせる
  // 「ガイドをゆっくり」を選んだ人には 1.6 倍の時間をとる。英語は文字数が多いので 1 文字あたりを短く
  duration(s) {
    let slow = false;
    try { slow = localStorage.getItem('tour-slow') === '1'; } catch { /* 無視 */ }
    const perChar = /[぀-ヿ一-鿿]/.test(s.text || '') ? 95 : 45;
    const base = s.ms || Math.min(9000, Math.max(4000, 2200 + (s.text || '').length * perChar));
    return slow ? base * 1.6 : base;
  }

  start(i = 0) {
    if (!this.steps().length) return;
    this.active = true;
    this.onState(true);
    $('#guideBar').hidden = false;
    track('guide_start');
    this.go(i);
  }

  stop() {
    this.token++;
    this.app.navSeq++; // 歩いている途中なら止める
    this.active = false;
    this.paused = false;
    $('#guideBar').hidden = true;
    this.onState(false);
  }

  pause() {
    if (!this.active || this.paused) return;
    this.paused = true;
    this._renderButtons();
  }

  toggle() {
    if (!this.active) return;
    this.paused = !this.paused;
    this._renderButtons();
  }

  go(i) {
    const steps = this.steps();
    this.i = Math.max(0, Math.min(steps.length - 1, i));
    this.paused = false;
    this._run(++this.token);
  }

  async _run(token) {
    const steps = this.steps();
    while (this.i < steps.length) {
      const s = steps[this.i];
      this._render(s, steps.length);
      await this.walkTo(s.node);
      if (token !== this.token) return;
      if (this.app.node?.id !== s.node) {
        // 利用者が途中で触って止まったなら、再開されるまで待ってから向かう
        if (!(await this._untilResumed(token))) return;
        await this.walkTo(s.node);
        if (token !== this.token) return;
        // それでも着かなければ（矢印でつながっていないなど）、そのまま切り替える
        if (this.app.node?.id !== s.node) await this.goTo(s.node);
      }
      if (token !== this.token) return;
      const node = this.app.node;
      if (s.look && node?.id === s.node) {
        await this.app.viewer.flyTo(s.look[0] + (node.heading || 0), s.look[1], s.fov || this.app.viewer.defaultFov(), 900);
      }
      if (token !== this.token) return;
      if (!(await this._wait(this.duration(s), token))) return;
      this.i++;
    }
    track('guide_complete');
    this.stop();
    this.onState(false, true);
  }

  _untilResumed(token) {
    return new Promise((resolve) => {
      const check = () => {
        if (token !== this.token) resolve(false);
        else if (!this.paused) resolve(true);
        else setTimeout(check, 150);
      };
      check();
    });
  }

  _wait(ms, token) {
    return new Promise((resolve) => {
      let t = 0;
      const bar = $('#guideProgress');
      const timer = setInterval(() => {
        if (token !== this.token) { clearInterval(timer); resolve(false); return; }
        if (!this.paused) t += 100;
        bar.style.transform = `scaleX(${Math.min(1, t / ms)})`;
        if (t >= ms) { clearInterval(timer); resolve(true); }
      }, 100);
    });
  }

  _render(s, total) {
    $('#guideText').textContent = s.text || '';
    $('#guideStep').textContent = `${this.i + 1} / ${total}`;
    $('#guideProgress').style.transform = 'scaleX(0)';
    $('#guidePrev').disabled = this.i === 0;
    $('#guideNext').disabled = this.i >= total - 1;
    this._renderButtons();
  }

  _renderButtons() {
    const b = $('#guidePlay');
    b.classList.toggle('paused', this.paused);
    b.setAttribute('aria-label', t(this.paused ? 'guide.resume' : 'guide.pause'));
  }
}
