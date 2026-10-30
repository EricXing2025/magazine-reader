/* MagReader — 双页对开 PDF 杂志阅读器
 * pdf.js 渲染 + StPageFlip 卷页动画。纯本地，无网络依赖。
 * RTL（日漫/竖排）= 舞台整体 scaleX(-1) 镜像 + 每页内容镜像还原。
 */
(() => {
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), thumbsEl = $('#thumbs');
let bookEl = $('#book');   // PageFlip.destroy() 会清掉容器，需重建并更新引用
const pageInfo = $('#page-info'), docName = $('#doc-name');
const dropHint = $('#drop-hint'), flipRoot = $('#flip-root');
const LS_PREFIX = 'magreader:v1:';
const THUMB_H = 240;

const S = {
  doc: null,            // pdfjs document
  key: null,            // 当前文件标识（进度存储 key）
  numPages: 0,
  flip: null,
  rtl: false,
  innerIndex: 0,        // PageFlip 内部页码（== pageDivs 下标 == pdf 页-1）
  pageDivs: [],         // 每页容器 div，按 PDF 顺序
  rendered: new Set(),  // 已渲染正文的 pdf 页下标
  renderQueue: Promise.resolve(),
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  pageAspect: 1.414,    // h/w，取首页比例
  sidebar: true,
};

/* ================= 界面偏好（主题 / 语言） ================= */
const STR = {
  'zh-CN': {
    open: '打开', openTitle: '打开 PDF 文件', langTitle: '界面语言',
    thumbsTitle: '缩略图栏 (T)', rtlTitle: '从右到左翻页 (R)', fullTitle: '全屏 (F)',
    themeTitle: '切换亮色 / 暗色模式',
    noDoc: '未打开文件', loading: '加载中… ', openFail: '打开失败：',
    shelf: '书架', pages: '页面',
    dropHint: '把 PDF 拖到这里，或点左上角「打开」',
    shelfHint: '也可以从左侧书架选择',
    zoomHint: '滚轮缩放 · 拖拽平移 · Esc / 双击关闭',
    title: 'MagReader · 杂志阅读器',
  },
  'zh-TW': {
    open: '開啟', openTitle: '開啟 PDF 檔案', langTitle: '介面語言',
    thumbsTitle: '縮圖欄 (T)', rtlTitle: '由右至左翻頁 (R)', fullTitle: '全螢幕 (F)',
    themeTitle: '切換亮色 / 暗色模式',
    noDoc: '未開啟檔案', loading: '載入中… ', openFail: '開啟失敗：',
    shelf: '書架', pages: '頁面',
    dropHint: '將 PDF 拖曳至此，或點左上角「開啟」',
    shelfHint: '也可以從左側書架選擇',
    zoomHint: '滾輪縮放 · 拖曳平移 · Esc / 雙擊關閉',
    title: 'MagReader · 雜誌閱讀器',
  },
  en: {
    open: 'Open', openTitle: 'Open a PDF file', langTitle: 'Interface language',
    thumbsTitle: 'Thumbnails (T)', rtlTitle: 'Right-to-left flipping (R)', fullTitle: 'Fullscreen (F)',
    themeTitle: 'Toggle light / dark theme',
    noDoc: 'No file open', loading: 'Loading… ', openFail: 'Failed to open: ',
    shelf: 'Shelf', pages: 'Pages',
    dropHint: 'Drop a PDF here, or click "Open" at top-left',
    shelfHint: 'or pick one from the shelf on the left',
    zoomHint: 'Scroll to zoom · Drag to pan · Esc / double-click to close',
    title: 'MagReader · Magazine Reader',
  },
};
const UI = { theme: 'dark', lang: 'zh-CN' };
function t(k) { return STR[UI.lang]?.[k] ?? STR['zh-CN'][k] ?? k; }

function loadUiPref() {
  try { Object.assign(UI, JSON.parse(localStorage.getItem(LS_PREFIX + 'ui')) || {}); } catch {}
  if (!['zh-CN', 'zh-TW', 'en'].includes(UI.lang)) {
    const nl = (navigator.language || '').toLowerCase();
    UI.lang = nl.startsWith('en') ? 'en'
      : (nl.includes('tw') || nl.includes('hk') || nl.includes('hant') ? 'zh-TW' : 'zh-CN');
  }
  if (!['dark', 'light'].includes(UI.theme)) {
    UI.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
}
function saveUiPref() {
  try { localStorage.setItem(LS_PREFIX + 'ui', JSON.stringify(UI)); } catch {}
}
function applyTheme() {
  document.documentElement.dataset.theme = UI.theme;
  $('#btn-theme').textContent = UI.theme === 'dark' ? '☀️' : '🌙';
}
function applyLang() {
  document.documentElement.lang = UI.lang;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.id === 'doc-name' && S.doc) return;
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => el.title = t(el.dataset.i18nTitle));
}

