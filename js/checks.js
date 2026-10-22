// 公開前チェック。納品の前に、抜けや言葉づかいの問題をまとめて見つける。

// 医療広告ガイドラインなどで問題になりやすい表現（比較・最上級・断定・誇張）
const RISKY = [
  [/No\.?\s*1|ナンバーワン|ナンバー1|一番|１番|1番/i, '一番・No.1 のような比較の表現'],
  [/日本一|地域一|業界一|県内一|市内一/, '「〇〇一」のような比較の表現'],
  [/最高|最上|最先端|最新鋭|最良|最適|最も/, '「最高」「最先端」のような最上級の表現'],
  [/絶対|必ず|確実|完全|100\s*[%％]/, '「必ず」「完全」のような断定の表現'],
  [/安心・安全|安全・安心|日本初|業界初|唯一|名医|神の手|他院|他園|より優れ/, '誇張・比較と受け取られやすい表現'],
  [/治ります|治る|痛くない|副作用(は|が)?ない/, '治療の効果を約束する表現'],
];

export async function runChecks(tour, loader) {
  const out = [];
  const add = (level, text, where = '') => out.push({ level, text, where });
  const nodes = tour.nodes || [];
  const ids = new Set(nodes.map((n) => n.id));
  const name = (n) => n.name || n.room || n.id;

  if (!nodes.length) add('error', '地点がひとつもありません。');
  if (!tour.name) add('error', '施設名が入っていません。');
  if (tour.start && !ids.has(tour.start)) add('error', `最初の地点「${tour.start}」がありません。`);
  if (!nodes.some((n) => n.room)) add('warn', '部屋名のついた地点がありません（「お部屋」の一覧が空になります）。');

  const seen = new Set();
  for (const n of nodes) {
    if (seen.has(n.id)) add('error', `地点の id「${n.id}」が重なっています。`, name(n));
    seen.add(n.id);
    if (!n.image) add('error', '写真が指定されていません。', name(n));
    if (tour.floorplan?.image && !n.map) add('warn', '見取り図の上の位置が決まっていません。', name(n));
    if (!n.links.length && nodes.length > 1) add('warn', 'ほかの地点へ進む矢印がありません。', name(n));
    for (const l of n.links) {
      if (!ids.has(l.to)) add('error', `矢印の行き先「${l.to}」がありません。`, name(n));
      else if (!nodes.find((m) => m.id === l.to).links.some((x) => x.to === n.id)) {
        add('warn', `「${name(nodes.find((m) => m.id === l.to))}」から戻る矢印がありません。`, name(n));
      }
    }
    for (const p of n.pins) {
      if (!p.title) add('warn', 'タイトルのないピンがあります。', name(n));
      if (!p.text) add('warn', `ピン「${p.title || '無題'}」の説明文が空です。`, name(n));
    }
  }

  // 到達できない地点
  if (tour.start && ids.has(tour.start)) {
    const reach = new Set([tour.start]);
    const q = [tour.start];
    while (q.length) {
      const id = q.shift();
      const n = nodes.find((m) => m.id === id);
      for (const l of n.links) if (ids.has(l.to) && !reach.has(l.to)) { reach.add(l.to); q.push(l.to); }
    }
    for (const n of nodes) if (!reach.has(n.id)) add('warn', '最初の地点から矢印をたどって行けません（一覧や見取り図からは行けます）。', name(n));
  }

  for (const [i, s] of (tour.guide || []).entries()) {
    if (!ids.has(s.node)) add('error', `ガイドの ${i + 1} 番目の地点「${s.node}」がありません。`);
  }

  if (!tour.sample) {
    const c = tour.contact || {};
    if (!c.reserve?.url && !c.tel && !c.web) add('warn', '問い合わせ先（予約の URL・電話・ホームページ）がひとつも入っていません。');
    if (/example\.com|000-0000/.test(JSON.stringify(c))) add('error', '問い合わせ先にサンプルの値が残っています。');
    if (/Poly Haven|プログラムで描いた/.test(tour.credit || '')) add('warn', '「このツアーについて」の写真の説明がサンプルのままです。');
  }

  // 言葉づかい
  const texts = [['キャッチコピー', tour.tagline]];
  for (const n of nodes) {
    texts.push([name(n), n.name], [name(n), n.room]);
    for (const p of n.pins) texts.push([`${name(n)}・${p.title || 'ピン'}`, `${p.title || ''} ${p.text || ''}`]);
  }
  for (const s of tour.guide || []) texts.push([`ガイド「${(s.text || '').slice(0, 12)}…」`, s.text]);
  const info = tour.info || {};
  texts.push(['はじめての方へ', [info.note, info.closed, ...(info.steps || []), ...(info.bring || [])].join(' ')]);
  if (info.hours?.length && !info.updated) add('warn', '「はじめての方へ」に、いつ時点の情報かが入っていません。');
  for (const [where, t] of texts) {
    if (!t) continue;
    for (const [re, why] of RISKY) {
      const m = t.match(re);
      if (m) add('warn', `「${m[0]}」— ${why}。言いかえを検討してください。`, where);
    }
  }

  // ファイルがそろっているか
  const files = new Set();
  if (tour.floorplan?.image) files.add(tour.floorplan.image);
  if (tour.logo) files.add(tour.logo);
  for (const n of nodes) {
    if (n.image) files.add(n.image);
    if (n.preview) files.add(n.preview);
    for (const p of n.pins) if (p.image) files.add(p.image);
  }
  await Promise.all([...files].map(async (f) => {
    if (loader.local.has(f)) return;
    try {
      const r = await fetch(loader.url(f), { method: 'HEAD', cache: 'no-cache' });
      if (!r.ok) add('error', `ファイル「${f}」が見つかりません。`);
    } catch {
      add('error', `ファイル「${f}」を確かめられませんでした。`);
    }
  }));
  for (const l of tour.languages || []) {
    try {
      const r = await fetch(loader.url(`tour.${l}.json`), { cache: 'no-cache' });
      if (!r.ok) add('error', `訳のファイル「tour.${l}.json」が見つかりません。`);
    } catch { add('error', `訳のファイル「tour.${l}.json」を確かめられませんでした。`); }
  }
  // 撮影情報（EXIF）が残った写真。360 度カメラの写真には撮影場所の位置情報が入っていることが多い
  const withExif = [];
  await Promise.all([...files].filter((f) => /\.jpe?g$/i.test(f)).map(async (f) => {
    try {
      const b = await loader.blob(f);
      if (hasExif(new Uint8Array(await b.slice(0, 65536).arrayBuffer()))) withExif.push(f);
    } catch { /* 見つからないファイルは上で知らせている */ }
  }));
  for (const f of withExif) add('error', `「${f}」に撮影情報（撮影場所の位置情報を含むことがある）が残っています。tools/prepare_photos.py を通してから使ってください。`);
  for (const n of nodes) if (n.image && !n.preview) add('info', '下見用の小さい写真がありません（表示が少し遅くなります。tools/prepare_photos.py で作れます）。', name(n));

  return out;
}

// JPEG の先頭を見て、撮影情報（EXIF）の入れ物があるかを調べる
export function hasExif(u8) {
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 < u8.length && u8[i] === 0xff) {
    const marker = u8[i + 1];
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (marker === 0xe1 && u8[i + 4] === 0x45 && u8[i + 5] === 0x78 && u8[i + 6] === 0x69 && u8[i + 7] === 0x66) return true; // "Exif"
    if (marker === 0xda) break; // ここから先は画像の中身
    i += 2 + len;
  }
  return false;
}

// tour.json から参照されているファイルの一覧（ZIP 用）
export function referencedFiles(tour) {
  const files = new Set();
  if (tour.floorplan?.image) files.add(tour.floorplan.image);
  if (tour.logo) files.add(tour.logo);
  for (const n of tour.nodes || []) {
    if (n.image) files.add(n.image);
    if (n.preview) files.add(n.preview);
    for (const p of n.pins || []) if (p.image) files.add(p.image);
  }
  return [...files].filter((f) => !/^(https?:|data:|blob:)/.test(f));
}
