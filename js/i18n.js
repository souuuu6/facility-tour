// 画面の文字の辞書（日本語・英語）。施設ごとの文章（部屋名・解説など）は tour.<言語>.json に書く。
// 言語を足すときは DICT にもう 1 つ増やし、tour.json の languages に入れる。

const DICT = {
  ja: {
    'pano.label': '360度の写真。ドラッグで見回せます',
    'arrows': '移動の矢印',
    'exits': 'ほかの行き先',
    'sample': 'サンプル',
    'sample.title': '架空の施設のサンプルです',
    'map.open': '見取り図を大きく表示',
    'ctl.label': '見え方の操作',
    'ctl.zoomIn': '拡大',
    'ctl.zoomOut': '縮小',
    'ctl.rotate': '自動でゆっくり回る',
    'ctl.gyro': 'スマホを傾けて見回す',
    'ctl.full': '全画面で見る',
    'step.prev': '前の部屋へ',
    'step.next': '次の部屋へ',
    'step.list': '部屋の一覧を開く',
    'guide.prev': '前の案内へ',
    'guide.next': '次の案内へ',
    'guide.pause': 'ガイドを一時停止',
    'guide.resume': 'ガイドを再開',
    'guide.close': 'ガイドを終わる',
    'guide.voice': 'ガイドを声で読み上げる',
    'guide.pick': 'どのガイドで見ますか',
    'guide.stops': '{n}か所・約{m}分',
    'next': '次はこちら',
    'tb.label': 'メニュー',
    'tb.guide': 'ガイド',
    'tb.guiding': 'ガイド中',
    'tb.rooms': 'お部屋',
    'tb.map': '見取り図',
    'tb.contact': '問い合わせ',
    'tb.more': 'その他',
    'hint': 'ドラッグで見回せます・床の矢印で進めます',
    'intro.eyebrow': '360°バーチャル見学',
    'intro.guide': 'ガイドで見る',
    'intro.free': '自由に見る',
    'intro.min': '約{n}分',
    'intro.note': 'ドラッグ（スマホはスワイプ）で見回し、床の矢印で進めます。',
    'loading': '読み込み中',
    'close': '閉じる',
    'chooser.eyebrow': '施設ツアー',
    'chooser.title': '見たい施設をえらんでください',
    'chooser.note': '施設名と解説はすべて架空です。写真は仮の素材を使っています。',
    'err.title': '表示できませんでした',
    'err.file': 'ファイルを直接開くと写真を読み込めません。README の「手元で動かす」の手順でサーバーを起動してから開いてください。',
    'err.fid': '施設の名前（f=）には英数字・-・_ だけが使えます。',
    'err.notour': '{path} が見つかりません。',
    'err.json': 'tour.json の書き方に誤りがあります：{msg}',
    'err.index': 'facilities/index.json が見つかりません。',
    'lost.title': '画面の表示が止まりました',
    'lost.body': 'ほかのアプリでメモリが使われているようです。ページを再読み込みしてください。',
    'reload': '再読み込みする',
    'title.suffix': '360°バーチャル見学',
    'title.sample': '（サンプル）',
    'hq.fail': '高画質の写真を読み込めませんでした（{msg}）',
    'photo.fail': '写真を読み込めませんでした',
    'net.timeout': '通信に時間がかかっています。電波のよい所で、もう一度押してください。',
    'gyro.on': 'スマホを動かすと見回せます',
    'gyro.denied': '傾きの利用が許可されませんでした',
    'thanks': 'ご覧いただきありがとうございました',
    'go': '{label}へ進む',
    'rooms.title': 'お部屋の一覧',
    'rooms.empty': '部屋名のついた地点がまだありません。',
    'here': 'いまここ',
    'map.title': '見取り図',
    'map.tip': '点を押すと、その場所へ移動します。扇形はいま見ている向きです。',
    'map.place.title': '地点の位置を決める',
    'map.place.tip': '見取り図をクリックすると、この地点の位置が決まります。',
    'pin.default': '解説',
    'contact.title': 'お問い合わせ・見学のご予約',
    'contact.reserve': '見学を予約する',
    'contact.tel': '電話する',
    'contact.map': '地図を見る',
    'contact.web': 'ホームページ',
    'contact.sample': 'サンプルのため、ボタンを押してもつながりません。',
    'contact.sampleToast': 'サンプルのため、実際にはつながりません',
    'info.title': 'はじめての方へ',
    'info.sub': '受付時間・お休み・持ち物',
    'info.hours': '受付時間',
    'info.closed': 'お休み',
    'info.bring': '持ち物',
    'info.steps': '流れ',
    'info.updated': '{d}時点の情報です。最新の情報は公式ホームページでご確認ください。',
    'info.official': '公式ホームページで確かめる',
    'more.title': 'その他',
    'more.share': 'この場所を共有する',
    'more.shareSub': 'いま見ている場所のリンクを送れます',
    'more.dark': 'ダークモードにする',
    'more.light': 'ライトモードにする',
    'more.large': '文字を大きくする',
    'more.largeOff': '文字を元の大きさにする',
    'more.slow': 'ガイドをゆっくりにする',
    'more.slowOff': 'ガイドを元の速さにする',
    'more.lang': 'English',
    'more.langSub': '英語で表示します',
    'more.about': 'このツアーについて',
    'more.open': '新しいタブで大きく開く',
    'more.offline': '電波がなくても見られるように保存',
    'more.offlineSub': '営業デモ用。この端末に写真を保存します',
    'offline.saving': '保存しています… {done} / {total}',
    'offline.done': '保存しました。電波がなくても見られます。',
    'offline.fail': 'この端末では保存できませんでした',
    'share.copied': 'リンクをコピーしました',
    'share.title': 'この場所のリンク',
    'theme.dark': 'ダークモードにしました',
    'theme.light': 'ライトモードにしました',
    'about.title': 'このツアーについて',
    'about.sample': '{name} は架空の施設です。施設名・解説文・見取り図はすべて仮のものです。',
    'about.how': '使い方',
    'about.1': 'ドラッグ（スマホはスワイプ）で見回せます。ピンチやホイール、＋−ボタンで拡大・縮小できます。',
    'about.2': '床の矢印を押すと、その方向へ進みます。',
    'about.3': '丸い「i」のピンを押すと、その場所の解説が出ます。',
    'about.4': '「ガイド」を押すと、順番に自動で案内します。',
    'about.5': '下の ‹ › で前後のお部屋へ、「お部屋」「見取り図」から見たい場所へすぐ移動できます。',
    'guide.auto': '{room}です。',
  },
  en: {
    'pano.label': '360° photo. Drag to look around',
    'arrows': 'Arrows to move',
    'exits': 'Other directions',
    'sample': 'Sample',
    'sample.title': 'This is a fictional sample facility',
    'map.open': 'Open the floor plan',
    'ctl.label': 'View controls',
    'ctl.zoomIn': 'Zoom in',
    'ctl.zoomOut': 'Zoom out',
    'ctl.rotate': 'Rotate slowly',
    'ctl.gyro': 'Look around by moving your phone',
    'ctl.full': 'Full screen',
    'step.prev': 'Previous room',
    'step.next': 'Next room',
    'step.list': 'Open the room list',
    'guide.prev': 'Previous',
    'guide.next': 'Next',
    'guide.pause': 'Pause the guide',
    'guide.resume': 'Resume the guide',
    'guide.close': 'End the guide',
    'guide.voice': 'Read the guide aloud',
    'guide.pick': 'Choose a guide',
    'guide.stops': '{n} stops · about {m} min',
    'next': 'Next',
    'tb.label': 'Menu',
    'tb.guide': 'Guide',
    'tb.guiding': 'Guiding',
    'tb.rooms': 'Rooms',
    'tb.map': 'Map',
    'tb.contact': 'Contact',
    'tb.more': 'More',
    'hint': 'Drag to look around · Tap the floor arrows to move',
    'intro.eyebrow': '360° virtual tour',
    'intro.guide': 'Guided tour',
    'intro.free': 'Explore freely',
    'intro.min': 'about {n} min',
    'intro.note': 'Drag (or swipe) to look around, and tap the floor arrows to move.',
    'loading': 'Loading',
    'close': 'Close',
    'chooser.eyebrow': 'Facility tours',
    'chooser.title': 'Choose a facility',
    'chooser.note': 'All facility names and descriptions are fictional. The photos are placeholders.',
    'err.title': 'Could not show the tour',
    'err.file': 'Photos cannot be loaded when the file is opened directly. Start a local server as described in the README.',
    'err.fid': 'The facility name (f=) can only contain letters, numbers, - and _.',
    'err.notour': '{path} was not found.',
    'err.json': 'tour.json has an error: {msg}',
    'err.index': 'facilities/index.json was not found.',
    'lost.title': 'The display stopped',
    'lost.body': 'Your device may be low on memory. Please reload the page.',
    'reload': 'Reload',
    'title.suffix': '360° Virtual Tour',
    'title.sample': ' (sample)',
    'hq.fail': 'Could not load the high-quality photo ({msg})',
    'photo.fail': 'Could not load the photo',
    'net.timeout': 'The connection is slow. Please try again where the signal is better.',
    'gyro.on': 'Move your phone to look around',
    'gyro.denied': 'Motion access was not allowed',
    'thanks': 'Thank you for visiting',
    'go': 'Go to {label}',
    'rooms.title': 'Rooms',
    'rooms.empty': 'No rooms yet.',
    'here': 'You are here',
    'map.title': 'Floor plan',
    'map.tip': 'Tap a dot to go there. The fan shows where you are looking.',
    'map.place.title': 'Place this spot',
    'map.place.tip': 'Click the floor plan to set the position of this spot.',
    'pin.default': 'Info',
    'contact.title': 'Contact & visit booking',
    'contact.reserve': 'Book a visit',
    'contact.tel': 'Call',
    'contact.map': 'Map',
    'contact.web': 'Website',
    'contact.sample': 'This is a sample, so these buttons do not connect anywhere.',
    'contact.sampleToast': 'This is a sample, so it does not connect',
    'info.title': 'First visit',
    'info.sub': 'Hours, closed days and what to bring',
    'info.hours': 'Hours',
    'info.closed': 'Closed',
    'info.bring': 'What to bring',
    'info.steps': 'How it works',
    'info.updated': 'Information as of {d}. Please check the official website for the latest.',
    'info.official': 'Check the official website',
    'more.title': 'More',
    'more.share': 'Share this spot',
    'more.shareSub': 'Send a link to the place you are looking at',
    'more.dark': 'Dark mode',
    'more.light': 'Light mode',
    'more.large': 'Larger text',
    'more.largeOff': 'Normal text size',
    'more.slow': 'Slower guide',
    'more.slowOff': 'Normal guide speed',
    'more.lang': '日本語',
    'more.langSub': 'Show in Japanese',
    'more.about': 'About this tour',
    'more.open': 'Open in a new tab',
    'more.offline': 'Save for offline viewing',
    'more.offlineSub': 'For demos. Saves the photos on this device',
    'offline.saving': 'Saving… {done} / {total}',
    'offline.done': 'Saved. You can view it without a connection.',
    'offline.fail': 'Could not save on this device',
    'share.copied': 'Link copied',
    'share.title': 'Link to this spot',
    'theme.dark': 'Dark mode on',
    'theme.light': 'Light mode on',
    'about.title': 'About this tour',
    'about.sample': '{name} is a fictional facility. Names, descriptions and floor plans are placeholders.',
    'about.how': 'How to use',
    'about.1': 'Drag (or swipe) to look around. Pinch, scroll or use the +/− buttons to zoom.',
    'about.2': 'Tap an arrow on the floor to walk that way.',
    'about.3': 'Tap a round “i” pin to read about that place.',
    'about.4': 'Tap “Guide” for an automatic tour.',
    'about.5': 'Use ‹ › to move between rooms, or jump from “Rooms” and “Map”.',
    'guide.auto': '{room}.',
  },
};

