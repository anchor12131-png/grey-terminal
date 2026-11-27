/* sandbox.js
 * 灰星终端 - 公共沙盒视图
 * 对外 API: SandboxManager.mount(container), refreshList()
 */
(function () {
  'use strict';

  const state = {
    client: null,
    root: null,
    requestId: 0,
    items: [],
    selectedId: null,
    pendingDeleteId: null,
    deleting: false,
    approving: false,
    approvingId: null,
    authListenerBound: false
  };

  function getClient() {
    if (state.client) return state.client;
    if (!window.GreySupabase) {
      throw new Error('Supabase 客户端未初始化，无法读取公共沙盒。');
    }
    state.client = window.GreySupabase;
    return state.client;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function contentObject(content) {
    let value = content;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { value = null; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function characterKey(record) {
    const content = contentObject(record.content);
    const contentName = typeof content.personName === 'string' ? content.personName.trim() : '';
    const fallbackName = String(record.name || '')
      .replace(/^待审核稿件-/, '')
      .replace(/-第\d+次提交(?:-.+)?$/, '')
      .trim();
    return contentName || fallbackName;
  }

  function timestamp(record) {
    const value = Date.parse(record.updated_at || '');
    return Number.isNaN(value) ? 0 : value;
  }

  function comparableGender(value) {
    return typeof value === 'string' && !value.trim() ? null : value;
  }

  function pendingWithGenderChanges(records) {
    const ordered = records.slice().sort((a, b) => timestamp(b) - timestamp(a));
    return ordered.reduce((pending, record, index) => {
      if (record.status !== 'pending') return pending;
      const key = characterKey(record);
      const previous = key && ordered.slice(index + 1).find((candidate) =>
        (candidate.status === 'pending' || candidate.status === 'approved') &&
        characterKey(candidate) === key
      );
      const currentContent = contentObject(record.content);
      const previousContent = previous ? contentObject(previous.content) : null;
      const genderChanged = !!previous &&
        JSON.stringify(comparableGender(previousContent.gender)) !==
          JSON.stringify(comparableGender(currentContent.gender));
      pending.push(Object.assign({}, record, { genderChanged: genderChanged }));
      return pending;
    }, []);
  }

  function isAdmin() {
    if (!window.GreyAuth || typeof window.GreyAuth.getIdentity !== 'function') return false;
    const identity = window.GreyAuth.getIdentity();
    return !!(identity && identity.type === 'user' &&
      identity.user && identity.user.role === 'admin');
  }

  function template() {
    return '' +
      '<div class="sb-root">' +
        '<header class="sb-head">' +
          '<div>' +
            '<div class="sb-kicker">GREYSTAR / PUBLIC SANDBOX</div>' +
            '<h2 class="sb-title">公共沙盒</h2>' +
            '<p class="sb-desc">公开角色稿件的待审核区。通过审核后将正式归入角色档案库。</p>' +
          '</div>' +
          '<button type="button" class="sb-reload" data-sb-reload>重新读取</button>' +
        '</header>' +
        '<div class="sb-status" data-sb-status aria-live="polite">正在读取公共稿件…</div>' +
        '<div class="sb-shell">' +
          '<aside class="sb-sidebar">' +
            '<div class="sb-sidebar-head">' +
              '<span class="sb-section-label">PUBLIC SUBMISSIONS</span>' +
              '<span class="sb-sidebar-count" data-sb-count>0</span>' +
            '</div>' +
            '<div class="sb-list" data-sb-list aria-label="公共稿件列表"></div>' +
          '</aside>' +
          '<main class="sb-detail" data-sb-detail aria-live="polite"></main>' +
        '</div>' +
        '<div class="sb-foot">PUBLIC RECORDS <span data-sb-count>0 条记录</span></div>' +
        '<div class="sb-delete-modal" data-sb-delete-modal hidden aria-hidden="true">' +
          '<div class="sb-delete-backdrop" data-sb-close-delete></div>' +
          '<div class="sb-delete-panel" role="dialog" aria-modal="true" aria-labelledby="sbDeleteTitle">' +
            '<div class="sb-delete-kicker">ADMIN ACTION</div>' +
            '<h3 class="sb-delete-title" id="sbDeleteTitle">删除公共稿件</h3>' +
            '<div class="sb-delete-name" data-sb-delete-name></div>' +
            '<p class="sb-delete-warning">确认永久删除该稿件？此操作不可逆。</p>' +
            '<div class="sb-delete-message" data-sb-delete-message aria-live="polite"></div>' +
            '<div class="sb-delete-actions">' +
              '<button type="button" class="sb-delete-confirm" data-sb-confirm-delete>确认删除</button>' +
              '<button type="button" class="sb-delete-cancel" data-sb-cancel-delete>取消</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function contentLabel(key) {
    const labels = {
      personName: '人物名称',
      gender: '性别',
      version: '版本',
      background: '背景',
      appearance: '外貌',
      personality: '性格',
      history: '经历',
      ability: '能力',
      abilities: '能力',
      notes: '备注'
    };
    if (Object.prototype.hasOwnProperty.call(labels, key)) return labels[key];
    return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  }

  function readableValue(value) {
    if (value == null || value === '') return '未填写';
    if (typeof value === 'boolean') return value ? '是' : '否';
    return String(value);
  }

  function createContentField(key, value, genderChanged) {
    const field = document.createElement('div');
    field.className = 'sb-field';
    const label = document.createElement('div');
    label.className = 'sb-field-label';
    label.textContent = contentLabel(key);
    if (genderChanged) {
      const badge = document.createElement('span');
      badge.className = 'sb-field-updated';
      badge.textContent = '有改动';
      label.appendChild(badge);
    }
    field.appendChild(label);

    const valueBox = document.createElement('div');
    valueBox.className = 'sb-field-value';
    if (Array.isArray(value)) {
      valueBox.classList.add('sb-field-list');
      if (!value.length) {
        valueBox.textContent = '未填写';
      } else {
        value.forEach((entry) => {
          const item = document.createElement('div');
          item.className = 'sb-field-list-item';
          if (entry && typeof entry === 'object') {
            Object.keys(entry).forEach((childKey) => {
              item.appendChild(createContentField(childKey, entry[childKey]));
            });
          } else {
            item.textContent = readableValue(entry);
          }
          valueBox.appendChild(item);
        });
      }
    } else if (value && typeof value === 'object') {
      valueBox.classList.add('sb-field-object');
      const keys = Object.keys(value);
      if (!keys.length) valueBox.textContent = '未填写';
      keys.forEach((childKey) => {
        valueBox.appendChild(createContentField(childKey, value[childKey]));
      });
    } else {
      valueBox.textContent = readableValue(value);
    }
    field.appendChild(valueBox);
    return field;
  }

  function renderDetail() {
    const detail = state.root && state.root.querySelector('[data-sb-detail]');
    if (!detail) return;
    const item = state.items.find((entry) => String(entry.id) === String(state.selectedId));
    if (!item) {
      detail.innerHTML = '<div class="sb-detail-empty">从左侧选择一份公共稿件以查看内容。</div>';
      return;
    }
    detail.innerHTML = '' +
      '<header class="sb-detail-head">' +
        '<div>' +
          '<div class="sb-kicker">CHARACTER CONTENT</div>' +
          '<h3 class="sb-detail-title">' + escapeHtml(item.name || '（未命名）') + '</h3>' +
        '</div>' +
        '<div class="sb-detail-meta">' +
          '<span class="sb-badge sb-badge-pending">待审核</span>' +
          '<time class="sb-time" datetime="' + escapeHtml(item.updated_at || '') + '">提交时间 · ' + escapeHtml(formatTime(item.updated_at)) + '</time>' +
        '</div>' +
      '</header>' +
      '<div class="sb-content-label">稿件内容</div>' +
      '<div class="sb-fields" data-sb-fields></div>';

    const fields = detail.querySelector('[data-sb-fields]');
    if (!fields) return;
    let content = item.content;
    if (typeof content === 'string' && /^[\s]*[\[{]/.test(content)) {
      try { content = JSON.parse(content); } catch (_) {}
    }
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      const keys = Object.keys(content);
      if (!keys.length) fields.textContent = '暂无可展示内容。';
      keys.forEach((key) => {
        fields.appendChild(createContentField(
          key,
          content[key],
          key === 'gender' && item.genderChanged
        ));
      });
    } else {
      fields.appendChild(createContentField('内容', content));
    }
  }

  function renderItems() {
    const list = state.root && state.root.querySelector('[data-sb-list]');
    if (!list) return;
    const showAdminActions = isAdmin();
    const counts = state.root.querySelectorAll('[data-sb-count]');
    counts.forEach((element, index) => {
      element.textContent = index === 0 ? String(state.items.length) : state.items.length + ' 条记录';
    });
    if (!state.items.length) {
      list.innerHTML = '<div class="sb-empty">目前没有可公开查看的稿件。</div>';
      state.selectedId = null;
      renderDetail();
      return;
    }
    list.innerHTML = state.items.map((item) => {
      const active = String(item.id) === String(state.selectedId) ? ' is-active' : '';
      return '' +
        '<div class="sb-item-row">' +
          '<button type="button" class="sb-item' + active + '" data-sb-id="' + escapeHtml(item.id) + '"' +
            ' aria-pressed="' + (active ? 'true' : 'false') + '">' +
            '<span class="sb-item-name">' + escapeHtml(item.name || '（未命名）') + '</span>' +
            '<span class="sb-item-meta">' +
              '<time class="sb-time" datetime="' + escapeHtml(item.updated_at || '') + '">' + escapeHtml(formatTime(item.updated_at)) + '</time>' +
              '<span class="sb-badge sb-badge-pending">待审核</span>' +
            '</span>' +
          '</button>' +
          (showAdminActions
            ? '<div class="sb-admin-actions">' +
                '<button type="button" class="sb-approve-btn" data-sb-approve-id="' + escapeHtml(item.id) + '"' +
                  (state.approving ? ' disabled' : '') +
                  ' aria-label="审核通过" title="审核通过">' +
                  (String(state.approvingId) === String(item.id) ? '审核中…' : '✓ 过审') +
                '</button>' +
                '<button type="button" class="sb-delete-btn" data-sb-delete-id="' + escapeHtml(item.id) + '" aria-label="删除稿件" title="删除稿件">删除</button>' +
              '</div>'
            : '') +
        '</div>';
    }).join('');
    renderDetail();
  }

  function selectItem(id) {
    const selected = state.items.find((item) => String(item.id) === String(id));
    if (!selected) return;
    state.selectedId = selected.id;
    renderItems();
  }

  function setStatus(message, kind) {
    const status = state.root && state.root.querySelector('[data-sb-status]');
    if (!status) return;
    status.textContent = message;
    status.className = 'sb-status' + (kind ? ' is-' + kind : '');
  }

  function setDeleteMessage(message, kind) {
    const messageEl = state.root && state.root.querySelector('[data-sb-delete-message]');
    if (!messageEl) return;
    messageEl.textContent = message || '';
    messageEl.className = 'sb-delete-message' + (kind ? ' is-' + kind : '');
  }

  function openDeleteModal(id) {
    if (!isAdmin()) {
      setStatus('当前账号没有删除权限。', 'error');
      return;
    }
    const item = state.items.find((entry) => String(entry.id) === String(id));
    if (!item) return;
    state.pendingDeleteId = String(item.id);
    const modal = state.root.querySelector('[data-sb-delete-modal]');
    const name = state.root.querySelector('[data-sb-delete-name]');
    if (name) name.textContent = item.name || '（未命名）';
    setDeleteMessage('');
    if (modal) {
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDeleteModal(force) {
    if (state.deleting && !force) return;
    const modal = state.root && state.root.querySelector('[data-sb-delete-modal]');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
    state.pendingDeleteId = null;
  }

  function setDeleteBusy(busy) {
    const confirmButton = state.root && state.root.querySelector('[data-sb-confirm-delete]');
    const cancelButton = state.root && state.root.querySelector('[data-sb-cancel-delete]');
    if (confirmButton) {
      confirmButton.disabled = !!busy;
      confirmButton.textContent = busy ? '删除中…' : '确认删除';
    }
    if (cancelButton) cancelButton.disabled = !!busy;
  }

  async function deleteCharacter(id) {
    if (!isAdmin()) {
      setStatus('当前账号没有删除权限。', 'error');
      return false;
    }
    const item = state.items.find((entry) => String(entry.id) === String(id));
    if (!item || state.deleting) return false;

    state.deleting = true;
    setDeleteBusy(true);
    setDeleteMessage('正在永久删除稿件…');
    try {
      const { data, error } = await getClient()
        .from('characters')
        .delete()
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('稿件未删除；记录可能已不存在或数据库策略拒绝了操作。');

      state.items = state.items.filter((entry) => String(entry.id) !== String(item.id));
      if (String(state.selectedId) === String(item.id)) {
        state.selectedId = state.items.length ? state.items[0].id : null;
      }
      renderItems();
      closeDeleteModal(true);
      setStatus('删除成功。', 'ok');
      return true;
    } catch (error) {
      console.error('[SandboxManager] deleteCharacter error:', error);
      const message = '删除失败：' + (error && error.message ? error.message : '未知错误');
      setDeleteMessage(message, 'error');
      setStatus(message, 'error');
      return false;
    } finally {
      state.deleting = false;
      setDeleteBusy(false);
    }
  }

  async function approveCharacter(id) {
    if (!isAdmin()) {
      setStatus('当前账号没有审核权限。', 'error');
      return false;
    }
    const item = state.items.find((entry) => String(entry.id) === String(id));
    if (!item || item.status !== 'pending' || state.approving) return false;

    state.approving = true;
    state.approvingId = String(item.id);
    renderItems();
    setStatus('正在将稿件正式归档…');
    try {
      const { data, error } = await getClient()
        .from('characters')
        .update({
          status: 'approved',
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('稿件未更新；记录可能已审核或数据库策略拒绝了操作。');

      state.items = state.items.filter((entry) => String(entry.id) !== String(item.id));
      if (String(state.selectedId) === String(item.id)) {
        state.selectedId = state.items.length ? state.items[0].id : null;
      }
      renderItems();
      setStatus('档案已正式入库。', 'ok');
      document.dispatchEvent(new CustomEvent('greystar:character-approved', {
        detail: { id: item.id }
      }));
      return true;
    } catch (error) {
      console.error('[SandboxManager] approveCharacter error:', error);
      setStatus('过审失败：' + (error && error.message ? error.message : '未知错误'), 'error');
      return false;
    } finally {
      state.approving = false;
      state.approvingId = null;
      renderItems();
    }
  }

  function bindGlobalEvents() {
    if (state.authListenerBound) return;
    state.authListenerBound = true;
    document.addEventListener('greyauth:changed', () => {
      if (!isAdmin()) closeDeleteModal(true);
      renderItems();
    });
    document.addEventListener('keydown', (event) => {
      const modal = state.root && state.root.querySelector('[data-sb-delete-modal]');
      if (event.key === 'Escape' && modal && !modal.hidden) closeDeleteModal();
    });
  }

  async function refreshList() {
    if (!state.root) return;
    const currentRequest = ++state.requestId;
    setStatus('正在读取待审核稿件…');
    try {
      const { data, error } = await getClient()
        .from('characters')
        .select('id, name, status, updated_at, content')
        .in('status', ['pending', 'approved'])
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (currentRequest !== state.requestId) return;
      state.items = pendingWithGenderChanges(Array.isArray(data) ? data : []);
      if (!state.items.some((item) => String(item.id) === String(state.selectedId))) {
        state.selectedId = state.items.length ? state.items[0].id : null;
      }
      renderItems();
      setStatus(state.items.length ? '待审核稿件已更新。' : '暂无待审核稿件。', 'ok');
    } catch (error) {
      if (currentRequest !== state.requestId) return;
      console.error('[SandboxManager] refreshList error:', error);
      state.items = [];
      state.selectedId = null;
      renderItems();
      setStatus('读取公共沙盒失败：' + (error && error.message ? error.message : '未知错误'), 'error');
    }
  }

  function mount(container) {
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) throw new Error('SandboxManager.mount: 未找到容器');
    state.root = target;
    if (!target.querySelector('.sb-root')) target.innerHTML = template();
    bindGlobalEvents();
    if (target.dataset.sbBound !== 'true') {
      target.dataset.sbBound = 'true';
      target.addEventListener('click', (event) => {
        if (event.target.closest('[data-sb-reload]')) {
          refreshList();
          return;
        }
        if (event.target.closest('[data-sb-close-delete], [data-sb-cancel-delete]')) {
          closeDeleteModal();
          return;
        }
        if (event.target.closest('[data-sb-confirm-delete]')) {
          if (state.pendingDeleteId) deleteCharacter(state.pendingDeleteId);
          return;
        }
        const approveButton = event.target.closest('[data-sb-approve-id]');
        if (approveButton) {
          approveCharacter(approveButton.getAttribute('data-sb-approve-id'));
          return;
        }
        const deleteButton = event.target.closest('[data-sb-delete-id]');
        if (deleteButton) {
          openDeleteModal(deleteButton.getAttribute('data-sb-delete-id'));
          return;
        }
        const item = event.target.closest('[data-sb-id]');
        if (item) selectItem(item.getAttribute('data-sb-id'));
      });
    }
    return refreshList();
  }

  window.SandboxManager = {
    mount: mount,
    refreshList: refreshList,
    deleteCharacter: deleteCharacter,
    approveCharacter: approveCharacter
  };
})();
