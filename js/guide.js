// 自動ガイド。tour.json の guides（「園内をひとめぐり」「一日の流れ」など、いくつでも）にそって歩き、字幕で案内する。
// 書かれていなければ部屋の順に回る。見回したり矢印を押したりすると一時停止する。
// 「声で読み上げる」を選ぶと、端末の読み上げ機能で字幕を読む（追加の料金なし）。

import { $ } from './ui.js';
import { track } from './analytics.js';
import { t, getLang } from './i18n.js';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 無視 */ } },
};

export class Guide {
  constructor(app, { walkTo, goTo, onState }) {
    this.app = app;
    this.walkTo = walkTo;
    this.goTo = goTo;
    this.onState = onState;
    this.active = false;
    this.paused = false;
    this.gi = 0; // 今のガイドの番号
    this.i = 0;  // 今の案内の番号
    this.token = 0;
    $('#guidePlay').addEventListener('click', () => this.toggle());
    $('#guideNext').addEventListener('click', () => this.go(this.i + 1));
    $('#guidePrev').addEventListener('click', () => this.go(this.i - 1));
    $('#guideClose').addEventListener('click', () => this.stop());
    $('#guideVoice').hidden = !('speechSynthesis' in window);
    $('#guideVoice').addEventListener('click', () => {
      const on = !this.voiceOn();
      store.set('tour-voice', on ? '1' : null);
      this._renderButtons();
      if (on && this.active && !this.paused) this.speak(this.current()?.text);
      else window.speechSynthesis?.cancel();
    });
  }

  // 使えるガイドの一覧。どれも書かれていなければ、部屋の順に回る 1 本だけ
  list() {
    const tr = this.app.tour;
    const own = (tr.guides || []).filter((g) => g.steps?.length);
    if (own.length) return own;
    const seen = new Set();
    const steps = tr.nodes.filter((n) => n.room && !seen.has(n.room) && seen.add(n.room)).map((n) => ({
      node: n.id,
      look: [n.startYaw || 0, -5],
      text: n.pins[0]?.text ? `${t('guide.auto', { room: n.room })}${n.pins[0].text}` : t('guide.auto', { room: n.room }),
    }));
    return steps.length ? [{ id: 'auto', title: t('tb.guide'), steps }] : [];
  }

  steps() { return this.list()[this.gi]?.steps || []; }
  current() { return this.steps()[this.i]; }

  // 1 ステップを見せる長さ：文の長さに合わせる
  // 「ガイドをゆっくり」を選んだ人には 1.6 倍の時間をとる。英語は文字数が多いので 1 文字あたりを短く
  duration(s) {
    const slow = store.get('tour-slow') === '1';
    const perChar = /[぀-ヿ一-鿿]/.test(s.text || '') ? 95 : 45;
    const base = s.ms || Math.min(9000, Math.max(4000, 2200 + (s.text || '').length * perChar));
    return slow ? base * 1.6 : base;
  }

  // ガイド 1 本のおよその時間（分）。移動に 1 か所 2.5 秒ほどかかる
  minutes(g) {
    const sec = g.steps.reduce((s, x) => s + this.duration(x) / 1000 + 2.5, 0);
    return Math.max(1, Math.round(sec / 60));
  }

  start(i = 0, gi = this.gi) {
    const list = this.list();
    if (!list[gi]) return;
    this.gi = gi;
    this.active = true;
    this.onState(true);
    $('#guideBar').hidden = false;
    track('guide_start', { guide: list[gi].id || String(gi) });
    this.go(i);
  }

  stop() {
    this.token++;
    this.app.navSeq++; // 歩いている途中なら止める
    this.active = false;
    this.paused = false;
    window.speechSynthesis?.cancel();
    $('#guideBar').hidden = true;
    this.onState(false);
  }

  pause() {
    if (!this.active || this.paused) return;
    this.paused = true;
    window.speechSynthesis?.cancel();
    this._renderButtons();
  }

  toggle() {
    if (!this.active) return;
    this.paused = !this.paused;
    if (this.paused) window.speechSynthesis?.cancel();
    else this.speak(this.current()?.text);
    this._renderButtons();
  }

  go(i) {
    const steps = this.steps();
    this.i = Math.max(0, Math.min(steps.length - 1, i));
    this.paused = false;
    window.speechSynthesis?.cancel();
    this._run(++this.token);
  }

  // ---- 読み上げ ----
  voiceOn() { return store.get('tour-voice') === '1' && 'speechSynthesis' in window; }

  speak(text) {
    if (!text || !this.voiceOn()) return;
    const ss = window.speechSynthesis;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = getLang() === 'en' ? 'en-US' : 'ja-JP';
    const voice = ss.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = store.get('tour-slow') === '1' ? 0.85 : 1;
    ss.speak(u);
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
      if (!this.paused) this.speak(s.text);
      if (!(await this._wait(this.duration(s), token))) return;
      this.i++;
    }
    track('guide_complete', { guide: this.list()[this.gi]?.id || String(this.gi) });
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

  // 決めた時間がたつまで待つ。読み上げ中なら、読み終わるまで待つ（長くても 30 秒）
  _wait(ms, token) {
    return new Promise((resolve) => {
      let t = 0;
      const bar = $('#guideProgress');
      const timer = setInterval(() => {
        if (token !== this.token) { clearInterval(timer); resolve(false); return; }
        if (!this.paused) t += 100;
        bar.style.transform = `scaleX(${Math.min(1, t / ms)})`;
        const speaking = this.voiceOn() && window.speechSynthesis.speaking;
        if ((t >= ms && !speaking) || t >= 30000) { clearInterval(timer); resolve(true); }
      }, 100);
    });
  }

  _render(s, total) {
    const g = this.list()[this.gi];
    $('#guideText').textContent = s.text || '';
    $('#guideStep').textContent = `${g?.title ? `${g.title}　` : ''}${this.i + 1} / ${total}`;
    $('#guideProgress').style.transform = 'scaleX(0)';
    $('#guidePrev').disabled = this.i === 0;
    $('#guideNext').disabled = this.i >= total - 1;
    this._renderButtons();
  }

  _renderButtons() {
    const b = $('#guidePlay');
    b.classList.toggle('paused', this.paused);
    b.setAttribute('aria-label', t(this.paused ? 'guide.resume' : 'guide.pause'));
    $('#guideVoice').setAttribute('aria-pressed', String(this.voiceOn()));
  }
}
