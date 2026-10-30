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
const homeEl = $('#home'), homeGrid = $('#home-grid'), flipRoot = $('#flip-root');
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
    hlTitle: '高亮标记 (1)', penTitle: '波浪下划线 (2)', noteTitle: '添加笔记 (3)', eraseTitle: '擦除批注 (4)',
    annots: '批注', noAnnots: '还没有笔记', pageNo: '第{n}页',
    recent: '最近打开', openLocal: '打开本地 PDF', homeTitle: '返回书架',
    delShelfTitle: '删除该文件', delRecentTitle: '从最近记录移除',
    confirmDel: '确定删除"{n}"吗？books/ 里的文件也会被删掉。',
    notePh: '写点什么…', delete: '删除', ok: '完成',
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
    hlTitle: '高亮標記 (1)', penTitle: '波浪底線 (2)', noteTitle: '新增筆記 (3)', eraseTitle: '清除註解 (4)',
    annots: '註解', noAnnots: '尚無筆記', pageNo: '第{n}頁',
    recent: '最近開啟', openLocal: '開啟本機 PDF', homeTitle: '返回書架',
    delShelfTitle: '刪除該檔案', delRecentTitle: '從最近記錄移除',
    confirmDel: '確定刪除「{n}」嗎？books/ 裡的檔案也會被刪除。',
    notePh: '寫點什麼…', delete: '刪除', ok: '完成',
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
    hlTitle: 'Highlight (1)', penTitle: 'Wavy underline (2)', noteTitle: 'Add note (3)', eraseTitle: 'Eraser (4)',
    annots: 'Notes', noAnnots: 'No notes yet', pageNo: 'p.{n}',
    recent: 'Recent', openLocal: 'Open a local PDF', homeTitle: 'Back to shelf',
    delShelfTitle: 'Delete this file', delRecentTitle: 'Remove from recent',
    confirmDel: 'Delete "{n}"? The file in books/ will be removed.',
    notePh: 'Write a note…', delete: 'Delete', ok: 'Done',
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
  renderRecent(); renderHome();   // 动态生成的书架/首页文案跟着语言走
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
    const asvg = document.createElementNS(ANN_NS, 'svg');
    asvg.setAttribute('class', 'annot-svg');
    asvg.setAttribute('viewBox', '0 0 1 1');
    asvg.setAttribute('preserveAspectRatio', 'none');
    inner.appendChild(asvg);
    const pins = document.createElement('div');
    pins.className = 'ann-pins';
    inner.appendChild(pins);
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
async function openData(buf, key, name, opts = {}) {
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
  loadAnnots();
  drawAllAnnots();
  renderAnnotList();
  setAnnotTool(null);
  onPageChanged();
  homeEl.hidden = true;
  textCache.clear();
  if (opts.remember) {
    addRecent(key, name, buf.byteLength);
    if (opts.blob) idb.put(key, opts.blob).catch(() => {});
  }
}

