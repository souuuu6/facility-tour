// 360度ビューア：WebGL で正距円筒図法の写真を表示する。
// 向きの決まり：yaw は北（見取り図の上）を 0 とし時計回りが正、pitch は上が正（度）。
// カメラの yaw は「見取り図の向き（world）」で持ち、写真ごとの heading で写真の向きに直す。

const VS = `
attribute vec2 aPos;
varying vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `
precision highp float;
varying vec2 vNdc;
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform vec3 uF;
uniform vec3 uR;
uniform vec3 uU;
uniform float uTan;
uniform float uAspect;
uniform vec2 uHead;  // 写真ごとの heading（ラジアン）
uniform vec2 uZoom;  // 写真ごとの拡大率（切り替え演出用）
uniform float uMix;
const float PI = 3.141592653589793;
vec4 pano(sampler2D t, float head, float zoom) {
  vec3 d = normalize(uF + vNdc.x * uTan * zoom * uAspect * uR + vNdc.y * uTan * zoom * uU);
  float lon = atan(d.x, -d.z) - head;
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return texture2D(t, vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI));
}
void main() {
  vec4 a = pano(uTex0, uHead.x, uZoom.x);
  if (uMix > 0.0) a = mix(a, pano(uTex1, uHead.y, uZoom.y), uMix);
  gl_FragColor = vec4(a.rgb, 1.0);
}`;

const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

export class PanoViewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) throw new Error('この端末では 360 度表示（WebGL）が使えません。');
    this.gl = gl;
    // 4096 を上限にする（iOS は大きな canvas での縮小に失敗することがあるため）
    this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
    this._initGL();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._emit('lost'); });
    canvas.addEventListener('webglcontextrestored', () => {
      this._initGL();
      this.layers = [{ tex: null, head: this.layers[0].head, zoom: 1 }, { tex: null, head: 0, zoom: 1 }];
      this.mix = 0;
      this._emit('restored');
    });

    this.yaw = 0;
    this.pitch = -6;
    this.fov = this.defaultFov();
    this.layers = [{ tex: null, head: 0, zoom: 1 }, { tex: null, head: 0, zoom: 1 }];
    this.mix = 0;
    this.locked = false; // 切り替え中は操作を止める
    this.vel = { yaw: 0, pitch: 0 };
    this.anims = [];
    this.autoRotate = 0; // 自動で回る速さ（度/秒）。0 なら止まる
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; // 端末で「動きを減らす」が選ばれている
    this.dragging = false;
    this._last = performance.now();
    this.listeners = { change: new Set(), tap: new Set(), interact: new Set(), restored: new Set(), lost: new Set() };
    this.dirty = true;

    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas);
    this._bindInput();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  on(type, fn) { this.listeners[type].add(fn); return () => this.listeners[type].delete(fn); }
  _emit(type, arg) { for (const fn of this.listeners[type]) fn(arg); }

  get aspect() { return this.w / this.h; }
  defaultFov() { return this.canvas.clientWidth < this.canvas.clientHeight ? 100 : 75; }
  maxFov() { return this.canvas.clientWidth < this.canvas.clientHeight ? 115 : 100; }
  // 横方向の見えている角度（見取り図の扇形に使う）
  hfov() { return 2 * Math.atan(Math.tan((this.fov * RAD) / 2) * this.aspect) / RAD; }

  _initGL() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uTex0', 'uTex1', 'uF', 'uR', 'uU', 'uTan', 'uAspect', 'uHead', 'uZoom', 'uMix']) {
      this.u[n] = gl.getUniformLocation(p, n);
    }
    gl.uniform1i(this.u.uTex0, 0);
    gl.uniform1i(this.u.uTex1, 1);
  }

  _texture(img) {
    const gl = this.gl;
    let src = img;
    if (img.width > this.maxTex) {
      const c = document.createElement('canvas');
      c.width = this.maxTex;
      c.height = Math.round((img.height * this.maxTex) / img.width);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      src = c;
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (img.close) img.close(); // ImageBitmap はもう要らない
    return t;
  }

  // 最初の表示（演出なし）
  setImage(img, heading) {
    const old = this.layers[0].tex;
    this.layers[0] = { tex: this._texture(img), head: heading, zoom: 1 };
    if (old) this.gl.deleteTexture(old);
    this.mix = 0;
    this.dirty = true;
  }

  // 同じ地点の高画質版への差し替え
  replaceImage(img) {
    const old = this.layers[0].tex;
    this.layers[0].tex = this._texture(img);
    if (old) this.gl.deleteTexture(old);
    this.dirty = true;
  }

  // 今の地点の heading を変える（編集モードで見取り図の向きを合わせるとき）。見え方は変えない。
  setHeading(heading) {
    this.yaw = wrapDeg(this.yaw + (heading - this.layers[0].head));
    this.layers[0].head = heading;
    this.dirty = true;
  }

  // 別の地点へ切り替える。
  // lookYaw があれば先にその方向を向いてから、前へ歩くように拡大しつつフェードする。
  // endYaw があれば切り替え後の向きをそれにする（見た目は飛ばない）。
  async transition(img, heading, { lookYaw = null, endYaw = null } = {}) {
    if (this.reduced && lookYaw != null) { this.yaw = wrapDeg(lookYaw); lookYaw = null; } // 回転と前進の演出はしない
    this.locked = true;
    this.vel.yaw = this.vel.pitch = 0;
    this._stopFly(); // 途中の向き変えは止めて、切り替えを優先する
    try {
      if (lookYaw != null) {
        const dy = wrapDeg(lookYaw - this.yaw);
        const targetPitch = clamp(this.pitch, -12, 4);
        if (Math.abs(dy) > 4 || Math.abs(targetPitch - this.pitch) > 2) {
          const y0 = this.yaw, p0 = this.pitch;
          const dur = clamp(Math.abs(dy) * 3, 220, 520);
          await this._animate(dur, (e) => {
            this.yaw = wrapDeg(y0 + dy * e);
            this.pitch = p0 + (targetPitch - p0) * e;
          });
        }
      }
      // endYaw が指定されたら、切り替え中は heading をずらしておき、終わったら yaw と一緒に戻す
      const shift = endYaw != null ? wrapDeg(this.yaw - endYaw) : 0;
      this.layers[1] = { tex: this._texture(img), head: heading + shift, zoom: 1 };
      const walk = lookYaw != null;
      await this._animate(walk ? 720 : 560, (e) => {
        this.mix = e;
        this.layers[0].zoom = walk ? 1 - 0.4 * e : 1 + 0.06 * e;
        this.layers[1].zoom = walk ? 0.8 + 0.2 * e : 0.94 + 0.06 * e;
      });
      const old = this.layers[0].tex;
      this.layers[0] = { tex: this.layers[1].tex, head: heading, zoom: 1 };
      this.layers[1] = { tex: null, head: 0, zoom: 1 };
      if (old) this.gl.deleteTexture(old);
      this.mix = 0;
      if (endYaw != null) this.yaw = wrapDeg(endYaw);
      this.dirty = true;
    } finally {
      this.locked = false;
    }
  }

  _animate(dur, fn, fly = false) {
    return new Promise((resolve) => {
      this.anims.push({ start: performance.now(), dur, fn, resolve, fly });
      this.dirty = true;
    });
  }

  // なめらかに向きと拡大率を変える（ピンを押したときなど）
  flyTo(yaw, pitch, fov = this.fov, dur = 650) {
    if (this.locked) return Promise.resolve();
    this.vel.yaw = this.vel.pitch = 0;
    if (this.reduced) dur = 1;
    const y0 = this.yaw, p0 = this.pitch, f0 = this.fov;
    const dy = wrapDeg(yaw - y0);
    const p1 = clamp(pitch, -85, 85), f1 = clamp(fov, 30, this.maxFov());
    return this._animate(dur, (e) => {
      this.yaw = wrapDeg(y0 + dy * e);
      this.pitch = p0 + (p1 - p0) * e;
      this.fov = f0 + (f1 - f0) * e;
    }, true);
  }

  // 利用者が触ったら、自動の向き変え（flyTo）だけを止める。切り替えの演出は止めない
  _stopFly() {
    this.anims = this.anims.filter((a) => { if (a.fly) { a.resolve(); return false; } return true; });
  }

  zoomBy(factor) {
    return this.flyTo(this.yaw, this.pitch, this.fov * factor, 260);
  }

  lookAt(yaw, pitch = this.pitch) {
    this.yaw = wrapDeg(yaw);
    this.pitch = clamp(pitch, -85, 85);
    this.dirty = true;
  }

  _basis() {
    const y = this.yaw * RAD, p = this.pitch * RAD;
    const f = [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
    const r = [Math.cos(y), 0, Math.sin(y)];
    const u = [-Math.sin(y) * Math.sin(p), Math.cos(p), Math.cos(y) * Math.sin(p)];
    return { f, r, u, tan: Math.tan((this.fov * RAD) / 2) };
  }

  // world の方向ベクトル（カメラからの相対位置）→ 画面座標（CSS px）。後ろ側なら null。
  project(v) {
    const b = this._basis();
    const cz = v[0] * b.f[0] + v[1] * b.f[1] + v[2] * b.f[2];
    if (cz <= 0.02) return null;
    const cx = v[0] * b.r[0] + v[1] * b.r[1] + v[2] * b.r[2];
    const cy = v[0] * b.u[0] + v[1] * b.u[1] + v[2] * b.u[2];
    const x = cx / (cz * b.tan * this.aspect);
    const y = cy / (cz * b.tan);
    return { x: ((x + 1) / 2) * this.cw, y: ((1 - y) / 2) * this.ch, z: cz };
  }

  // 画面上の点 → world の yaw / pitch
  dirAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const b = this._basis();
    const d = [0, 1, 2].map((i) => b.f[i] + nx * b.tan * this.aspect * b.r[i] + ny * b.tan * b.u[i]);
    const len = Math.hypot(d[0], d[1], d[2]);
    return { yaw: Math.atan2(d[0], -d[2]) / RAD, pitch: Math.asin(d[1] / len) / RAD };
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = this.canvas.clientWidth;
    this.ch = this.canvas.clientHeight;
    this.w = Math.max(1, Math.round(this.cw * dpr));
    this.h = Math.max(1, Math.round(this.ch * dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.fov = clamp(this.fov, 30, this.maxFov());
    this.dirty = true;
  }

  _bindInput() {
    const c = this.canvas;
    const pts = new Map();
    let drag = null, pinch = null, last = null;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.vel.yaw = this.vel.pitch = 0;
      this.dragging = true;
      this._stopFly();
      this._emit('interact');
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
        last = { x: e.clientX, y: e.clientY, t: performance.now() };
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.fov };
        drag = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.locked) return;
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.fov = clamp((pinch.fov * pinch.d) / Math.max(d, 1), 30, this.maxFov());
        this.dirty = true;
      } else if (drag) {
        const k = this.fov / this.ch;
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        this.yaw = wrapDeg(this.yaw - dx * k);
        this.pitch = clamp(this.pitch + dy * k, -85, 85);
        const now = performance.now();
        const dt = Math.max(now - last.t, 1);
        this.vel.yaw = (-(e.clientX - last.x) * k) / dt * 16;
        this.vel.pitch = ((e.clientY - last.y) * k) / dt * 16;
        last = { x: e.clientX, y: e.clientY, t: now };
        this.dirty = true;
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (drag && pts.size === 0) {
        const quick = performance.now() - drag.t < 500;
        if (drag.moved < 8 && quick) {
          this.vel.yaw = this.vel.pitch = 0;
          this._emit('tap', { clientX: e.clientX, clientY: e.clientY });
        } else if (performance.now() - last.t > 80) {
          this.vel.yaw = this.vel.pitch = 0; // 止めてから離したら慣性なし
        }
      }
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { drag = null; this.dragging = false; }
      else if (pts.size === 1) {
        const p = [...pts.values()][0];
        drag = { x: p.x, y: p.y, t: performance.now(), moved: 99 };
        last = { ...p, t: performance.now() };
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.locked) return;
      this._stopFly();
      this.fov = clamp(this.fov * Math.exp(e.deltaY * 0.0012), 30, this.maxFov());
      this.dirty = true;
      this._emit('interact');
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (this.locked || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
      if (step) {
        this.lookAt(this.yaw + step[0], this.pitch + step[1]);
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=') {
        this.fov = clamp(this.fov - 6, 30, this.maxFov()); this.dirty = true;
      } else if (e.key === '-') {
        this.fov = clamp(this.fov + 6, 30, this.maxFov()); this.dirty = true;
      }
    });
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(now - this._last, 100);
    this._last = now;
    if (this.autoRotate && !this.locked && !this.dragging && !this.anims.length && this.layers[0].tex) {
      this.yaw = wrapDeg(this.yaw + (this.autoRotate * dt) / 1000);
      this.dirty = true;
    }
    if (this.anims.length) {
      this.anims = this.anims.filter((a) => {
        const t = Math.min(1, (now - a.start) / a.dur);
        a.fn(ease(t));
        if (t >= 1) { a.resolve(); return false; }
        return true;
      });
      this.dirty = true;
    }
    if (Math.abs(this.vel.yaw) > 0.01 || Math.abs(this.vel.pitch) > 0.01) {
      this.yaw = wrapDeg(this.yaw + this.vel.yaw);
      this.pitch = clamp(this.pitch + this.vel.pitch, -85, 85);
      this.vel.yaw *= 0.9;
      this.vel.pitch *= 0.9;
      this.dirty = true;
    }
    if (!this.dirty || !this.layers[0].tex) return;
    this.dirty = false;
    this._render();
    this._emit('change');
  }

  _render() {
    const gl = this.gl, u = this.u, b = this._basis();
    gl.viewport(0, 0, this.w, this.h);
    gl.uniform3fv(u.uF, b.f);
    gl.uniform3fv(u.uR, b.r);
    gl.uniform3fv(u.uU, b.u);
    gl.uniform1f(u.uTan, b.tan);
    gl.uniform1f(u.uAspect, this.aspect);
    const [l0, l1] = this.layers;
    gl.uniform2f(u.uHead, l0.head * RAD, l1.head * RAD);
    gl.uniform2f(u.uZoom, l0.zoom, l1.zoom);
    gl.uniform1f(u.uMix, l1.tex ? this.mix : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, l0.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, l1.tex || l0.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