let lang = 'ja';

export const LANGS = Object.keys(DICT);

export function setLang(l) {
  lang = DICT[l] ? l : 'ja';
  document.documentElement.lang = lang;
  applyStatic();
}

export function getLang() { return lang; }

export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.ja[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

// index.html の data-i18n（文字）・data-i18n-label（aria-label）・data-i18n-title（title）を置き換える
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
}

// 施設の文章を、その言語の訳で置き換えた写しを返す（訳がない所は日本語のまま）
export function localize(tour, tr) {
  if (!tr) return tour;
  const out = structuredClone(tour);
  for (const k of ['name', 'tagline', 'credit']) if (tr[k]) out[k] = tr[k];
  if (tr.contact && out.contact) {
    const c = tr.contact;
    for (const k of ['title', 'hours', 'address']) if (c[k]) out.contact[k] = c[k];
    if (c.reserve && out.contact.reserve) Object.assign(out.contact.reserve, c.reserve);
  }
  if (tr.info) out.info = { ...out.info, ...tr.info };
  const trGuides = tr.guides || (Array.isArray(tr.guide) ? [{ steps: tr.guide }] : []);
  trGuides.forEach((g, gi) => {
    const o = out.guides?.[gi];
    if (!o || !g) return;
    if (g.title) o.title = g.title;
    if (g.desc) o.desc = g.desc;
    (g.steps || []).forEach((text, i) => { if (text && o.steps?.[i]) o.steps[i].text = text; });
  });
  for (const n of out.nodes || []) {
    const x = tr.nodes?.[n.id];
    if (!x) continue;
    if (x.name) n.name = x.name;
    if (x.room) n.room = x.room;
    (x.pins || []).forEach((p, i) => { if (p && n.pins[i]) Object.assign(n.pins[i], p); });
  }
  return out;
}