//  zurück zum Bücherregal: Dokument schließen, Bühne leeren, Regal zeigen
function closeDoc() {
  if (!S.doc) {
    homeEl.hidden = false;
    return;
  }
  savePos(); persistAnnots();
  setAnnotTool(null);
  closeNotePop();
  if (S.flip) { try { S.flip.destroy(); } catch {} S.flip = null; }
  try { S.doc.destroy(); } catch {}
  flipRoot.innerHTML = '';
  bookEl = document.createElement('div');
  bookEl.id = 'book';
  flipRoot.appendChild(bookEl);
  S.doc = null; S.key = null; S.numPages = 0; S.pageDivs = [];
  S.rendered.clear();
  thumbIO?.disconnect();
  thumbsEl.innerHTML = '';
  ANN.items = [];
  renderAnnotList();
  textCache.clear();
  docName.textContent = t('noDoc');
  pageInfo.textContent = '';
  renderShelfItems(); renderRecent(); renderHome();
  homeEl.hidden = false;
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
    t.addEventListener('click', () => jumpToPage(i));
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

/* ================= 批注（高亮 / 划线 / 笔记 / 擦除） ================= */
const ANN_NS = 'http://www.w3.org/2000/svg';
const annotsEl = $('#annots'), notePop = $('#note-pop');
const ANN = { tool: null, items: [], color: '#ffd24d' };
let annSeq = 1, annTimer = null, popId = null;
const escapeHtml = s => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadAnnots() {
  try { ANN.items = (JSON.parse(localStorage.getItem(LS_PREFIX + 'ann:' + S.key)) || {}).items || []; }
  catch { ANN.items = []; }
  annSeq = ANN.items.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1;
}
function persistAnnots() {
  clearTimeout(annTimer);
  try { localStorage.setItem(LS_PREFIX + 'ann:' + S.key, JSON.stringify({ items: ANN.items })); } catch {}
}
function saveAnnots() {
  clearTimeout(annTimer);
  annTimer = setTimeout(persistAnnots, 400);
}

function penD(pts) {
  return pts.map((q, j) => (j ? 'L' : 'M') + q[0].toFixed(4) + ' ' + q[1].toFixed(4)).join(' ');
}

function drawPageAnnots(i) {
  const host = S.pageDivs[i]; if (!host) return;
  const svg = host.querySelector('.annot-svg'), pins = host.querySelector('.ann-pins');
  svg.replaceChildren(); pins.replaceChildren();
  const noteIdx = id => ANN.items.filter(a => a.type === 'note').findIndex(a => a.id === id) + 1;
  for (const a of ANN.items.filter(a => a.page === i)) {
    if (a.type === 'note') {
      const p = document.createElement('div');
      p.className = 'note-pin';
      p.dataset.annId = a.id;
      p.style.left = a.x * 100 + '%';
      p.style.top = a.y * 100 + '%';
      p.innerHTML = `<span>${noteIdx(a.id)}</span>`;
      pins.appendChild(p);
    } else if (a.type === 'rect') {
      const r = document.createElementNS(ANN_NS, 'rect');
      r.setAttribute('x', a.x); r.setAttribute('y', a.y);
      r.setAttribute('width', a.w); r.setAttribute('height', a.h);
      r.setAttribute('fill', a.color); r.setAttribute('fill-opacity', .35);
      r.classList.add('ann', 'hl-rect');
      r.dataset.annId = a.id;
      svg.appendChild(r);
    } else if (a.type === 'pen') {
      const p = document.createElementNS(ANN_NS, 'path');
      p.setAttribute('d', penD(a.pts));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', a.color);
      p.setAttribute('stroke-width', 3);
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      p.classList.add('ann');
      p.dataset.annId = a.id;
      svg.appendChild(p);
    }
  }
}
function drawAllAnnots() { for (let i = 0; i < S.numPages; i++) drawPageAnnots(i); }

function setAnnotTool(tool) {
  ANN.tool = tool;
  for (const id of ['hl', 'pen', 'note', 'erase'])
    $('#btn-' + id).classList.toggle('on', tool === id);
  $('#annot-pal').hidden = !(tool === 'hl' || tool === 'pen');
  document.querySelectorAll('.annot-svg').forEach(svg => {
    svg.classList.toggle('active', tool === 'hl' || tool === 'pen' || tool === 'note');
    svg.classList.toggle('erase', tool === 'erase');
  });
}

function openNotePop(id, rect) {
  const a = ANN.items.find(x => x.id === id); if (!a) return;
  popId = id;
  notePop.innerHTML = `<textarea placeholder="${t('notePh')}">${escapeHtml(a.text || '')}</textarea>
    <div class="np-row"><button class="np-del">${t('delete')}</button><button class="np-ok">${t('ok')}</button></div>`;
  const W = 250;
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - W / 2), innerWidth - W - 8);
  let y = rect.bottom + 8;
  if (y + 170 > innerHeight) y = Math.max(8, rect.top - 178);
  notePop.style.left = x + 'px'; notePop.style.top = y + 'px';
  notePop.hidden = false;
  const ta = notePop.querySelector('textarea');
  ta.focus();
  ta.addEventListener('input', () => { a.text = ta.value; saveAnnots(); });
  notePop.querySelector('.np-del').addEventListener('click', () => {
    ANN.items = ANN.items.filter(x => x.id !== id);
    drawPageAnnots(a.page); persistAnnots(); renderAnnotList(); closeNotePop();
  });
  notePop.querySelector('.np-ok').addEventListener('click', () => {
    persistAnnots(); renderAnnotList(); closeNotePop();
  });
}
function closeNotePop() {
  notePop.hidden = true; popId = null;
  if (document.activeElement) document.activeElement.blur();
}
document.addEventListener('pointerdown', e => {
  if (!notePop.hidden && !e.target.closest('#note-pop') && !e.target.closest('.note-pin')) closeNotePop();
}, true);

