/* ═══════════════════════════════════════════════
   灰星内部终端 · 逻辑层
   ═══════════════════════════════════════════════ */
"use strict";

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const expandedSidebarBranches = new Set();
const collapsedSidebarBranches = new Set();
let activeSidebarId = null;

function clsBadge(c) { return 'cls cls-' + c; }
function clsName(c) {
  return { pub:'公开', int:'内部', res:'限制', sec:'机密' }[c] || '内部';
}

/* ─────────── 启动 ─────────── */
let entered = false;
function enterApp() {
  if (entered) return;
  entered = true;
  document.removeEventListener('click', enterApp);
  document.removeEventListener('keydown', enterApp);
  const boot = $('#boot'), app = $('#app');
  if (boot) boot.classList.add('gone');
  if (app)  app.classList.add('ready');
  try { start(); } catch (e) { console.error(e); }
}
async function runBoot() {
  await sleep(900);
  const prompt = $('#bootprompt');
  if (prompt) prompt.hidden = false;
  document.addEventListener('click', enterApp);
  document.addEventListener('keydown', enterApp);
  setTimeout(enterApp, 4000);
}

/* ─────────── 术语提示 ─────────── */
let tipEl = null;
function initTip() {
  tipEl = $('#tip'); if (!tipEl) return;
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('.term'); if (!t) return;
    const tip = t.dataset.tip; if (!tip) return;
    tipEl.querySelector('.tip-k').textContent = '术语';
    tipEl.querySelector('.tip-b').textContent = tip;
    tipEl.classList.add('on');
    moveTip(e);
  });
  document.addEventListener('mousemove', e => {
    if (tipEl.classList.contains('on')) moveTip(e);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('.term')) tipEl.classList.remove('on');
  });
}
function moveTip(e) {
  if (!tipEl) return;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + w > window.innerWidth - 10)  x = e.clientX - w - 14;
  if (y + h > window.innerHeight - 10) y = e.clientY - h - 16;
  tipEl.style.left = x + 'px';
  tipEl.style.top  = y + 'px';
}
function markupTerms(root) {
  if (!root || typeof TERMS === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentNode;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
      if (p.classList && p.classList.contains('term')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n; while ((n = walker.nextNode())) nodes.push(n);
  const keys = Object.keys(TERMS).sort((a, b) => b.length - a.length);
  for (const node of nodes) {
    const text = node.nodeValue;
    let replaced = text, touched = false;
    for (const k of keys) {
      if (replaced.includes(k)) {
        replaced = replaced.split(k).join('\u0001' + k + '\u0002');
        touched = true;
      }
    }
    if (!touched) continue;
    const frag = document.createDocumentFragment();
    const parts = replaced.split('\u0001');
    parts.forEach((part, i) => {
      if (i === 0) { frag.appendChild(document.createTextNode(part)); return; }
      const idx = part.indexOf('\u0002');
      if (idx < 0) { frag.appendChild(document.createTextNode(part)); return; }
      const term = part.slice(0, idx);
      const rest = part.slice(idx + 1);
      const span = document.createElement('span');
      span.className = 'term';
      span.dataset.tip = TERMS[term] || '';
      span.textContent = term;
      frag.appendChild(span);
      frag.appendChild(document.createTextNode(rest));
    });
    node.parentNode.replaceChild(frag, node);
  }
}

/* ─────────── 工具：查找祖先链 ─────────── */
function findChain(id, items, chain) {
  for (const item of items) {
    if (item.id === id) return chain.slice();
    if (item.sub) {
      const r = findChain(id, item.sub, chain.concat([item.id]));
      if (r) return r;
    }
  }
  return null;
}
function getAncestors(id) {
  for (const group of NAV) {
    const r = findChain(id, group.items || [], []);
    if (r) return r;
  }
  return [];
}
function findTopId(id) {
  for (const group of NAV) {
    for (const item of (group.items || [])) {
      if (item.id === id) return item.id;
      if (item.sub) {
        const r = findChain(id, item.sub, []);
        if (r) return item.id;
      }
    }
  }
  return null;
}

/* ─────────── 导航 ─────────── */
function renderNavEntry(item, depth) {
  const entry = document.createElement('div');
  entry.className = 'side-entry';

  const row = document.createElement('div');
  row.className = depth === 0
    ? 'side-item'
    : depth === 1 ? 'side-sub-item' : 'side-sub-item side-sub-item-2';
  row.dataset.id = item.id;

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'side-entry-main';

  const title = document.createElement('div');
  title.className = depth === 0 ? 'si-title' : 'sub-title';
  title.textContent = item.title;
  if (depth > 0) {
    const marker = document.createElement('span');
    marker.className = 'sub-mark';
    marker.textContent = depth === 1 ? '└' : '·';
    main.appendChild(marker);
  }
  main.appendChild(title);

  const badgeText = item.badge || item.note;
  if (badgeText) {
    const badges = document.createElement('div');
    badges.className = depth === 0 ? 'si-tags' : 'si-tags side-sub-tags';
    const badge = document.createElement('span');
    badge.className = item.badge ? 'si-tag si-tag-req' : 'si-tag si-tag-note';
    badge.textContent = badgeText;
    badges.appendChild(badge);
    main.appendChild(badges);
  }
  row.appendChild(main);

  const children = Array.isArray(item.sub) ? item.sub : [];
  let childListId = '';
  if (children.length) {
    childListId = 'side-children-' + item.id;
    main.classList.add('has-children');
    main.setAttribute('aria-expanded', 'false');
    main.setAttribute('aria-controls', childListId);
    main.setAttribute('aria-label', item.title + '，展开或收起子条目');
    main.addEventListener('click', () => {
      const isOpen = main.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        expandedSidebarBranches.delete(item.id);
        collapsedSidebarBranches.add(item.id);
      } else {
        collapsedSidebarBranches.delete(item.id);
        expandedSidebarBranches.add(item.id);
      }
      updateSidebarContext(activeSidebarId);
    });
  } else {
    main.addEventListener('click', () => {
      expandedSidebarBranches.clear();
      collapsedSidebarBranches.clear();
      showDoc(item.id);
    });
  }
  entry.appendChild(row);

  if (children.length) {
    const childList = document.createElement('div');
    childList.className = 'side-sub';
    childList.id = childListId;
    childList.hidden = true;
    children.forEach(child => childList.appendChild(renderNavEntry(child, depth + 1)));
    entry.appendChild(childList);
  }
  return entry;
}

function updateSidebarContext(activeId) {
  const list = $('#navlist');
  if (!list) return;
  const path = activeId ? getAncestors(activeId).concat(activeId) : [];

  function updateEntries(container, depth) {
    Array.from(container.children).forEach(entry => {
      if (!entry.classList.contains('side-entry')) return;
      const row = entry.firstElementChild;
      const children = entry.querySelector(':scope > .side-sub');
      if (!row || !children) return;

      const id = row.dataset.id;
      const followsReadingPath = depth < path.length - 1 && path[depth] === id;
      const isExpanded = expandedSidebarBranches.has(id);
      const open = !collapsedSidebarBranches.has(id) && (followsReadingPath || isExpanded);
      const main = row.querySelector('.side-entry-main.has-children');
      if (main) {
        main.setAttribute('aria-expanded', String(open));
      }
      children.hidden = !open;
      if (open) updateEntries(children, depth + 1);
    });
  }

  updateEntries(list, 0);
}

function buildNav() {
  const list = $('#navlist'); if (!list) return;
  list.innerHTML = '';

  NAV.forEach(group => {
    const g = document.createElement('div');
    g.className = 'side-group';
    g.textContent = group.group;
    list.appendChild(g);

    const items = group.items || [];
    if (!items.length && !(group.subheadings && group.subheadings.length)) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.textContent = '（暂无条目）';
      list.appendChild(empty);
    }

    items.forEach(item => {
      list.appendChild(renderNavEntry(item, 0));
    });

    (group.subheadings || []).forEach(entry => {
      const heading = document.createElement('div');
      heading.className = 'side-static-subheading';
      heading.textContent = typeof entry === 'string'
        ? entry
        : (entry && (entry.title || entry.text || entry.href || entry.url)) || '';
      list.appendChild(heading);
    });
  });
  updateSidebarContext(activeSidebarId);
}

