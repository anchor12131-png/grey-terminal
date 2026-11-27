/* archive.js
 * 灰星终端 - 已过审角色档案库
 * 对外 API: ArchiveManager.mount(container), refreshList(), deleteCharacter(id)
 */
(function () {
  'use strict';

  const state = {
    client: null,
    root: null,
    requestId: 0,
    items: [],
    pendingDeleteId: null,
    deleting: false,
    bound: false
  };

  function getClient() {
    if (state.client) return state.client;
    if (!window.GreySupabase) {
      throw new Error('Supabase 客户端未初始化，无法读取角色档案。');
    }
    state.client = window.GreySupabase;
    return state.client;
  }

  function formatTime(value) {
    if (!value) return '时间未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function isAdmin() {
    if (!window.GreyAuth || typeof window.GreyAuth.getIdentity !== 'function') return false;
    const identity = window.GreyAuth.getIdentity();
    return !!(identity && identity.type === 'user' &&
      identity.user && identity.user.role === 'admin');
  }

  function template() {
    return '' +
      '<div class="ar-root">' +
        '<header class="ar-head">' +
          '<div>' +
            '<div class="ar-kicker">GREYSTAR / OFFICIAL CHARACTER REGISTRY</div>' +
            '<h2 class="ar-title">角色档案</h2>' +
            '<p class="ar-desc">已完成审核并正式入库的角色记录。档案对所有访问者开放。</p>' +
          '</div>' +
          '<button type="button" class="ar-reload" data-ar-reload>重新读取</button>' +
        '</header>' +
        '<div class="ar-status" data-ar-status aria-live="polite">正在读取正式档案…</div>' +
        '<div class="ar-grid" data-ar-grid aria-label="已过审角色档案"></div>' +
        '<footer class="ar-foot"><span>OFFICIAL REGISTRY</span><span data-ar-count>0 份档案</span></footer>' +
        '<div class="ar-delete-modal" data-ar-delete-modal hidden aria-hidden="true">' +
          '<div class="ar-delete-backdrop" data-ar-close-delete></div>' +
          '<section class="ar-delete-panel" role="dialog" aria-modal="true" aria-labelledby="arDeleteTitle" aria-describedby="arDeletePrompt">' +
            '<div class="ar-delete-warning-icon" aria-hidden="true">⚠</div>' +
            '<div class="ar-delete-kicker">IRREVERSIBLE ADMIN ACTION</div>' +
            '<h3 class="ar-delete-title" id="arDeleteTitle">销毁正式档案</h3>' +
            '<div class="ar-delete-name" data-ar-delete-name></div>' +
            '<label class="ar-delete-prompt" id="arDeletePrompt" for="arDeleteInput">此操作不可逆。请输入「确认删除」以销毁该档案</label>' +
            '<input class="ar-delete-input" id="arDeleteInput" data-ar-delete-input type="text" autocomplete="off" spellcheck="false" />' +
            '<div class="ar-delete-message" data-ar-delete-message aria-live="polite"></div>' +
            '<div class="ar-delete-actions">' +
              '<button type="button" class="ar-destroy-confirm" data-ar-confirm-delete>确认销毁</button>' +
              '<button type="button" class="ar-destroy-cancel" data-ar-cancel-delete>取消</button>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
  }

  function normalizeContent(content) {
    if (typeof content !== 'string') return content;
    try { return JSON.parse(content); } catch (_) { return content; }
  }

  function humanizeKey(key) {
    if (key === 'gender') return '性别';
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ');
  }

  function createValue(value) {
    if (value == null || value === '') {
      const empty = document.createElement('span');
      empty.className = 'ar-empty-value';
      empty.textContent = '未填写';
      return empty;
    }
    if (Array.isArray(value)) {
      const list = document.createElement('ul');
      list.className = 'ar-value-list';
      if (!value.length) {
        const emptyItem = document.createElement('li');
        emptyItem.textContent = '未填写';
        list.appendChild(emptyItem);
      }
      value.forEach((entry) => {
        const item = document.createElement('li');
        item.appendChild(createValue(entry));
        list.appendChild(item);
      });
      return list;
    }
    if (typeof value === 'object') {
      const group = document.createElement('div');
      group.className = 'ar-value-group';
      const keys = Object.keys(value);
      if (!keys.length) {
        group.textContent = '未填写';
      } else {
        keys.forEach((key) => {
          const row = document.createElement('div');
          row.className = 'ar-nested-field';
          const label = document.createElement('span');
          label.className = 'ar-nested-label';
          label.textContent = humanizeKey(key);
          row.appendChild(label);
          row.appendChild(createValue(value[key]));
          group.appendChild(row);
        });
      }
      return group;
    }
    const text = document.createElement('span');
    text.textContent = typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
    return text;
  }

  function createCard(record, index) {
    const card = document.createElement('article');
    card.className = 'ar-card';

    const header = document.createElement('header');
    header.className = 'ar-card-head';
    const serial = document.createElement('div');
    serial.className = 'ar-serial';
    serial.textContent = 'ARCHIVE RECORD / ' + String(index + 1).padStart(3, '0');
    const badge = document.createElement('span');
    badge.className = 'ar-approved';
    badge.textContent = '正式入库';
    header.appendChild(serial);
    const tools = document.createElement('div');
    tools.className = 'ar-card-tools';
    tools.appendChild(badge);
    if (isAdmin()) {
      const destroyButton = document.createElement('button');
      destroyButton.type = 'button';
      destroyButton.className = 'ar-destroy-button';
      destroyButton.dataset.arDestroyId = String(record.id);
      destroyButton.setAttribute('aria-label', '销毁档案：' + (record.name || '未命名'));
      destroyButton.textContent = '销毁档案';
      tools.appendChild(destroyButton);
    }
    header.appendChild(tools);
    card.appendChild(header);

    const title = document.createElement('h3');
    title.className = 'ar-name';
    title.textContent = record.name || '（未命名）';
    card.appendChild(title);

    const time = document.createElement('time');
    time.className = 'ar-time';
    time.dateTime = record.updated_at || '';
    time.textContent = '入库时间 · ' + formatTime(record.updated_at);
    card.appendChild(time);

    const divider = document.createElement('div');
    divider.className = 'ar-divider';
    card.appendChild(divider);

    const fields = document.createElement('div');
    fields.className = 'ar-fields';
    const content = normalizeContent(record.content);
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      Object.keys(content).forEach((key) => {
        const field = document.createElement('section');
        field.className = 'ar-field';
        const label = document.createElement('h4');
        label.className = 'ar-field-label';
        label.textContent = humanizeKey(key);
        field.appendChild(label);
        field.appendChild(createValue(content[key]));
        fields.appendChild(field);
      });
    } else {
      const field = document.createElement('section');
      field.className = 'ar-field';
      const label = document.createElement('h4');
      label.className = 'ar-field-label';
      label.textContent = '档案内容';
      field.appendChild(label);
      field.appendChild(createValue(content));
      fields.appendChild(field);
    }
    card.appendChild(fields);
    return card;
  }

  function setStatus(message, kind) {
    const element = state.root && state.root.querySelector('[data-ar-status]');
    if (!element) return;
    element.textContent = message;
    element.className = 'ar-status' + (kind ? ' is-' + kind : '');
  }

  function setDeleteMessage(message, kind) {
    const element = state.root && state.root.querySelector('[data-ar-delete-message]');
    if (!element) return;
    element.textContent = message || '';
    element.className = 'ar-delete-message' + (kind ? ' is-' + kind : '');
  }

  function openDeleteModal(id) {
    if (!isAdmin()) {
      setStatus('当前账号没有销毁档案的权限。', 'error');
      return;
    }
    const record = state.items.find((item) => String(item.id) === String(id));
    if (!record) return;
    state.pendingDeleteId = String(record.id);
    const modal = state.root.querySelector('[data-ar-delete-modal]');
    const name = state.root.querySelector('[data-ar-delete-name]');
    const input = state.root.querySelector('[data-ar-delete-input]');
    if (name) name.textContent = record.name || '（未命名）';
    if (input) input.value = '';
    setDeleteMessage('');
    if (modal) {
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
    }
    if (input) setTimeout(() => input.focus(), 0);
  }

  function closeDeleteModal(force) {
    if (state.deleting && !force) return;
    const modal = state.root && state.root.querySelector('[data-ar-delete-modal]');
    const input = state.root && state.root.querySelector('[data-ar-delete-input]');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    if (input) input.value = '';
    state.pendingDeleteId = null;
    setDeleteMessage('');
  }

  function setDeleteBusy(busy) {
    const confirmButton = state.root && state.root.querySelector('[data-ar-confirm-delete]');
    const cancelButton = state.root && state.root.querySelector('[data-ar-cancel-delete]');
    const input = state.root && state.root.querySelector('[data-ar-delete-input]');
    if (confirmButton) {
      confirmButton.disabled = !!busy;
      confirmButton.textContent = busy ? '销毁中…' : '确认销毁';
    }
    if (cancelButton) cancelButton.disabled = !!busy;
    if (input) input.disabled = !!busy;
  }

  async function deleteCharacter(id) {
    if (!isAdmin()) {
      setStatus('当前账号没有销毁档案的权限。', 'error');
      return false;
    }
    if (!state.pendingDeleteId || String(state.pendingDeleteId) !== String(id) || state.deleting) return false;
    const input = state.root && state.root.querySelector('[data-ar-delete-input]');
    if (!input || input.value !== '确认删除') {
      setDeleteMessage('指令不匹配，销毁终止', 'error');
      return false;
    }
    const record = state.items.find((item) => String(item.id) === String(id));
    if (!record) {
      closeDeleteModal();
      return false;
    }

    state.deleting = true;
    setDeleteBusy(true);
    setDeleteMessage('正在永久销毁档案…');
    try {
      const { data, error } = await getClient()
        .from('characters')
        .delete()
        .eq('id', record.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('档案未删除；记录可能已不存在或数据库策略拒绝了操作。');

      state.items = state.items.filter((item) => String(item.id) !== String(record.id));
      renderItems();
      closeDeleteModal(true);
      setStatus('档案已彻底销毁。', 'ok');
      return true;
    } catch (error) {
      console.error('[ArchiveManager] deleteCharacter error:', error);
      const message = '销毁失败：' + (error && error.message ? error.message : '未知错误');
      if (input) input.value = '';
      setDeleteMessage(message, 'error');
      setStatus(message, 'error');
      return false;
    } finally {
      state.deleting = false;
      setDeleteBusy(false);
    }
  }

  function renderItems() {
    const grid = state.root && state.root.querySelector('[data-ar-grid]');
    const count = state.root && state.root.querySelector('[data-ar-count]');
    if (!grid) return;
    if (count) count.textContent = state.items.length + ' 份档案';
    grid.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'ar-empty';
      empty.textContent = '档案库目前没有已过审的角色。';
      grid.appendChild(empty);
      return;
    }
    state.items.forEach((item, index) => grid.appendChild(createCard(item, index)));
  }

  async function refreshList() {
    if (!state.root) return;
    const requestId = ++state.requestId;
    setStatus('正在读取正式档案…');
    try {
      const { data, error } = await getClient()
        .from('characters')
        .select('id, name, status, updated_at, content')
        .eq('status', 'approved')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (requestId !== state.requestId) return;
      state.items = Array.isArray(data) ? data : [];
      renderItems();
      setStatus(state.items.length ? '正式档案已更新。' : '档案库目前为空。', 'ok');
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.error('[ArchiveManager] refreshList error:', error);
      state.items = [];
      renderItems();
      setStatus('读取角色档案失败：' + (error && error.message ? error.message : '未知错误'), 'error');
    }
  }

  function mount(container) {
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) throw new Error('ArchiveManager.mount: 未找到容器');
    state.root = target;
    if (!target.querySelector('.ar-root')) target.innerHTML = template();
    if (!state.bound) {
      state.bound = true;
      document.addEventListener('greystar:character-approved', () => {
        if (state.root) refreshList();
      });
      document.addEventListener('greyauth:changed', () => {
        if (!isAdmin()) closeDeleteModal(true);
        renderItems();
      });
      document.addEventListener('keydown', (event) => {
        const modal = state.root && state.root.querySelector('[data-ar-delete-modal]');
        if (event.key === 'Escape' && modal && !modal.hidden) closeDeleteModal();
      });
    }
    if (target.dataset.arBound !== 'true') {
      target.dataset.arBound = 'true';
      target.addEventListener('click', (event) => {
        if (event.target.closest('[data-ar-reload]')) {
          refreshList();
          return;
        }
        if (event.target.closest('[data-ar-close-delete], [data-ar-cancel-delete]')) {
          closeDeleteModal();
          return;
        }
        if (event.target.closest('[data-ar-confirm-delete]')) {
          if (state.pendingDeleteId) deleteCharacter(state.pendingDeleteId);
          return;
        }
        const destroyButton = event.target.closest('[data-ar-destroy-id]');
        if (destroyButton) openDeleteModal(destroyButton.getAttribute('data-ar-destroy-id'));
      });
    }
    return refreshList();
  }

  window.ArchiveManager = {
    mount: mount,
    refreshList: refreshList,
    deleteCharacter: deleteCharacter
  };
})();