// 绘图事件（capture 阶段拦截，避免与翻页手势冲突）
flipRoot.addEventListener('pointerdown', e => {
  const pin = e.target.closest && e.target.closest('.note-pin');
  if (pin) {
    e.preventDefault(); e.stopPropagation();
    openNotePop(+pin.dataset.annId, pin.getBoundingClientRect());
    return;
  }
  if (!ANN.tool || !S.doc) return;
  if (ANN.tool === 'erase') {
    const hit = e.target.closest && e.target.closest('.ann, .note-pin');
    if (hit) {
      e.preventDefault(); e.stopPropagation();
      const id = +hit.dataset.annId;
      const host = hit.closest('.page');
      ANN.items = ANN.items.filter(a => a.id !== id);
      drawPageAnnots(+host.dataset.idx); saveAnnots(); renderAnnotList();
    }
    return;
  }
  const svg = e.target.closest && e.target.closest('.annot-svg');
  if (!svg) return;
  e.preventDefault(); e.stopPropagation();
  const host = svg.closest('.page'), page = +host.dataset.idx;
  const r = svg.getBoundingClientRect();
  const nx = ev => Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  const ny = ev => Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));

  if (ANN.tool === 'note') {
    const it = { id: annSeq++, type: 'note', page, x: nx(e), y: ny(e), text: '' };
    ANN.items.push(it);
    drawPageAnnots(page); saveAnnots(); renderAnnotList();
    const pel = host.querySelector(`.note-pin[data-ann-id="${it.id}"]`);
    openNotePop(it.id, pel.getBoundingClientRect());
    return;
  }
  if (ANN.tool === 'pen') {
    // 波浪下划线：拖动取水平范围，松手生成规整正弦波（不按手绘轨迹）
    const x0 = nx(e), y0 = ny(e);
    const it = { id: annSeq++, type: 'pen', page, pts: [], color: ANN.color };
    ANN.items.push(it);
    const path = document.createElementNS(ANN_NS, 'path');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', it.color);
    path.setAttribute('stroke-width', 2.5);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    path.classList.add('ann'); path.dataset.annId = it.id;
    svg.appendChild(path);
    const update = x1 => {
      const a = Math.min(x0, x1), b = Math.max(x0, x1);
      it.pts = wavePts(a, b, y0);
      path.setAttribute('d', penD(it.pts));
    };
    update(x0);
    const move = ev => update(nx(ev));
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const a0 = it.pts[0][0], b0 = it.pts[it.pts.length - 1][0];
      if (b0 - a0 < 0.008) {
        ANN.items = ANN.items.filter(a => a.id !== it.id);   // 太短的误触丢弃
        drawPageAnnots(page);
        return saveAnnots();
      }
      // 自适应：找到附近文字行，按字号定振幅/波长，并吸附到基线下方
      const line = await textLineNear(page, a0, b0, y0);
      if (line) {
        const amp = Math.min(0.006, Math.max(0.002, line.hN * 0.16));
        const wl = Math.min(0.03, Math.max(0.010, line.hN * 1.2));
        it.pts = wavePts(a0, b0, Math.min(1, line.baseN + line.hN * 0.28), amp, wl);
      } else {
        it.pts = wavePts(a0, b0, y0, 0.0035, 0.016);
      }
      drawPageAnnots(page);
      saveAnnots();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return;
  }
  if (ANN.tool === 'hl') {
    // 荧光笔刷：固定行高色带，以起点行为准随拖动横向延展
    const HL_H = 0.026;
    const x0 = nx(e);
    const y0 = Math.min(1 - HL_H, Math.max(0, ny(e) - HL_H / 2));
    const it = { id: annSeq++, type: 'rect', page, x: x0, y: y0, w: 0, h: HL_H, color: ANN.color };
    ANN.items.push(it);
    const rect = document.createElementNS(ANN_NS, 'rect');
    rect.setAttribute('fill', it.color); rect.setAttribute('fill-opacity', .35);
    rect.setAttribute('rx', HL_H / 2); rect.setAttribute('ry', 0.004);
    rect.classList.add('ann', 'hl-rect'); rect.dataset.annId = it.id;
    svg.appendChild(rect);
    const move = ev => {
      const x1 = nx(ev);
      it.x = Math.min(x0, x1); it.w = Math.abs(x1 - x0);
      rect.setAttribute('x', it.x); rect.setAttribute('y', it.y);
      rect.setAttribute('width', it.w); rect.setAttribute('height', it.h);
    };
    move(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (it.w < 0.006) {   // 误触的小条丢弃
        ANN.items = ANN.items.filter(a => a.id !== it.id);
        drawPageAnnots(page);
      }
      saveAnnots();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}, true);