/* ─────────── 滚动观察器 ─────────── */
let scrollObserver = null;
let scrollWrap = null;
let scrollHandler = null;

function clearScrollObserver() {
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }
  if (scrollWrap && scrollHandler) {
    scrollWrap.removeEventListener('scroll', scrollHandler);
  }
  scrollWrap = null;
  scrollHandler = null;
}

function setupScrollObserver(wrap, topId) {
  clearScrollObserver();

  const sections = $$('.doc-section', wrap);
  if (!sections.length) return;

  if (topId !== 'greystar') {
    let scheduled = false;
    const update = () => {
      scheduled = false;
      const anchor = wrap.getBoundingClientRect().top + 48;
      let active = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top > anchor) break;
        active = section;
      }
      if (active.dataset.sub) highlightSub(active.dataset.sub);
    };
    scrollHandler = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    };
    scrollWrap = wrap;
    wrap.addEventListener('scroll', scrollHandler, { passive:true });
    update();
    return;
  }

  scrollObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting);
    if (!visible.length) return;
    visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    const topSection = visible[0].target;
    const subId = topSection.dataset.sub;
    if (subId) highlightSub(subId);
  }, {
    root: wrap,
    rootMargin: '-40% 0px -50% 0px',
    threshold: 0
  });

  sections.forEach(s => scrollObserver.observe(s));
}