/* ================= 进度存取 ================= */
function loadPos(key) {
  try {
    const v = JSON.parse(localStorage.getItem(LS_PREFIX + 'pos:' + key));
    return v && typeof v.idx === 'number' ? v : null;
  } catch { return null; }
}
function savePos() {
  if (!S.key) return;
  try {
    localStorage.setItem(LS_PREFIX + 'pos:' + S.key,
      JSON.stringify({ idx: S.innerIndex, rtl: S.rtl, ts: Date.now() }));
  } catch {}
}

/* ================= 页面渲染（懒加载） ================= */
function renderPdfPage(i) {
  // 串行队列，按与当前页距离排序调度
  if (S.rendered.has(i) || i < 0 || i >= S.numPages) return Promise.resolve();
  S.rendered.add(i);
  S.renderQueue = S.renderQueue.then(async () => {
    const holder = S.pageDivs[i];
    if (!holder || holder.querySelector('canvas')) return;
    try {
      const page = await S.doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = (stage.clientHeight * S.dpr * 1.6) / base.height;
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.className = 'page-cv';
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      holder.querySelector('.ph')?.remove();
      holder.querySelector('.page-inner').appendChild(cv);
    } catch { S.rendered.delete(i); }
  });
  return S.renderQueue;
}

function ensureRendered(center) {
  const order = [];
  for (let d = 0; d <= 7; d++)
    for (const i of [center + d, center - d]) order.push(i);
  for (const i of order) renderPdfPage(i);
}

/* ================= PageFlip 初始化 ================= */
function buildPageDivs() {
  S.pageDivs = [];
  S.rendered.clear();
  for (let i = 0; i < S.numPages; i++) {
    const d = document.createElement('div');
    d.className = 'page';
    d.dataset.idx = i;
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = i + 1;
    inner.appendChild(ph);
    d.appendChild(inner);
    S.pageDivs.push(d);
  }
}

function pageBox() {
  const h = stage.clientHeight * 0.94;
  const w = h / S.pageAspect;
  const maxW = stage.clientWidth * (S.flip && S.flip.getOrientation() === 'portrait' ? 0.92 : 0.47);
  return w > maxW ? { w: maxW, h: maxW * S.pageAspect } : { w, h };
}

function initFlip(startIndex) {
  // 先把页面元素抢救到 frag 里，再销毁/重建 —— destroy() 会清空容器
  const frag = document.createDocumentFragment();
  S.pageDivs.forEach(d => frag.appendChild(d));
  if (S.flip) { try { S.flip.destroy(); } catch {} S.flip = null; }
  flipRoot.innerHTML = '';
  bookEl = document.createElement('div');
  bookEl.id = 'book';
  flipRoot.appendChild(bookEl);
  bookEl.appendChild(frag);

  const { w, h } = pageBox();
  S.flip = new St.PageFlip(bookEl, {
    width: Math.floor(w), height: Math.floor(h),
    size: 'stretch',
    minWidth: 240, maxWidth: Math.floor(w),
    minHeight: 320, maxHeight: Math.floor(h),
    autoSize: true,
    usePortrait: true,
    showCover: !S.rtl,
    drawShadow: true,
    maxShadowOpacity: 0.45,
    flippingTime: 650,
    useMouseEvents: true,
    clickEventForward: true,
    disableFlipByClick: false,
    swipeDistance: 25,
    showPageCorners: true,
    mobileScrollSupport: false,
  });
  S.flip.loadFromHTML(bookEl.querySelectorAll('.page'));
  S.flip.on('flip', e => { S.innerIndex = e.data; onPageChanged(); savePos(); });
  S.flip.on('changeOrientation', () => onPageChanged());
  if (startIndex > 0) S.flip.turnToPage(startIndex);
  S.innerIndex = S.flip.getCurrentPageIndex();
}