// 用 pdf.js 文本提取找拖动位置附近的文字行，返回归一化行高与基线位置
const textCache = new Map();
async function textLineNear(i, nx0, nx1, ny) {
  try {
    let pg = textCache.get(i);
    if (!pg) {
      const page = await S.doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      pg = { w: base.width, h: base.height, items: tc.items.filter(x => x.height > 0) };
      textCache.set(i, pg);
    }
    const yPdf = (1 - ny) * pg.h;
    let best = null, bestD = Infinity;
    for (const it of pg.items) {
      const x = it.transform[4], y = it.transform[5];
      if (x + it.width < nx0 * pg.w || x > nx1 * pg.w) continue;
      const d = Math.abs(y - yPdf);
      if (d < bestD) { bestD = d; best = { hN: it.height / pg.h, baseN: 1 - y / pg.h, dN: d / pg.h }; }
    }
    return best && best.dN < Math.max(best.hN * 2, 0.03) ? best : null;
  } catch { return null; }
}

// 正弦波浪点列：a→b 归一化横坐标，y 为中心线
function wavePts(a, b, y, amp = 0.0035, wl = 0.016) {
  const n = Math.max(6, Math.round((b - a) / (wl / 6)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = a + (b - a) * i / n;
    pts.push([x, y + amp * Math.sin(2 * Math.PI * (x - a) / wl)]);
  }
  return pts;
}

// 按钮悬停提示（替代原生 title，显示快、配色跟随主题）
const tipEl = $('#tip');
let tipFor = null;
document.addEventListener('mouseover', e => {
  const b = e.target.closest && e.target.closest('.tb-btn');
  if (!b || !b.title || b === tipFor) return;
  b.dataset.tipText = b.title;
  b.removeAttribute('title');          // 抑制原生 tooltip
  const r = b.getBoundingClientRect();
  tipEl.textContent = b.dataset.tipText;
  tipEl.style.left = Math.min(Math.max(70, r.left + r.width / 2), innerWidth - 70) + 'px';
  tipEl.style.top = (r.bottom + 6) + 'px';
  tipEl.hidden = false;
  tipFor = b;
});
document.addEventListener('mouseout', e => {
  if (!tipFor) return;
  const b = e.target.closest && e.target.closest('.tb-btn');
  if (b !== tipFor) return;
  tipFor.title = tipFor.dataset.tipText;
  tipFor = null;
  tipEl.hidden = true;
});

function renderAnnotList() {
  const notes = ANN.items.filter(a => a.type === 'note');
  annotsEl.innerHTML = notes.length ? '' : `<div class="annot-empty">${t('noAnnots')}</div>`;
  notes.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'annot-item';
    row.innerHTML = `<span class="ai-pin"><i>${i + 1}</i></span>` +
      `<span class="ai-pg">${t('pageNo').replace('{n}', a.page + 1)}</span>` +
      `<span class="ai-text">${escapeHtml(a.text || '…')}</span>`;
    row.addEventListener('click', () => jumpToPage(a.page));
    annotsEl.appendChild(row);
  });
}

