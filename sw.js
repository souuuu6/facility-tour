// 電波がなくても見られるようにする（営業デモ用）。
// 「その他 → 電波がなくても見られるように保存」を押したときだけ登録される。
// - 保存したものは、通信を先に試し、つながらない・2.5 秒たっても返事がないときは保存した写しを使う。
// - 保存していないものは、ふつうに通信する（触らない）。

const CACHE = 'facility-tour-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  if (e.data?.type === 'precache') e.waitUntil(precache(e.data.urls || [], e.source));
});

async function precache(urls, client) {
  const cache = await caches.open(CACHE);
  let done = 0;
  urls = [...urls];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    try {
      const r = await fetch(u, { cache: 'reload' });
      if (r.ok || r.type === 'opaque') {
        // 文字の CSS なら、中に書かれている文字のファイルも保存する
        if (u.startsWith('https://fonts.googleapis.com/') && r.ok) {
          const css = await r.clone().text();
          for (const m of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) if (!urls.includes(m[1])) urls.push(m[1]);
        }
        await cache.put(u, r);
      }
    } catch { /* 取れなかったものは飛ばす */ }
    done++;
    if (done % 5 === 0 || done === urls.length) client?.postMessage({ type: 'progress', done, total: urls.length });
  }
  client?.postMessage({ type: 'precached' });
}

const isFont = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !isFont(url)) return;
  e.respondWith(handle(req, url));
});

async function handle(req, url) {
  const cache = await caches.open(CACHE);
  // ページそのものは ?f=… などが付くので、付いていない形で探す
  const saved = req.mode === 'navigate' ? await cache.match(req, { ignoreSearch: true }) : await cache.match(req);
  const net = fetch(req).then((r) => {
    // 保存済みのもの・文字は、新しい中身で上書きしておく
    if (r.ok && (saved || isFont(url))) cache.put(req, r.clone());
    return r;
  });
  if (!saved) return net.catch(async () => (await cache.match(req)) || Response.error());
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), 2500));
  return Promise.race([net.catch(() => saved), timeout]);
}