/* ─────────── 高亮 ─────────── */
function highlightSub(subId) {
  if (activeSidebarId !== subId) collapsedSidebarBranches.clear();
  activeSidebarId = subId;
  const ancestors = getAncestors(subId);
  $$('#navlist .side-sub-item').forEach(n => {
    n.classList.toggle('on', n.dataset.id === subId);
    n.classList.toggle('parent-active',
      ancestors.includes(n.dataset.id) && n.dataset.id !== subId);
  });
  /* 顶层父级保持 active */
  $$('#navlist .side-item').forEach(n => {
    n.classList.toggle('parent-active', ancestors.includes(n.dataset.id));
  });
  updateSidebarContext(subId);
}

function highlightTop(topId) {
  if (activeSidebarId !== topId) collapsedSidebarBranches.clear();
  activeSidebarId = topId;
  const ancestors = getAncestors(topId);
  $$('#navlist .side-sub-item').forEach(n => {
    n.classList.remove('on');
    n.classList.toggle('parent-active', ancestors.includes(n.dataset.id));
  });
  $$('#navlist .side-item').forEach(n => {
    n.classList.toggle('on', n.dataset.id === topId);
    n.classList.toggle('parent-active', ancestors.includes(n.dataset.id));
  });
  updateSidebarContext(topId);
}

/* ─────────── 文档显示 ─────────── */
let currentId = null;

function showCharacterCardPage(topId) {
  clearScrollObserver();
  const app = $('#app');
  if (app) app.classList.remove('directory-home');
  const stage = $('#stage');
  if (!stage) return;

  currentId = topId;
  stage.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'mod on';
  stage.appendChild(wrap);

  if (window.CharacterManager && typeof window.CharacterManager.mount === 'function') {
    try {
      Promise.resolve(window.CharacterManager.mount(wrap)).catch((err) => {
        console.error('[CharacterCard] mount failed:', err);
        wrap.innerHTML = '<div class="doc" style="padding:24px"><p class="warn-t">角色档案加载失败：' + (err && err.message ? err.message : '未知错误') + '</p></div>';
      });
    } catch (err) {
      console.error('[CharacterCard] mount failed:', err);
      wrap.innerHTML = '<div class="doc" style="padding:24px"><p class="warn-t">角色档案加载失败：' + (err && err.message ? err.message : '未知错误') + '</p></div>';
    }
  } else {
    wrap.innerHTML = '<div class="doc" style="padding:24px"><p class="warn-t">角色档案模块未加载，请刷新页面后重试。</p></div>';
  }

  wrap.scrollTop = 0;
  highlightTop(topId);
}