$('#btn-hl').addEventListener('click', () => setAnnotTool(ANN.tool === 'hl' ? null : 'hl'));
$('#btn-pen').addEventListener('click', () => setAnnotTool(ANN.tool === 'pen' ? null : 'pen'));
$('#btn-note').addEventListener('click', () => setAnnotTool(ANN.tool === 'note' ? null : 'note'));
$('#btn-erase').addEventListener('click', () => setAnnotTool(ANN.tool === 'erase' ? null : 'erase'));
document.querySelectorAll('#annot-pal .pc').forEach(b =>
  b.addEventListener('click', () => {
    ANN.color = b.dataset.c;
    document.querySelectorAll('#annot-pal .pc').forEach(x => x.classList.toggle('on', x === b));
  }));

/* ================= 事件绑定 ================= */
// 翻页方向语义始终相同：flipNext = 页码增大。镜像只影响"哪个按键/哪侧点击=前进"。
// 视觉上的手势/点击已在镜像容器内自动反向，这里只需要交换键盘映射。
function nextPage() { S.rtl ? S.flip.flipPrev() : S.flip.flipNext(); }
function prevPage() { S.rtl ? S.flip.flipNext() : S.flip.flipPrev(); }

// 跳到该页所在对开：LTR 偶数页(非0)在右→退一格；RTL 奇数页在左→退一格
function jumpToPage(i) {
  let target = i;
  if (S.flip.getOrientation() === 'landscape') {
    if (!S.rtl && i > 0 && i % 2 === 0) target = i - 1;
    if (S.rtl && i % 2 === 1) target = i - 1;
  }
  S.flip.flip(target);
}

document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('textarea, input, select')) {
    if (e.key === 'Escape') { e.target.blur(); closeNotePop(); }
    return;
  }
  if (e.key === 'Escape') {
    if (zoom.isOpen()) return zoom.close();
    closeNotePop();
    if (ANN.tool) return setAnnotTool(null);
    return;
  }
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
    case '1': setAnnotTool(ANN.tool === 'hl' ? null : 'hl'); break;
    case '2': setAnnotTool(ANN.tool === 'pen' ? null : 'pen'); break;
    case '3': setAnnotTool(ANN.tool === 'note' ? null : 'note'); break;
    case '4': setAnnotTool(ANN.tool === 'erase' ? null : 'erase'); break;
    case '0': setAnnotTool(null); break;
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
$('#btn-home').addEventListener('click', closeDoc);

$('#file-input').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openData(await f.arrayBuffer(), `file:${f.name}:${f.size}`, f.name, { remember: true, blob: f });
});

['dragenter', 'dragover'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('dragover'); }));
stage.addEventListener('drop', async e => {
  const f = [...(e.dataTransfer?.files || [])].find(f => /\.pdf$/i.test(f.name));
  if (f) openData(await f.arrayBuffer(), `file:${f.name}:${f.size}`, f.name, { remember: true, blob: f });
});

// 双击页面 → 放大浮层（挂在稳定的 flipRoot 上，#book 重建后仍有效）
flipRoot.addEventListener('dblclick', e => {
  const p = e.target.closest('.page');
  if (p) zoom.open(+p.dataset.idx);
});

