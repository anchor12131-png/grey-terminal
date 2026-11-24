/* Landing directory */
(function () {
  "use strict";

  function makeButton(label, className, documentId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    if (documentId) button.dataset.documentId = documentId;
    return button;
  }

  function renderEntry(item, depth) {
    const entry = document.createElement('div');
    entry.className = 'directory-entry directory-entry-' + depth;
    entry.dataset.depth = String(depth + 1);
    if (item.sub && item.sub.length) entry.classList.add('has-children');

    const row = document.createElement('div');
    row.className = 'directory-entry-row';
    if (depth > 0) {
      const marker = document.createElement('span');
      marker.className = 'directory-marker';
      marker.textContent = depth === 1 ? '└' : '·';
      marker.setAttribute('aria-hidden', 'true');
      row.appendChild(marker);
    }

    const link = makeButton(item.title, 'directory-entry-link', item.id);
    if (item.sub && item.sub.length) link.setAttribute('aria-haspopup', 'true');
    row.appendChild(link);
    if (item.badge || item.note) {
      const badge = document.createElement('span');
      badge.className = 'directory-badge';
      badge.textContent = item.badge || item.note;
      row.appendChild(badge);
    }
    entry.appendChild(row);

    if (item.sub && item.sub.length) {
      const children = document.createElement('div');
      children.className = 'directory-children';
      children.setAttribute('aria-label', item.title + '子目录');
      item.sub.forEach(child => children.appendChild(renderEntry(child, depth + 1)));
      entry.appendChild(children);
    }
    return entry;
  }

  function renderGroup(group, index) {
    const card = document.createElement('section');
    card.className = 'directory-card';
    card.dataset.groupIndex = String(index);
    card.dataset.depth = '0';

    const header = document.createElement('div');
    header.className = 'directory-card-header';
    const title = makeButton(group.group, 'directory-card-title');
    header.appendChild(title);

    const toggle = makeButton('展开目录', 'directory-card-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '展开' + group.group + '子目录');
    header.appendChild(toggle);
    card.appendChild(header);

    const menu = document.createElement('div');
    menu.className = 'directory-menu';
    menu.id = 'directory-menu-' + index;
    menu.setAttribute('aria-label', group.group + '子目录');
    (group.items || []).forEach(item => menu.appendChild(renderEntry(item, 0)));
    (group.subheadings || []).forEach(text => {
      const heading = document.createElement('div');
      heading.className = 'directory-static-entry';
      heading.textContent = text;
      menu.appendChild(heading);
    });
    card.appendChild(menu);

    toggle.setAttribute('aria-controls', menu.id);
    toggle.addEventListener('click', () => {
      const expanded = card.classList.toggle('expanded');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '收起目录' : '展开目录';
    });
    return card;
  }

  window.initDirectory = function (options) {
    const stage = document.querySelector('#stage');
    const app = document.querySelector('#app');
    if (!stage || !app) return;

    function renderDirectory() {
      stage.replaceChildren();
      app.classList.add('directory-home');

      const page = document.createElement('div');
      page.className = 'directory-view';
      page.innerHTML =
        '<div class="directory-heading">' +
          '<div class="directory-kicker">GREYSTAR INTERNAL TERMINAL · INDEX</div>' +
          '<h1>模块目录</h1>' +
          '<p>悬停或聚焦主目录以展开子目录，选择子目录进入对应文档或章节。</p>' +
        '</div>';

      const grid = document.createElement('div');
      grid.className = 'directory-grid';
      options.groups.forEach((group, index) => grid.appendChild(renderGroup(group, index)));
      page.appendChild(grid);
      stage.appendChild(page);

      let audioContext = null;
      function playNavigationSound(entry) {
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audioContext) audioContext = new AudioContext();
        if (audioContext.state === 'suspended') audioContext.resume();

        let hash = 0;
        const label = entry.querySelector('.directory-card-title, .directory-entry-link');
        for (const char of (label ? label.textContent : '')) hash = (hash * 31 + char.charCodeAt(0)) % 97;
        const depth = Number(entry.dataset.depth) || 0;
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
        const entry = event.target.closest('.directory-card, .directory-entry');
        if (!entry || entry.contains(event.relatedTarget)) return;
        playNavigationSound(entry);
      });

      page.addEventListener('click', event => {
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