function showDoc(id) {
  const topId = findTopId(id);
  if (!topId) return;

  if (topId === 'character_card') {
    if (currentId !== topId) {
      showCharacterCardPage(topId);
    } else {
      highlightTop(topId);
    }
    return;
  }

  const doc = DOCS[topId];
  if (!doc) return;
  const app = $('#app');
  if (app) app.classList.remove('directory-home');

  const switching = currentId !== topId;

  if (switching) {
    currentId = topId;

    /* 渲染 */
    const stage = $('#stage'); if (!stage) return;
    stage.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'mod';
    wrap.innerHTML = renderDoc(doc, topId);
    stage.appendChild(wrap);
    wrap.classList.add('on');
    wrap.scrollTop = 0;
    wrap.addEventListener('click', event => {
      const pageButton = event.target.closest('[data-doc-page]');
      if (pageButton) showDoc(pageButton.getAttribute('data-doc-page'));
    });

    markupTerms(wrap);

    /* 观察器 */
    setupScrollObserver(wrap, topId);

    /* 高亮顶层 */
    highlightTop(topId);

    /* 若目标就是子条目，滚过去 */
    if (id !== topId) {
      setTimeout(() => scrollToSection('sub-' + id), 60);
    }
  } else {
    /* 同文档，只滚 */
    if (id === topId) {
      const wrap = $('.mod', $('#stage'));
      if (wrap) wrap.scrollTo({ top: 0, behavior: 'smooth' });
      highlightTop(topId);
    } else {
      scrollToSection('sub-' + id);
      highlightSub(id);
    }
  }
}