/* ================= IndexedDB：最近打开的文件本体 ================= */
const idb = {
  db: null,
  open() {
    return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
      const r = indexedDB.open('magreader', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(mode, fn) {
    return this.open().then(d => new Promise((res, rej) => {
      const t = d.transaction('files', mode);
      const out = fn(t.objectStore('files'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    }));
  },
  put(k, v) { return this.tx('readwrite', s => s.put(v, k)); },
  get(k) {
    return this.open().then(d => new Promise((res, rej) => {
      const q = d.transaction('files').objectStore('files').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    }));
  },
  del(k) { return this.tx('readwrite', s => s.delete(k)); },
};

/* ================= 最近打开 ================= */
const recentEl = $('#recent'), recentBox = $('#recent-box');
function getRecent() {
  try { return JSON.parse(localStorage.getItem(LS_PREFIX + 'recent')) || []; } catch { return []; }
}
function setRecent(l) {
  try { localStorage.setItem(LS_PREFIX + 'recent', JSON.stringify(l.slice(0, 12))); } catch {}
}
function addRecent(key, name, size) {
  setRecent([{ key, name, size, ts: Date.now() }, ...getRecent().filter(x => x.key !== key)]);
  renderRecent();
}
function removeRecent(key) {
  setRecent(getRecent().filter(x => x.key !== key));
  idb.del(key).catch(() => {});
  try { localStorage.removeItem(LS_PREFIX + 'cover:' + key); } catch {}
  renderRecent(); renderHome();
}
function renderRecent() {
  const l = getRecent();
  recentBox.hidden = !l.length;
  recentEl.innerHTML = '';
  for (const r of l) {
    const row = document.createElement('div');
    row.className = 'shelf-row';
    const b = document.createElement('button');
    b.className = 'shelf-item' + (S.key === r.key ? ' cur' : '');
    b.textContent = r.name.replace(/\.pdf$/i, '');
    b.title = r.name;
    b.addEventListener('click', async () => {
      try {
        const bl = await idb.get(r.key);
        if (!bl) return removeRecent(r.key);
        openData(await bl.arrayBuffer(), r.key, r.name, { remember: true });
      } catch { removeRecent(r.key); }
    });
    const d = document.createElement('button');
    d.className = 'shelf-del'; d.textContent = '×'; d.title = t('delRecentTitle');
    d.addEventListener('click', ev => { ev.stopPropagation(); removeRecent(r.key); });
    row.append(b, d);
    recentEl.appendChild(row);
  }
}

/* ================= 封面渲染（缓存到 localStorage） ================= */
async function coverFor(key, source) {
  const ck = LS_PREFIX + 'cover:' + key;
  try { const c = localStorage.getItem(ck); if (c) return c; } catch {}
  const buf = await source();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const p = await doc.getPage(1);
    const base = p.getViewport({ scale: 1 });
    const vp = p.getViewport({ scale: 440 / base.height });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    await p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const url = cv.toDataURL('image/jpeg', .72);
    try { localStorage.setItem(ck, url); } catch {}
    return url;
  } finally { doc.destroy(); }
}
let coverQ = Promise.resolve();
function queueCover(cardEl, key, source) {
  coverQ = coverQ.then(async () => {
    if (!cardEl.isConnected) return;
    try {
      const u = await coverFor(key, source);
      cardEl.querySelector('.hc-img').style.backgroundImage = `url("${u}")`;
      cardEl.classList.add('has-cover');
    } catch {}
  });
}

/* ================= 书架首页 ================= */
function homeCard({ name, open, del, coverKey, coverSrc }) {
  const c = document.createElement('div');
  c.className = 'hcard';
  c.innerHTML = `<div class="hc-img">${del ? '<button class="hc-del">×</button>' : ''}</div>` +
    `<div class="hc-name">${escapeHtml(name)}</div>`;
  c.querySelector('.hc-img').addEventListener('click', open);
  if (del) c.querySelector('.hc-del').addEventListener('click', ev => { ev.stopPropagation(); del(); });
  if (coverSrc) queueCover(c, coverKey, coverSrc);
  return c;
}

function renderHome() {
  homeGrid.innerHTML = '';
  for (const b of (S.shelfBooks || [])) {
    homeGrid.appendChild(homeCard({
      name: b.name.replace(/\.pdf$/i, ''),
      open: async () => openData(await (await fetch(b.url)).arrayBuffer(), 'lib:' + b.name, b.name),
      del: () => delShelfBook(b),
      coverKey: 'lib:' + b.name,
      coverSrc: () => fetch(b.url).then(r => r.arrayBuffer()),
    }));
  }
  for (const r of getRecent()) {
    homeGrid.appendChild(homeCard({
      name: r.name.replace(/\.pdf$/i, ''),
      open: async () => {
        try {
          const bl = await idb.get(r.key);
          if (!bl) return removeRecent(r.key);
          openData(await bl.arrayBuffer(), r.key, r.name, { remember: true });
        } catch { removeRecent(r.key); }
      },
      del: () => removeRecent(r.key),
      coverKey: r.key,
      coverSrc: () => idb.get(r.key).then(bl => bl.arrayBuffer()),
    }));
  }
  const oc = document.createElement('div');
  oc.className = 'hcard open-card';
  oc.innerHTML = `<div class="hc-img"></div><div class="hc-name">${t('openLocal')}</div>`;
  oc.querySelector('.hc-img').addEventListener('click', () => $('#file-input').click());
  homeGrid.appendChild(oc);
}

/* ================= 书架（serve.py 模式） ================= */
function delShelfBook(b) {
  if (!confirm(t('confirmDel').replace('{n}', b.name))) return;
  fetch(b.url, { method: 'DELETE' }).then(r => {
    if (!r.ok && r.status !== 204) return;
    S.shelfBooks = (S.shelfBooks || []).filter(x => x !== b);
    try { localStorage.removeItem(LS_PREFIX + 'cover:lib:' + b.name); } catch {}
    renderShelfItems(); renderHome();
  });
}

function renderShelfItems() {
  const shelf = $('#shelf');
  shelf.innerHTML = '';
  for (const b of (S.shelfBooks || [])) {
    const row = document.createElement('div');
    row.className = 'shelf-row';
    const btn = document.createElement('button');
    btn.className = 'shelf-item' + (S.key === 'lib:' + b.name ? ' cur' : '');
    btn.textContent = b.name.replace(/\.pdf$/i, '');
    btn.title = b.name;
    btn.addEventListener('click', async () => {
      shelf.querySelectorAll('.shelf-item.cur').forEach(x => x.classList.remove('cur'));
      btn.classList.add('cur');
      openData(await (await fetch(b.url)).arrayBuffer(), 'lib:' + b.name, b.name);
    });
    const d = document.createElement('button');
    d.className = 'shelf-del'; d.textContent = '×'; d.title = t('delShelfTitle');
    d.addEventListener('click', ev => { ev.stopPropagation(); delShelfBook(b); });
    row.append(btn, d);
    shelf.appendChild(row);
  }
}

async function loadShelf() {
  let books;
  try {
    const r = await fetch('/api/books');
    if (!r.ok) return;
    books = await r.json();
  } catch { return; }
  S.shelfBooks = books;
  $('#shelf-box').hidden = !books.length;
  renderShelfItems();
  renderHome();
  // ?book=name 直接打开书架上的书
  const want = new URLSearchParams(location.search).get('book');
  if (want) {
    const b = books.find(x => x.name === want || x.name === want + '.pdf');
    if (b) openData(await (await fetch(b.url)).arrayBuffer(), 'lib:' + b.name, b.name);
  }
}

loadUiPref();
$('#lang-sel').value = UI.lang;
applyTheme();
applyLang();
renderRecent();
renderHome();
loadShelf();
})();
