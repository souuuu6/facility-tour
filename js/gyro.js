// スマホを傾けて見回す（ジャイロ）。
// 端末の向き（deviceorientation）から視線の向きを出し、ドラッグで足した分は「ずれ」として残す。

import { wrapDeg } from './viewer.js';

const RAD = Math.PI / 180;

export class Gyro {
  constructor(viewer) {
    this.v = viewer;
    this.on = false;
    this.last = null;
    this._h = (e) => this._orient(e);
  }

  static supported() {
    return 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
  }

  async enable() {
    // iPhone は利用者の操作のあとで許可を取る必要がある
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('傾きの利用が許可されませんでした');
    }
    this.last = null;
    window.addEventListener('deviceorientation', this._h);
    this.on = true;
  }

  disable() {
    window.removeEventListener('deviceorientation', this._h);
    this.on = false;
  }

  _orient(e) {
    if (e.alpha == null) return;
    const v = this.v;
    // 切り替えや自動の動きの最中は合わせ直す
    if (v.locked || v.anims.length) { this.last = null; return; }
    const d = deviceDir(e);
    if (this.last == null) this.offset = wrapDeg(v.yaw - d.yaw);
    else this.offset = wrapDeg(this.offset + (v.yaw - this.last)); // ドラッグで動かした分
    v.lookAt(d.yaw + this.offset, d.pitch);
    this.last = v.yaw;
  }
}

// 端末の向き → 視線の yaw / pitch（three.js の DeviceOrientationControls と同じ計算）
function deviceDir(e) {
  const a = e.alpha * RAD, b = e.beta * RAD, g = e.gamma * RAD;
  const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * RAD;
  const c1 = Math.cos(b / 2), s1 = Math.sin(b / 2);
  const c2 = Math.cos(a / 2), s2 = Math.sin(a / 2);
  const c3 = Math.cos(-g / 2), s3 = Math.sin(-g / 2);
  let q = [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
  q = mul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  q = mul(q, [0, 0, Math.sin(-orient / 2), Math.cos(-orient / 2)]);
  const f = rotate(q, [0, 0, -1]);
  return { yaw: Math.atan2(f[0], -f[2]) / RAD, pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))) / RAD };
}

function mul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotate(q, v) {
  const [x, y, z, w] = q;
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
}