function scrollToSection(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getPrimaryDocumentPages() {
  const pages = [];
  NAV.forEach(group => {
    (group.items || []).forEach(item => {
      if (item.id !== 'character_card' && DOCS[item.id]) {
        pages.push({ id: item.id, title: item.title });
      }
    });
  });
  return pages;
}

/* ─────────── 内容块渲染 ─────────── */
function renderSections(sections) {
  if (!sections) return '';
  return sections.map(s => {
    switch (s.t) {
      case 'p':     return '<p>' + s.v + '</p>';
      case 'h3':    return '<h3>' + s.v + '</h3>';
      case 'warn':  return '<p class="warn-t">' + s.v + '</p>';
      case 'alert': return '<p class="alert-t">' + s.v + '</p>';
      case 'quote':
        return '<div class="mn-quote"><em>' + (s.m || '') + '</em>' + s.v + '</div>';
      case 'list':
        return '<ul class="doc-list">' +
          s.v.map(x => '<li>' + x + '</li>').join('') +
          '</ul>';
      case 'meta':
        return '<div class="doc-meta">' +
          s.v.map(m =>
            '<div><div class="mk">' + m[0] + '</div>' +
            '<div class="mv">' + m[1] + '</div></div>'
          ).join('') +
          '</div>';
      case 'steps':
        return s.v.map(step =>
          '<div class="mn-step">' +
            '<span class="sn">' + step[0] + '</span>' +
            '<span class="st">' + step[1] + '</span>' +
          '</div>'
        ).join('');
      case 'link':
        return '';
      case 'sub': {
        const sub = DOCS[s.id];
        if (!sub) return '';
        return '<section class="doc-section" id="sub-' + s.id + '" data-sub="' + s.id + '">' +
          '<h2 class="doc-section-title">' + sub.title + '</h2>' +
          (sub.subtitle ? '<div class="doc-section-sub">' + sub.subtitle + '</div>' : '') +
          '<div class="doc-section-body">' + renderSections(sub.sections) + '</div>' +
        '</section>';
      }
      default:
        return '';
    }
  }).join('');
}

function renderDoc(doc, docId) {
  const cls = doc.cls || 'int';
  const pages = getPrimaryDocumentPages();
  const pageIndex = pages.findIndex(page => page.id === docId);
  const previous = pageIndex > 0 ? pages[pageIndex - 1] : null;
  const next = pageIndex >= 0 && pageIndex < pages.length - 1 ? pages[pageIndex + 1] : null;
  const pageButton = (page, direction, emptyLabel) => {
    if (!page) {
      return '<button type="button" class="doc-page-btn is-disabled" disabled>' +
        '<span>' + direction + '</span><strong>' + emptyLabel + '</strong></button>';
    }
    return '<button type="button" class="doc-page-btn" data-doc-page="' + page.id + '">' +
      '<span>' + direction + '</span><strong>' + page.title + '</strong></button>';
  };
  return '<div class="doc">' +
    '<div class="doc-head">' +
      '<span class="' + clsBadge(cls) + '">' + clsName(cls) + '</span>' +
      '<span>' + (doc.authority || '') + '</span>' +
      '<span class="dh-sep">·</span>' +
      '<span>' + (doc.rev || '') + ' · ' + (doc.revDate || '') + '</span>' +
    '</div>' +
    '<h1 class="doc-title">' + doc.title + '</h1>' +
    '<div class="doc-sub">' + (doc.subtitle || '') + '</div>' +
    '<div class="doc-body">' + renderSections(doc.sections) + '</div>' +
    '<div class="doc-rev">' +
      '<span>' + (doc.rev || '') + ' · ' + (doc.revDate || '') + ' · ' + (doc.revBy || '') + '</span>' +
      '<span>修订原因：' + (doc.revReason || '') + '</span>' +
    '</div>' +
    '<nav class="doc-page-nav" aria-label="文档翻页">' +
      pageButton(previous, '上一页', '已是第一页') +
      pageButton(next, '下一页', '已是最后一页') +
    '</nav>' +
  '</div>';
}

/* ─────────── 启动 ─────────── */
/* ─────────── 移动端抽屉 ─────────── */
function initMobileNav() {
  const toggle = $('#menuToggle');
  const nav    = $('.nav');
  const mask   = $('#navMask');
  if (!toggle || !nav || !mask) return;

  function open(){
    nav.classList.add('open');
    mask.classList.add('on');
  }
  function close(){
    nav.classList.remove('open');
    mask.classList.remove('on');
  }

  toggle.addEventListener('click', () => {
    nav.classList.contains('open') ? close() : open();
  });
  mask.addEventListener('click', close);

  /* 点击侧栏任意条目后，自动关闭抽屉（仅手机端） */
  nav.addEventListener('click', e => {
    if (e.target.closest('.side-entry-main:not(.has-children)')) {
      if (window.matchMedia('(max-width: 768px)').matches) {
        setTimeout(close, 180);
      }
    }
  });

  /* 手机端旋转到横屏/变宽时，自动关掉抽屉 */
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) close();
  });
}

function start() {
  initTip();
  initMobileNav();
  buildNav();
  initGlobalSearch({
    getDocuments: () => NAV.reduce((documents, group) => {
      (group.items || []).forEach(item => {
        const doc = DOCS[item.id];
        if (doc) documents.push({ id:item.id, title:doc.title, html:renderDoc(doc) });
      });
      return documents;
    }, []),
    openDocument: id => {
      showDoc(id);
      return $('.mod', $('#stage'));
    }
  });
  initDirectory({
    groups:NAV,
    openDocument:showDoc,
    onHome: () => {
      clearScrollObserver();
      currentId = null;
    }
  });
}

runBoot();