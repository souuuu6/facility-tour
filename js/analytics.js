// 閲覧の計測。
// - tour.json の analytics.ga4 に測定 ID（G-XXXXXXX）があれば Google アナリティクス 4 に送る。
// - iframe で埋め込まれているときは、埋め込み先のページにも postMessage で知らせる（そのページの住所あてにだけ送る）。
//   受け取り側の例：window.addEventListener('message', (e) => { if (e.data?.source === 'facility-tour') ... })

let ready = false;
let parentOrigin = null; // 通知を送る先（埋め込んでいるページの住所）。分からなければ送らない

// 埋め込んでいるページの住所を調べる。tour.json の analytics.embedOrigins があれば、その中にあるときだけ送る
function findParent(tour) {
  if (window.parent === window) return null;
  let origin = window.location.ancestorOrigins?.[0] || null;
  if (!origin && document.referrer) {
    try { origin = new URL(document.referrer).origin; } catch { origin = null; }
  }
  const allow = tour.analytics?.embedOrigins;
  if (origin && Array.isArray(allow) && allow.length && !allow.includes(origin)) return null;
  return origin;
}

export function initAnalytics(tour) {
  parentOrigin = findParent(tour);
  const id = tour.analytics?.ga4;
  if (!id || !/^G-[A-Z0-9]+$/.test(id) || ready) return;
  ready = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.append(s);
}

// name: tour_start / view_spot / open_pin / guide_start / guide_complete / contact_click / share
export function track(name, params = {}) {
  try { window.gtag?.('event', name, params); } catch { /* 計測の失敗で止めない */ }
  try {
    if (parentOrigin) window.parent.postMessage({ source: 'facility-tour', event: name, ...params }, parentOrigin);
  } catch { /* 無視 */ }
}
