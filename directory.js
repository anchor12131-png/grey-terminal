/* Landing directory - left/right layout with cascade-capable browser pane */
(function () {
  "use strict";

  function createButton(label, className, documentId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    if (documentId) button.dataset.documentId = documentId;
    return button;
  }

  function hasChildren(item) {
    return Array.isArray(item.sub) && item.sub.length > 0;
  }

  let mobileNodeSequence = 0;

  function renderSubheading(entry) {
    const isExternal = entry && typeof entry === 'object' && (entry.href || entry.url);
    if (isExternal) {
      const link = document.createElement('a');
      link.className = 'dir-static-entry dir-static-link';
      link.textContent = entry.title || entry.text || entry.href || entry.url;
      link.href = entry.href || entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    }
    const text = typeof entry === 'string'
      ? entry
      : (entry && (entry.title || entry.text || entry.href || entry.url)) || '';
    const node = document.createElement('div');
    node.className = 'dir-static-entry';
    node.textContent = text;
    return node;
  }

  /* -------- Mobile: primary groups with jump-only second-level entries -------- */
  function renderMobileNode(item, depth) {
    const canExpand = depth === 0 && hasChildren(item);
    const node = document.createElement('div');
    node.className = 'dir-node dir-node-mobile' + (canExpand ? ' has-children' : '');
    node.dataset.depth = String(depth);

    const row = document.createElement('div');
    row.className = 'dir-node-row';
    if (depth > 0) {
      const marker = document.createElement('span');
      marker.className = 'dir-marker';
      marker.textContent = depth === 1 ? '└' : '·';
      marker.setAttribute('aria-hidden', 'true');
      row.appendChild(marker);
    }
    if (canExpand) {
      const childrenId = 'dir-mobile-children-' + (++mobileNodeSequence);
      const toggle = createButton(item.title, 'dir-mobile-toggle');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', childrenId);
      row.appendChild(toggle);
      const jump = createButton('跳转', 'dir-mobile-jump', item.id);
      jump.setAttribute('aria-label', '跳转到' + item.title + '内容');
      row.appendChild(jump);
      node.dataset.childrenId = childrenId;
    } else {
      const label = document.createElement('span');
      label.className = 'dir-mobile-label';
      label.textContent = item.title;
      row.appendChild(label);
      const jump = createButton('跳转', 'dir-mobile-jump', item.id);
      jump.setAttribute('aria-label', '跳转到' + item.title + '内容');
      row.appendChild(jump);
    }
    if (item.badge || item.note) {
      const badge = document.createElement('span');
      badge.className = 'dir-badge';
      badge.textContent = item.badge || item.note;
      row.appendChild(badge);
    }
    node.appendChild(row);

    if (canExpand) {
      const children = document.createElement('div');
      children.className = 'dir-mobile-children';
      children.id = node.dataset.childrenId;
      children.hidden = true;
      item.sub.forEach(child => children.appendChild(renderMobileNode(child, depth + 1)));
      node.appendChild(children);
    }
    return node;
  }

  function renderMobileBrowser(browser, group) {
    browser.replaceChildren();
    const header = document.createElement('div');
    header.className = 'dir-browser-header';
    header.textContent = group.group;
    browser.appendChild(header);

    const tree = document.createElement('div');
    tree.className = 'dir-mobile-tree';
    mobileNodeSequence = 0;
    (group.items || []).forEach(item => tree.appendChild(renderMobileNode(item, 0)));
    (group.subheadings || []).forEach(entry => {
      tree.appendChild(renderSubheading(entry));
    });
    browser.appendChild(tree);
  }

  /* -------- Desktop: cascade columns (left-to-right, space for future levels) -------- */
  function renderCascadeNode(item, depth) {
    const node = document.createElement('div');
    node.className = 'dir-node' + (hasChildren(item) ? ' has-children' : '');
    node.dataset.depth = String(depth);

    const row = document.createElement('div');
    row.className = 'dir-node-row';

    const link = createButton(item.title, 'dir-node-link', item.id);
    if (hasChildren(item)) link.setAttribute('aria-haspopup', 'true');
    row.appendChild(link);

    if (item.badge || item.note) {
      const badge = document.createElement('span');
      badge.className = 'dir-badge';
      badge.textContent = item.badge || item.note;
      row.appendChild(badge);
    }
    if (hasChildren(item)) {
      const chevron = document.createElement('span');
      chevron.className = 'dir-chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');
      row.appendChild(chevron);
    }
    node.appendChild(row);

    node._children = item.sub || null;
    node._label = item.title;
    return node;
  }

  function renderCascadeBrowser(browser, group) {
    browser.replaceChildren();
    const header = document.createElement('div');
    header.className = 'dir-browser-header';
    header.innerHTML = '<span class="dir-browser-group">' + group.group + '</span>' +
      '<span class="dir-browser-hint">将光标移至条目可在右侧展开次级目录</span>';
    browser.appendChild(header);

    const columns = document.createElement('div');
    columns.className = 'dir-columns';
    browser.appendChild(columns);

    function setActiveInColumn(column, activeNode) {
      column.querySelectorAll(':scope > .dir-node').forEach(node => {
        node.classList.toggle('active', node === activeNode);
      });
    }

    function removeColumnsFrom(depth) {
      Array.from(columns.children).forEach(col => {
        if (Number(col.dataset.depth) >= depth) col.remove();
      });
    }

    function showColumn(items, depth, label, staticHeadings) {
      removeColumnsFrom(depth);
      const column = document.createElement('div');
      column.className = 'dir-column';
      column.dataset.depth = String(depth);
      if (label) column.setAttribute('aria-label', label);

      (items || []).forEach(item => column.appendChild(renderCascadeNode(item, depth)));
      if (depth === 0 && staticHeadings && staticHeadings.length) {
        staticHeadings.forEach(entry => {
          column.appendChild(renderSubheading(entry));
        });
      }
      columns.appendChild(column);
      return column;
    }

    function activateNode(node) {
      const column = node.closest('.dir-column');
      if (!column) return;
      const depth = Number(node.dataset.depth || column.dataset.depth || 0);
      setActiveInColumn(column, node);
      removeColumnsFrom(depth + 1);
      if (node._children && node._children.length) {
        const childColumn = showColumn(node._children, depth + 1, node._label + '子目录');

        // Align child column with the activated item so levels line up horizontally.
        childColumn.style.marginTop = '0px';
        const columnsRect = columns.getBoundingClientRect();
        const columnsStyle = window.getComputedStyle(columns);
        const paddingTop = parseFloat(columnsStyle.paddingTop) || 0;
        const parentAnchor = node;
        const firstAnchor = childColumn.querySelector('.dir-node') || childColumn;
        const targetTop = parentAnchor.getBoundingClientRect().top - columnsRect.top + columns.scrollTop;
        const innerOffset = firstAnchor.getBoundingClientRect().top - childColumn.getBoundingClientRect().top;
        childColumn.style.marginTop = Math.max(0, targetTop - innerOffset - paddingTop) + 'px';

        requestAnimationFrame(() => {
          const areaRect = columns.getBoundingClientRect();
          const colRect = childColumn.getBoundingClientRect();
          if (colRect.right > areaRect.right - 8) {
            columns.scrollTo({
              left: columns.scrollLeft + (colRect.right - areaRect.right) + 24,
              behavior: 'smooth'
            });
          }
          if (colRect.top < areaRect.top + 8) {
            columns.scrollTo({
              top: Math.max(0, columns.scrollTop + (colRect.top - areaRect.top) - 12),
              behavior: 'smooth'
            });
          }
        });
      }
    }

    showColumn(group.items || [], 0, group.group + '子目录', group.subheadings || []);

    columns.addEventListener('pointerover', event => {
      const node = event.target.closest('.dir-node');
      if (!node || !columns.contains(node)) return;
      if (node.contains(event.relatedTarget)) return;
      activateNode(node);
    });

    columns.addEventListener('focusin', event => {
      const node = event.target.closest('.dir-node');
      if (node && columns.contains(node)) activateNode(node);
    });
  }

  function renderBrowser(browser, group) {
    if (window.matchMedia('(max-width: 768px)').matches) {
      renderMobileBrowser(browser, group);
    } else {
      renderCascadeBrowser(browser, group);
    }
  }

  window.initDirectory = function (options) {
    const stage = document.querySelector('#stage');
    const app = document.querySelector('#app');
    if (!stage || !app) return;

    function renderDirectory() {
      if (typeof options.onHome === 'function') options.onHome();
      stage.replaceChildren();
      app.classList.add('directory-home');

      const page = document.createElement('div');
      page.className = 'directory-view';
      page.innerHTML =
        '<div class="directory-heading">' +
          '<div class="directory-kicker">GREYSTAR INTERNAL TERMINAL · INDEX</div>' +
          '<h1>模块目录</h1>' +
          '<p>选择主目录浏览次级条目，点击“跳转”进入对应内容。</p>' +
        '</div>';

      const layout = document.createElement('div');
      layout.className = 'directory-layout';

      const sidebar = document.createElement('div');
      sidebar.className = 'directory-sidebar';
      sidebar.setAttribute('aria-label', '主目录');

      const browser = document.createElement('div');
      browser.className = 'directory-browser';
      browser.setAttribute('aria-live', 'polite');

      const groups = options.groups || [];
      let activeIndex = 0;

      function selectGroup(index) {
        activeIndex = index;
        sidebar.querySelectorAll('.directory-group-tab').forEach((tab, i) => {
          const active = i === index;
          tab.classList.toggle('active', active);
          tab.setAttribute('aria-selected', String(active));
          tab.tabIndex = active ? 0 : -1;
        });
        renderBrowser(browser, groups[index] || { group: '', items: [] });
      }

      groups.forEach((group, index) => {
        const tab = createButton(group.group, 'directory-group-tab');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.addEventListener('click', () => selectGroup(index));
        sidebar.appendChild(tab);
      });

      const quickActions = document.createElement('div');
      quickActions.className = 'dir-quick-actions';
      quickActions.innerHTML =
        '<button type="button" class="dir-quick-link" data-document-id="character_card">' +
          '<span class="dir-quick-kicker">FUNCTION</span>' +
          '<span class="dir-quick-title">角色档案管理</span>' +
          '<span class="dir-quick-desc">创建和管理角色草稿</span>' +
        '</button>';
      sidebar.appendChild(quickActions);

      layout.appendChild(sidebar);
      layout.appendChild(browser);
      page.appendChild(layout);
      stage.appendChild(page);

      if (groups.length) selectGroup(0);

      let audioContext = null;
      function playNavigationSound(node) {
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audioContext) audioContext = new AudioContext();
        if (audioContext.state === 'suspended') audioContext.resume();

        let hash = 0;
        const label = node.querySelector('.dir-node-link, .directory-group-tab');
        const text = label ? label.textContent || '' : '';
        for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 97;
        const depth = Number(node.dataset.depth || 0);
        const frequency = 420 + depth * 95 + hash;
        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.18, now + 0.055);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.12);
      }

      page.addEventListener('pointerover', event => {
        const node = event.target.closest('.directory-group-tab, .dir-node');
        if (!node || node.contains(event.relatedTarget)) return;
        playNavigationSound(node);
      });

      page.addEventListener('click', event => {
        const toggle = event.target.closest('.dir-mobile-toggle');
        if (toggle) {
          const node = toggle.closest('.dir-node-mobile');
          const children = node && node.querySelector(':scope > .dir-mobile-children');
          if (!children) return;
          const expanded = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(expanded));
          children.hidden = !expanded;
          node.classList.toggle('is-expanded', expanded);
          return;
        }
        const button = event.target.closest('[data-document-id]');
        if (!button) return;
        options.openDocument(button.dataset.documentId);
      });
    }

    window.showDirectory = renderDirectory;
    const homeButton = document.querySelector('#directoryHome');
    if (homeButton) homeButton.addEventListener('click', renderDirectory);
    renderDirectory();
  };
})();