/* ================= 状态同步 ================= */
function visiblePages() {
  const i = S.innerIndex, n = S.numPages;
  const land = S.flip && S.flip.getOrientation() === 'landscape';
  if (!land) return [i];
  if (S.rtl) {                     // 无封面，配对 (0,1) (2,3)
    const l = i % 2 ? i - 1 : i;
    return l + 1 < n ? [l, l + 1] : [l];
  }
  if (i === 0) return [0];         // LTR 封面单页
  const l = i % 2 ? i : i - 1;
  return l + 1 < n ? [l, l + 1] : [l];
}

function onPageChanged() {
  const pages = visiblePages();
  pageInfo.textContent = pages.length > 1
    ? `${pages[0] + 1} – ${pages[1] + 1} / ${S.numPages}`
    : `${pages[0] + 1} / ${S.numPages}`;
  ensureRendered(S.innerIndex);
  thumbsEl.querySelectorAll('.thumb.cur').forEach(t => t.classList.remove('cur'));
  for (const p of pages)
    thumbsEl.querySelector(`.thumb[data-idx="${p}"]`)?.classList.add('cur');
}

/* ================= 打开文档 ================= */
async function openData(buf, key, name) {
  docName.textContent = t('loading') + name;
  try {
    S.doc = await pdfjsLib.getDocument({ data: buf }).promise;
  } catch (e) {
    docName.textContent = t('openFail') + (e && e.message || e);
    return;
  }
  S.numPages = S.doc.numPages;
  S.key = key;
  docName.textContent = name;

  const p1 = await S.doc.getPage(1);
  const v1 = p1.getViewport({ scale: 1 });
  S.pageAspect = v1.height / v1.width;

  buildPageDivs();
  const saved = loadPos(key);
  setRtl(saved ? !!saved.rtl : false);
  initFlip(saved ? Math.min(saved.idx, S.numPages - 1) : 0);
  buildThumbs();
  onPageChanged();
  dropHint.classList.add('gone');
}

/* ================= 缩略图 ================= */
let thumbIO = null;
function buildThumbs() {
  thumbsEl.innerHTML = '';
  thumbIO?.disconnect();
  thumbIO = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      thumbIO.unobserve(e.target);
      renderThumb(+e.target.dataset.idx, e.target);
    }
  }, { root: thumbsEl, rootMargin: '400px' });

  for (let i = 0; i < S.numPages; i++) {
    const t = document.createElement('div');
    t.className = 'thumb';
    t.dataset.idx = i;
    t.innerHTML = `<span class="t-no">${i + 1}</span>`;
    t.addEventListener('click', () => {
      // 跳到该页所在对开：LTR 偶数页(非0)在右→退一格；RTL 奇数页在左→退一格
      let target = i;
      if (S.flip.getOrientation() === 'landscape') {
        if (!S.rtl && i > 0 && i % 2 === 0) target = i - 1;
        if (S.rtl && i % 2 === 1) target = i - 1;
      }
      S.flip.flip(target);
    });
    thumbsEl.appendChild(t);
    thumbIO.observe(t);
  }
}

let thumbQ = Promise.resolve();
function renderThumb(i, el) {
  thumbQ = thumbQ.then(async () => {
    if (!el.isConnected || el.querySelector('canvas')) return;
    try {
      const page = await S.doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: THUMB_H / base.height });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      el.prepend(cv);
    } catch {}
  });
}

/* ================= RTL ================= */
function setRtl(on) {
  S.rtl = !!on;
  flipRoot.classList.toggle('rtl', S.rtl);
  $('#btn-rtl').classList.toggle('on', S.rtl);
}
function toggleRtl() {
  const idx = S.innerIndex;
  setRtl(!S.rtl);
  initFlip(idx);   // 重建使 showCover/配对生效
  onPageChanged();
  savePos();
}

/* ================= 缩放浮层 ================= */
const zoom = (() => {
  const ov = $('#zoom-overlay'), box = $('#zoom-box'), cv = $('#zoom-canvas');
  let z = 1, tx = 0, ty = 0, drag = null;

  function apply() { cv.style.transform = `translate(${tx}px,${ty}px) scale(${z})`; }
  async function open(pdfIdx) {
    const page = await S.doc.getPage(pdfIdx + 1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (innerHeight * S.dpr * 2.2) / base.height });
    cv.width = Math.floor(vp.width);
    cv.height = Math.floor(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    z = (innerHeight * 0.92) / (cv.height / S.dpr);
    tx = ty = 0; apply();
    cv.style.width = cv.width / S.dpr + 'px';
    ov.hidden = false;
  }
  function close() { ov.hidden = true; }

  ov.addEventListener('wheel', e => {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    z = Math.min(8, Math.max(0.2, z * k));
    apply();
  }, { passive: false });
  box.addEventListener('pointerdown', e => {
    drag = { x: e.clientX - tx, y: e.clientY - ty };
    box.classList.add('grabbing');
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply();
  });
  box.addEventListener('pointerup', () => { drag = null; box.classList.remove('grabbing'); });
  ov.addEventListener('dblclick', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  return { open, close, isOpen: () => !ov.hidden };
})();

/* ================= 事件绑定 ================= */
// 翻页方向语义始终相同：flipNext = 页码增大。镜像只影响"哪个按键/哪侧点击=前进"。
// 视觉上的手势/点击已在镜像容器内自动反向，这里只需要交换键盘映射。
function nextPage() { S.rtl ? S.flip.flipPrev() : S.flip.flipNext(); }
function prevPage() { S.rtl ? S.flip.flipNext() : S.flip.flipPrev(); }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && zoom.isOpen()) return zoom.close();
  if (!S.flip) return;
  switch (e.key) {
    case 'ArrowRight': case ' ': case 'PageDown':
      e.preventDefault(); nextPage(); break;
    case 'ArrowLeft': case 'PageUp':
      e.preventDefault(); prevPage(); break;
    case 'Home': S.flip.turnToPage(0); break;
    case 'End': S.flip.turnToPage(S.numPages - 1); break;
    case 'f': case 'F':
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      break;
    case 't': case 'T': toggleSidebar(); break;
    case 'r': case 'R': toggleRtl(); break;
  }
});

function toggleSidebar() {
  S.sidebar = !S.sidebar;
  $('#sidebar').classList.toggle('hidden', !S.sidebar);
  $('#btn-thumbs').classList.toggle('on', S.sidebar);
}

$('#btn-theme').addEventListener('click', () => {
  UI.theme = UI.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); saveUiPref();
});
$('#lang-sel').addEventListener('change', e => {
  UI.lang = e.target.value;
  applyLang(); saveUiPref();
});
$('#btn-thumbs').addEventListener('click', toggleSidebar);
$('#btn-rtl').addEventListener('click', () => S.flip && toggleRtl());
$('#btn-full').addEventListener('click', () =>
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
$('#btn-open').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openData(await f.arrayBuffer(), `file:${f.name}:${f.size}`, f.name);
});

['dragenter', 'dragover'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('dragover'); }));
stage.addEventListener('drop', async e => {
  const f = [...(e.dataTransfer?.files || [])].find(f => /\.pdf$/i.test(f.name));
  if (f) openData(await f.arrayBuffer(), `file:${f.name}:${f.size}`, f.name);
});

// 双击页面 → 放大浮层（挂在稳定的 flipRoot 上，#book 重建后仍有效）
flipRoot.addEventListener('dblclick', e => {
  const p = e.target.closest('.page');
  if (p) zoom.open(+p.dataset.idx);
});

/* ================= 书架（serve.py 模式） ================= */
async function loadShelf() {
  let books;
  try {
    const r = await fetch('/api/books');
    if (!r.ok) return;
    books = await r.json();
  } catch { return; }
  if (!books.length) return;
  $('#shelf-box').hidden = false;
  $('#shelf-hint').hidden = false;
  const shelf = $('#shelf');
  for (const b of books) {
    const btn = document.createElement('button');
    btn.className = 'shelf-item';
    btn.textContent = b.name.replace(/\.pdf$/i, '');
    btn.title = b.name;
    btn.addEventListener('click', async () => {
      shelf.querySelectorAll('.shelf-item.cur').forEach(x => x.classList.remove('cur'));
      btn.classList.add('cur');
      const buf = await (await fetch(b.url)).arrayBuffer();
      openData(buf, 'lib:' + b.name, b.name);
    });
    shelf.appendChild(btn);
  }
  // ?book=name 直接打开书架上的书
  const want = new URLSearchParams(location.search).get('book');
  if (want) {
    const b = books.find(x => x.name === want || x.name === want + '.pdf');
    if (b) {
      const buf = await (await fetch(b.url)).arrayBuffer();
      openData(buf, 'lib:' + b.name, b.name);
    }
  }
}

loadUiPref();
$('#lang-sel').value = UI.lang;
applyTheme();
applyLang();
loadShelf();
})();
