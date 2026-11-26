/* character-card.js
 * 灰星终端 - 角色档案管理中心
 * 对外 API: CharacterManager.init(currentOwnerId?), refreshList(), mount(container, currentOwnerId?), setOwnerId(id), submitForReview(characterId)
 */
(function () {
  'use strict';

  const state = {
    sb: null,
    ownerId: '',
    draftRequestId: 0,
    drafts: [],
    selectedId: null,
    saving: false,
    submittingId: null,
    boundGlobal: false,
    els: {},
    root: null,
    pendingSave: null,
    pendingReview: null,
    pendingDelete: null
  };

  function $(id) { return state.root ? state.root.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function setMsg(text, type) {
    const el = state.els.msg;
    if (!el) return;
    el.textContent = text || '';
    el.className = 'cc-msg' + (type ? ' is-' + type : '');
  }

  function requestLogin(message) {
    setMsg(message, 'warn');
    if (window.GreyAuth && typeof window.GreyAuth.openModal === 'function') {
      window.GreyAuth.openModal();
    }
  }

  function setBusy(isSaving) {
    state.saving = !!isSaving;
    if (state.els.saveBtn) {
      state.els.saveBtn.disabled = !!isSaving;
      state.els.saveBtn.textContent = isSaving ? '保存中…' : '保存草稿';
    }
    if (state.els.newBtn) state.els.newBtn.disabled = !!isSaving;
  }

  async function resolveOwnerId() {
    if (!window.GreyAuth || typeof window.GreyAuth.getAuthenticatedUser !== 'function') {
      throw new Error('Supabase Auth 模块尚未就绪。');
    }
    const user = await window.GreyAuth.getAuthenticatedUser();
    if (!user || !user.id) throw new Error('请先登录。');
    state.ownerId = String(user.id);
    return state.ownerId;
  }

  function isAdminIdentity() {
    if (!window.GreyAuth || typeof window.GreyAuth.getIdentity !== 'function') return false;
    const identity = window.GreyAuth.getIdentity();
    return !!(identity && identity.type === 'user' && identity.isAdmin);
  }

  function ensureSupabase() {
    if (state.sb) return state.sb;
    if (window.GreySupabase) { state.sb = window.GreySupabase; return state.sb; }
    throw new Error('共享 Supabase 客户端未初始化。');
  }

  function template() {
    return '' +
      '<div class="cc-root cc-page">' +
        '<header class="cc-page-head">' +
          '<div class="cc-kicker">GREYSTAR / CHARACTER ARCHIVE</div>' +
          '<h1 class="cc-title">角色档案管理中心</h1>' +
          '<p class="cc-desc">管理当前身份下的角色草稿。每次保存会生成一个版本存档，命名格式为“人物名称 + 第X次修改 + 自定义后缀”。</p>' +
        '</header>' +
        '<nav class="sb-tabs" aria-label="角色档案视图">' +
          '<button type="button" class="sb-tab is-active" id="sbDraftTab" data-sb-view="drafts" aria-pressed="true">我的草稿 <span>MY DRAFTS</span></button>' +
          '<button type="button" class="sb-tab" id="sbPublicTab" data-sb-view="sandbox" aria-pressed="false">公共沙盒 <span>PUBLIC SANDBOX</span></button>' +
        '</nav>' +
        '<div class="cc-shell" id="ccDraftView">' +
          '<aside class="cc-sidebar">' +
            '<div class="cc-sidebar-top">' +
              '<div class="cc-section-label">DRAFT LIST</div>' +
              '<button type="button" class="cc-btn cc-btn-primary" id="ccNewBtn">+ 新建角色</button>' +
            '</div>' +
            '<div class="cc-list" id="ccList" aria-label="草稿列表"></div>' +
            '<div class="cc-sidebar-foot"><span class="cc-meta" id="ccOwnerMeta">OWNER: -</span></div>' +
          '</aside>' +
          '<main class="cc-editor">' +
            '<div class="cc-editor-head">' +
              '<div class="cc-section-label">EDITOR</div>' +
              '<div class="cc-edit-state" id="ccEditState">新建草稿</div>' +
            '</div>' +
            '<form id="ccForm" class="cc-form" novalidate>' +
              '<div class="cc-field">' +
                '<label class="cc-label" for="ccNameInput">人物名称</label>' +
                '<input class="cc-input" id="ccNameInput" type="text" maxlength="40" autocomplete="off" placeholder="输入人物名称（如：灰星勘探者）" />' +
                '<div class="cc-help">保存时会自动生成“人物名称第X次修改”前缀，你可以额外添加后缀命名。</div>' +
              '</div>' +
              '<div class="cc-actions">' +
                '<button type="submit" class="cc-btn cc-btn-primary" id="ccSaveBtn">保存草稿</button>' +
                '<button type="button" class="cc-btn cc-btn-ghost" id="ccResetBtn">清空编辑</button>' +
              '</div>' +
              '<div class="cc-msg" id="ccMsg" aria-live="polite"></div>' +
            '</form>' +
            '<div class="cc-editor-foot">' +
              '<div class="cc-foot-item"><span>记录 ID</span><code id="ccCurrentId">NEW</code></div>' +
              '<div class="cc-foot-item"><span>状态</span><code id="ccCurrentStatus">draft</code></div>' +
            '</div>' +
          '</main>' +
        '</div>' +
        '<section class="sb-view" id="sbView" hidden aria-label="公共沙盒"></section>' +
        '<div class="cc-save-modal" id="ccSaveModal" hidden aria-hidden="true">' +
          '<div class="cc-save-backdrop" data-cc-save-close="1"></div>' +
          '<div class="cc-save-panel" role="dialog" aria-modal="true" aria-labelledby="ccSaveTitle">' +
            '<div class="cc-save-head">' +
              '<div>' +
                '<div class="cc-kicker">SAVE VERSION</div>' +
                '<h3 class="cc-save-title" id="ccSaveTitle">存档命名</h3>' +
              '</div>' +
              '<button type="button" class="cc-save-close" id="ccSaveCloseBtn" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label">固定前缀</label>' +
              '<div class="cc-save-prefix" id="ccSavePrefix">-</div>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label" for="ccSaveSuffixInput">后缀命名（可选）</label>' +
              '<input class="cc-input" id="ccSaveSuffixInput" type="text" maxlength="30" autocomplete="off" placeholder="例如：-初稿 / -战斗向" />' +
              '<div class="cc-help">最终存档名 = 固定前缀 + 后缀。后缀可留空。</div>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label">最终存档名预览</label>' +
              '<div class="cc-save-preview" id="ccSavePreview">-</div>' +
            '</div>' +
            '<div class="cc-msg" id="ccSaveMsg" aria-live="polite"></div>' +
            '<div class="cc-actions">' +
              '<button type="button" class="cc-btn cc-btn-primary" id="ccSaveConfirmBtn">确认保存</button>' +
              '<button type="button" class="cc-btn cc-btn-ghost" id="ccSaveCancelBtn">取消</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cc-save-modal" id="ccReviewModal" hidden aria-hidden="true">' +
          '<div class="cc-save-backdrop" data-cc-review-close="1"></div>' +
          '<div class="cc-save-panel" role="dialog" aria-modal="true" aria-labelledby="ccReviewTitle">' +
            '<div class="cc-save-head">' +
              '<div>' +
                '<div class="cc-kicker">SUBMIT FOR REVIEW</div>' +
                '<h3 class="cc-save-title" id="ccReviewTitle">提交审核</h3>' +
              '</div>' +
              '<button type="button" class="cc-save-close" id="ccReviewCloseBtn" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label">固定前缀</label>' +
              '<div class="cc-review-prefix" id="ccReviewPrefix">-</div>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label" for="ccReviewSuffixInput">自定义后缀</label>' +
              '<input class="cc-input cc-review-suffix-input" id="ccReviewSuffixInput" type="text" maxlength="60" autocomplete="off" placeholder="例如：修改了背景 / 初版" />' +
              '<div class="cc-help">后缀可留空；填写后将以连字符追加到固定前缀之后。</div>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label">最终提交名称</label>' +
              '<div class="cc-review-preview" id="ccReviewPreview">-</div>' +
            '</div>' +
            '<div class="cc-msg" id="ccReviewMsg" aria-live="polite"></div>' +
            '<div class="cc-actions">' +
              '<button type="button" class="cc-btn cc-btn-primary cc-review-submit-btn" id="ccReviewConfirmBtn">确认提交</button>' +
              '<button type="button" class="cc-btn cc-btn-ghost" id="ccReviewCancelBtn">取消</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cc-save-modal" id="ccDeleteModal" hidden aria-hidden="true">' +
          '<div class="cc-save-backdrop" data-cc-del-close="1"></div>' +
          '<div class="cc-save-panel" role="dialog" aria-modal="true" aria-labelledby="ccDeleteTitle">' +
            '<div class="cc-save-head">' +
              '<div>' +
                '<div class="cc-kicker">DELETE DRAFT</div>' +
                '<h3 class="cc-save-title" id="ccDeleteTitle">删除草稿</h3>' +
              '</div>' +
              '<button type="button" class="cc-save-close" id="ccDeleteCloseBtn" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="cc-field">' +
              '<label class="cc-label">待删除存档</label>' +
              '<div class="cc-save-preview" id="ccDeleteName">-</div>' +
            '</div>' +
            '<div class="cc-help">删除后无法恢复，请确认是否继续。</div>' +
            '<div class="cc-msg" id="ccDeleteMsg" aria-live="polite"></div>' +
            '<div class="cc-actions">' +
              '<button type="button" class="cc-btn cc-btn-danger" id="ccDeleteConfirmBtn">确认删除</button>' +
              '<button type="button" class="cc-btn cc-btn-ghost" id="ccDeleteCancelBtn">取消</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function captureEls() {
    state.els.draftView = $('ccDraftView');
    state.els.sandboxView = $('sbView');
    state.els.draftTab = $('sbDraftTab');
    state.els.publicTab = $('sbPublicTab');
    state.els.list = $('ccList');
    state.els.form = $('ccForm');
    state.els.nameInput = $('ccNameInput');
    state.els.msg = $('ccMsg');
    state.els.newBtn = $('ccNewBtn');
    state.els.saveBtn = $('ccSaveBtn');
    state.els.resetBtn = $('ccResetBtn');
    state.els.ownerMeta = $('ccOwnerMeta');
    state.els.editState = $('ccEditState');
    state.els.currentId = $('ccCurrentId');
    state.els.currentStatus = $('ccCurrentStatus');
    state.els.saveModal = $('ccSaveModal');
    state.els.savePrefix = $('ccSavePrefix');
    state.els.saveSuffixInput = $('ccSaveSuffixInput');
    state.els.savePreview = $('ccSavePreview');
    state.els.saveMsg = $('ccSaveMsg');
    state.els.saveConfirmBtn = $('ccSaveConfirmBtn');
    state.els.saveCancelBtn = $('ccSaveCancelBtn');
    state.els.saveCloseBtn = $('ccSaveCloseBtn');
    state.els.reviewModal = $('ccReviewModal');
    state.els.reviewPrefix = $('ccReviewPrefix');
    state.els.reviewSuffixInput = $('ccReviewSuffixInput');
    state.els.reviewPreview = $('ccReviewPreview');
    state.els.reviewMsg = $('ccReviewMsg');
    state.els.reviewConfirmBtn = $('ccReviewConfirmBtn');
    state.els.reviewCancelBtn = $('ccReviewCancelBtn');
    state.els.reviewCloseBtn = $('ccReviewCloseBtn');
    state.els.deleteModal = $('ccDeleteModal');
    state.els.deleteName = $('ccDeleteName');
    state.els.deleteMsg = $('ccDeleteMsg');
    state.els.deleteConfirmBtn = $('ccDeleteConfirmBtn');
    state.els.deleteCancelBtn = $('ccDeleteCancelBtn');
    state.els.deleteCloseBtn = $('ccDeleteCloseBtn');
  }

  function renderOwnerMeta() {
    if (!state.els.ownerMeta) return;
    const short = state.ownerId ? (state.ownerId.length > 18 ? state.ownerId.slice(0, 18) + '?' : state.ownerId) : '-';
    state.els.ownerMeta.textContent = 'OWNER: ' + short;
    state.els.ownerMeta.title = state.ownerId || '';
  }

  function renderEditorState() {
    const selected = state.drafts.find((d) => d.id === state.selectedId) || null;
    if (state.els.editState) state.els.editState.textContent = selected ? '基于存档编辑' : '新建草稿';
    if (state.els.currentId) {
      state.els.currentId.textContent = selected ? String(selected.id).slice(0, 8) + '?' : 'NEW';
      state.els.currentId.title = selected ? String(selected.id) : 'NEW';
    }
    if (state.els.currentStatus) state.els.currentStatus.textContent = selected ? (selected.status || 'draft') : 'draft';
  }

  function renderList() {
    const list = state.els.list;
    if (!list) return;
    const canDelete = isAdminIdentity();
    if (!state.drafts.length) {
      list.innerHTML = '<div class="cc-list-empty">当前身份暂无草稿。<br>点击“+ 新建角色”创建第一条记录。</div>';
      return;
    }
    list.innerHTML = state.drafts.map((draft) => {
      const active = draft.id === state.selectedId ? ' is-active' : '';
      const submitting = String(draft.id) === state.submittingId;
      return '' +
        '<div class="cc-item' + active + '">' +
          '<button type="button" class="cc-item-main" data-id="' + escapeHtml(draft.id) + '">' +
            '<div class="cc-item-name">' + escapeHtml(draft.name || '(未命名)') + '</div>' +
            '<div class="cc-item-meta">' +
              '<span class="cc-item-time">' + escapeHtml(fmtTime(draft.updated_at)) + '</span>' +
              '<span class="cc-item-status">' + escapeHtml(draft.status || 'draft') + '</span>' +
            '</div>' +
          '</button>' +
          '<div class="cc-item-actions">' +
            '<button type="button" class="cc-item-submit" data-submit-id="' + escapeHtml(draft.id) + '"' +
              (submitting ? ' disabled' : '') + ' aria-label="提交审核">' + (submitting ? '提交中…' : '提交审核') + '</button>' +
            (canDelete
              ? '<button type="button" class="cc-item-del" data-del-id="' + escapeHtml(draft.id) + '"' +
                (submitting ? ' disabled' : '') + ' aria-label="删除草稿">删除</button>'
              : '') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function clearEditor(message, type) {
    state.selectedId = null;
    if (state.els.nameInput) state.els.nameInput.value = '';
    renderList();
    renderEditorState();
    if (message !== undefined) setMsg(message, type);
  }

  function extractPersonName(name) {
    const m = String(name || '').match(/^(.*)第\d+次修改/);
    if (m && m[1]) return m[1].trim();
    return String(name || '').trim();
  }

  function selectDraft(id) {
    const draft = state.drafts.find((d) => String(d.id) === String(id));
    if (!draft) return;
    state.selectedId = draft.id;
    if (state.els.nameInput) state.els.nameInput.value = extractPersonName(draft.name || '');
    renderList();
    renderEditorState();
    setMsg('已加载存档，可修改人物名称后保存为新版本。', 'warn');
  }

  async function refreshList() {
    if (!state.root || !state.els.list) return;
    const requestId = ++state.draftRequestId;
    try {
      const ownerId = await resolveOwnerId();
      const sb = ensureSupabase();
      setMsg('正在读取草稿列表…');
      const { data, error } = await sb
        .from('characters')
        .select('id, owner_id, name, status, content, updated_at')
        .eq('owner_id', ownerId)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (requestId !== state.draftRequestId || state.ownerId !== ownerId) return;
      state.drafts = Array.isArray(data) ? data : [];
      if (state.selectedId && !state.drafts.some((d) => d.id === state.selectedId)) {
        state.selectedId = null;
      }
      renderOwnerMeta();
      renderList();
      renderEditorState();
      setMsg(state.drafts.length ? '草稿列表已加载。' : '暂无草稿，可点击“+ 新建角色”。', state.drafts.length ? 'ok' : '');
    } catch (err) {
      if (requestId !== state.draftRequestId) return;
      if (err && /请先登录/.test(err.message)) {
        state.ownerId = '';
        state.drafts = [];
        state.selectedId = null;
        renderOwnerMeta();
        renderList();
        renderEditorState();
        setMsg('登录后可加载和管理个人草稿。', 'warn');
      } else {
        console.error('[CharacterManager] refreshList error:', err);
        setMsg('读取草稿失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      }
    }
  }

  function getNextVersion(personName) {
    const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + escaped + '第(\\d+)次修改');
    let maxN = 0;
    state.drafts.forEach((d) => {
      const m = String(d.name || '').match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > maxN) maxN = n;
      }
    });
    return maxN + 1;
  }

  function buildSaveName() {
    if (!state.pendingSave) return '';
    const suffix = (state.els.saveSuffixInput && state.els.saveSuffixInput.value || '').trim();
    return state.pendingSave.prefix + suffix;
  }

  function updateSavePreview() {
    if (state.els.savePreview) state.els.savePreview.textContent = buildSaveName() || '-';
  }

  function openSaveModal(personName) {
    const version = getNextVersion(personName);
    const prefix = personName + '第' + version + '次修改';
    state.pendingSave = { personName: personName, version: version, prefix: prefix };
    if (state.els.savePrefix) state.els.savePrefix.textContent = prefix;
    if (state.els.saveSuffixInput) state.els.saveSuffixInput.value = '';
    if (state.els.saveMsg) { state.els.saveMsg.textContent = ''; state.els.saveMsg.className = 'cc-msg'; }
    updateSavePreview();
    if (state.els.saveModal) {
      state.els.saveModal.hidden = false;
      state.els.saveModal.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => { if (state.els.saveSuffixInput) state.els.saveSuffixInput.focus(); }, 0);
  }

  function closeSaveModal() {
    if (state.els.saveModal) {
      state.els.saveModal.hidden = true;
      state.els.saveModal.setAttribute('aria-hidden', 'true');
    }
    state.pendingSave = null;
  }

  function openDeleteModal(id) {
    const draft = state.drafts.find((d) => String(d.id) === String(id));
    if (!draft) return;
    state.pendingDelete = draft;
    if (state.els.deleteName) state.els.deleteName.textContent = draft.name || '(未命名)';
    if (state.els.deleteMsg) { state.els.deleteMsg.textContent = ''; state.els.deleteMsg.className = 'cc-msg'; }
    if (state.els.deleteModal) {
      state.els.deleteModal.hidden = false;
      state.els.deleteModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDeleteModal() {
    if (state.els.deleteModal) {
      state.els.deleteModal.hidden = true;
      state.els.deleteModal.setAttribute('aria-hidden', 'true');
    }
    state.pendingDelete = null;
  }

  async function confirmDelete() {
    if (!state.pendingDelete || state.saving) return;
    if (!isAdminIdentity()) {
      closeDeleteModal();
      setMsg('当前账号没有删除权限。', 'error');
      return;
    }
    const draft = state.pendingDelete;
    const sb = ensureSupabase();
    if (state.els.deleteConfirmBtn) { state.els.deleteConfirmBtn.disabled = true; state.els.deleteConfirmBtn.textContent = '删除中…'; }
    if (state.els.deleteMsg) { state.els.deleteMsg.textContent = '正在删除…'; state.els.deleteMsg.className = 'cc-msg'; }
    try {
      const ownerId = await resolveOwnerId();
      const { error } = await sb
        .from('characters')
        .delete()
        .eq('id', draft.id)
        .eq('owner_id', ownerId);
      if (error) throw error;
      state.drafts = state.drafts.filter((d) => d.id !== draft.id);
      if (state.selectedId === draft.id) {
        state.selectedId = null;
        if (state.els.nameInput) state.els.nameInput.value = '';
      }
      renderList();
      renderEditorState();
      closeDeleteModal();
      setMsg('已删除草稿：' + (draft.name || ''), 'ok');
    } catch (err) {
      console.error('[CharacterManager] delete error:', err);
      const msg = '删除失败：' + (err && err.message ? err.message : '未知错误');
      if (state.els.deleteMsg) { state.els.deleteMsg.textContent = msg; state.els.deleteMsg.className = 'cc-msg is-error'; }
    } finally {
      if (state.els.deleteConfirmBtn) { state.els.deleteConfirmBtn.disabled = false; state.els.deleteConfirmBtn.textContent = '确认删除'; }
    }
  }

  function getReviewPersonName(draft) {
    const storedName = draft.content && typeof draft.content === 'object' &&
      typeof draft.content.personName === 'string'
      ? draft.content.personName.trim()
      : '';
    return storedName || extractPersonName(draft.name || '');
  }

  function buildReviewName() {
    if (!state.pendingReview) return '';
    const suffix = (state.els.reviewSuffixInput && state.els.reviewSuffixInput.value || '').trim();
    return state.pendingReview.prefix + (suffix ? '-' + suffix : '');
  }

  function updateReviewPreview() {
    if (state.els.reviewPreview) state.els.reviewPreview.textContent = buildReviewName() || '-';
  }

  function setReviewBusy(isBusy) {
    const busy = !!isBusy;
    if (state.els.reviewConfirmBtn) {
      state.els.reviewConfirmBtn.disabled = busy;
      state.els.reviewConfirmBtn.textContent = busy ? '提交中…' : '确认提交';
    }
    if (state.els.reviewCancelBtn) state.els.reviewCancelBtn.disabled = busy;
    if (state.els.reviewCloseBtn) state.els.reviewCloseBtn.disabled = busy;
  }

  function openReviewModal(personName, version, draft, ownerId) {
    const prefix = '待审核稿件-' + personName + '-第' + version + '次提交';
    state.pendingReview = { personName: personName, version: version, prefix: prefix, draft: draft, ownerId: ownerId };
    if (state.els.reviewPrefix) state.els.reviewPrefix.textContent = prefix;
    if (state.els.reviewSuffixInput) state.els.reviewSuffixInput.value = '';
    if (state.els.reviewMsg) {
      state.els.reviewMsg.textContent = '';
      state.els.reviewMsg.className = 'cc-msg';
    }
    updateReviewPreview();
    if (state.els.reviewModal) {
      state.els.reviewModal.hidden = false;
      state.els.reviewModal.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => {
      if (state.els.reviewSuffixInput) state.els.reviewSuffixInput.focus();
    }, 0);
  }

  function closeReviewModal(force) {
    if (state.submittingId && !force) return;
    if (state.els.reviewModal) {
      state.els.reviewModal.hidden = true;
      state.els.reviewModal.setAttribute('aria-hidden', 'true');
    }
    state.pendingReview = null;
  }

  async function submitForReview(characterId) {
    const draft = state.drafts.find((item) => String(item.id) === String(characterId));
    if (!draft || state.submittingId || state.saving) return false;
    let ownerId;
    try {
      ownerId = await resolveOwnerId();
    } catch (error) {
      setMsg(error.message, 'error');
      return false;
    }
    const personName = getReviewPersonName(draft);
    if (!personName) {
      setMsg('无法从该草稿中识别人物名称，请先检查草稿内容。', 'error');
      return false;
    }

    state.submittingId = String(draft.id);
    setMsg('正在计算该人物的提交次数…');
    renderList();
    try {
      const likeValue = '%' + personName.replace(/[\\%_]/g, '\\$&') + '%';
      const { count, error } = await ensureSupabase()
        .from('characters')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerId)
        .like('name', likeValue)
        .in('status', ['pending', 'approved']);
      if (error) throw error;
      if (String(state.ownerId) !== ownerId) return false;
      if (!Number.isFinite(count)) throw new Error('数据库未返回有效的提交次数。');

      const version = count + 1;
      openReviewModal(personName, version, draft, ownerId);
      return true;
    } catch (err) {
      console.error('[CharacterManager] submitForReview count error:', err);
      if (err && /请先登录/.test(err.message)) {
        requestLogin('登录后才能提交人物审核。');
        return false;
      }
      setMsg('无法计算提交次数：' + (err && err.message ? err.message : '未知错误'), 'error');
      return false;
    } finally {
      state.submittingId = null;
      renderList();
    }
  }

  async function confirmSubmitForReview() {
    if (!state.pendingReview || state.submittingId || state.saving) return false;
    const pending = state.pendingReview;
    const finalName = buildReviewName();
    if (!finalName) {
      if (state.els.reviewMsg) {
        state.els.reviewMsg.textContent = '提交名称不能为空。';
        state.els.reviewMsg.className = 'cc-msg is-error';
      }
      return false;
    }

    state.submittingId = String(pending.draft.id);
    setReviewBusy(true);
    if (state.els.reviewMsg) {
      state.els.reviewMsg.textContent = '正在创建待审核副本…';
      state.els.reviewMsg.className = 'cc-msg';
    }
    try {
      const ownerId = await resolveOwnerId();
      if (ownerId !== pending.ownerId) throw new Error('登录身份已变化，请重新发起提交。');
      const { error } = await ensureSupabase()
        .from('characters')
        .insert([{
          owner_id: pending.ownerId,
          name: finalName,
          status: 'pending',
          content: pending.draft.content,
          updated_at: new Date().toISOString()
        }]);
      if (error) throw error;
      if (String(state.ownerId) !== pending.ownerId) return false;

      closeReviewModal(true);
      setMsg('已提交审核副本：' + finalName + '。原草稿已保留。', 'ok');
      return true;
    } catch (err) {
      console.error('[CharacterManager] submitForReview insert error:', err);
      if (err && /请先登录/.test(err.message)) requestLogin('登录后才能提交人物审核。');
      if (state.els.reviewMsg) {
        state.els.reviewMsg.textContent = '提交失败：' + (err && err.message ? err.message : '未知错误');
        state.els.reviewMsg.className = 'cc-msg is-error';
      }
      return false;
    } finally {
      state.submittingId = null;
      setReviewBusy(false);
      renderList();
    }
  }

  function setView(view) {
    const showSandbox = view === 'sandbox';
    if (state.els.draftView) state.els.draftView.hidden = showSandbox;
    if (state.els.sandboxView) state.els.sandboxView.hidden = !showSandbox;
    if (state.els.draftTab) {
      state.els.draftTab.classList.toggle('is-active', !showSandbox);
      state.els.draftTab.setAttribute('aria-pressed', String(!showSandbox));
    }
    if (state.els.publicTab) {
      state.els.publicTab.classList.toggle('is-active', showSandbox);
      state.els.publicTab.setAttribute('aria-pressed', String(showSandbox));
    }
    if (showSandbox && window.SandboxManager && state.els.sandboxView) {
      window.SandboxManager.mount(state.els.sandboxView);
    }
  }

  async function onSaveSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (state.saving) return;
    try {
      const user = window.GreyAuth && await window.GreyAuth.getAuthenticatedUser();
      if (!user) {
        requestLogin('登录后才能创建和保存人物。');
        return;
      }
    } catch (err) {
      console.error('[CharacterManager] authentication check failed:', err);
      setMsg('无法确认登录状态：' + (err && err.message ? err.message : '未知错误'), 'error');
      return;
    }
    const personName = (state.els.nameInput && state.els.nameInput.value || '').trim();
    if (!personName) { setMsg('请输入人物名称。', 'error'); if (state.els.nameInput) state.els.nameInput.focus(); return; }
    if (personName.length > 40) { setMsg('人物名称不能超过 40 个字符。', 'error'); return; }
    openSaveModal(personName);
  }

  async function confirmSave() {
    if (!state.pendingSave || state.saving) return;
    const saveName = buildSaveName().trim();
    if (!saveName) {
      if (state.els.saveMsg) { state.els.saveMsg.textContent = '存档名不能为空。'; state.els.saveMsg.className = 'cc-msg is-error'; }
      return;
    }
    if (saveName.length > 80) {
      if (state.els.saveMsg) { state.els.saveMsg.textContent = '存档名过长，请缩短后缀。'; state.els.saveMsg.className = 'cc-msg is-error'; }
      return;
    }

    setBusy(true);
    if (state.els.saveConfirmBtn) { state.els.saveConfirmBtn.disabled = true; state.els.saveConfirmBtn.textContent = '保存中…'; }
    if (state.els.saveMsg) { state.els.saveMsg.textContent = '正在保存版本…'; state.els.saveMsg.className = 'cc-msg'; }

    try {
      const ownerId = await resolveOwnerId();
      const now = new Date().toISOString();
      const { data, error } = await ensureSupabase()
        .from('characters')
        .insert([{
          owner_id: ownerId,
          name: saveName,
          status: 'draft',
          content: { personName: state.pendingSave.personName, version: state.pendingSave.version },
          updated_at: now
        }])
        .select('id, owner_id, name, status, content, updated_at')
        .single();
      if (error) throw error;

      state.drafts.unshift(data);
      state.drafts.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      state.selectedId = data.id;
      renderList();
      renderEditorState();
      closeSaveModal();
      setMsg('已保存版本：' + saveName, 'ok');
    } catch (err) {
      console.error('[CharacterManager] saveDraft error:', err);
      const msg = '保存失败：' + (err && err.message ? err.message : '未知错误');
      if (state.els.saveMsg) { state.els.saveMsg.textContent = msg; state.els.saveMsg.className = 'cc-msg is-error'; }
      setMsg(msg, 'error');
      if (err && /请先登录/.test(err.message)) requestLogin('登录后才能创建和保存人物。');
    } finally {
      setBusy(false);
      if (state.els.saveConfirmBtn) { state.els.saveConfirmBtn.disabled = false; state.els.saveConfirmBtn.textContent = '确认保存'; }
    }
  }

  function bindLocalEvents() {
    if (state.els._bound) return;
    state.els._bound = true;
    if (state.els.newBtn) state.els.newBtn.addEventListener('click', async () => {
      try {
        const user = window.GreyAuth && await window.GreyAuth.getAuthenticatedUser();
        if (!user) {
          requestLogin('登录后才能创建人物。');
          return;
        }
        clearEditor('已切换到新建模式，请输入人物名称。');
        if (state.els.nameInput) state.els.nameInput.focus();
      } catch (err) {
        console.error('[CharacterManager] authentication check failed:', err);
        setMsg('无法确认登录状态：' + (err && err.message ? err.message : '未知错误'), 'error');
      }
    });
    if (state.els.resetBtn) state.els.resetBtn.addEventListener('click', () => clearEditor('编辑区已清空。'));
    if (state.els.form) state.els.form.addEventListener('submit', onSaveSubmit);
    if (state.els.list) state.els.list.addEventListener('click', (e) => {
      const submitBtn = e.target.closest('[data-submit-id]');
      if (submitBtn) {
        submitForReview(submitBtn.getAttribute('data-submit-id'));
        return;
      }
      const delBtn = e.target.closest('[data-del-id]');
      if (delBtn) { openDeleteModal(delBtn.getAttribute('data-del-id')); return; }
      const btn = e.target.closest('[data-id]');
      if (btn) selectDraft(btn.getAttribute('data-id'));
    });
    if (state.els.draftTab) state.els.draftTab.addEventListener('click', () => setView('drafts'));
    if (state.els.publicTab) state.els.publicTab.addEventListener('click', () => setView('sandbox'));

    if (state.els.saveSuffixInput) state.els.saveSuffixInput.addEventListener('input', updateSavePreview);
    if (state.els.saveConfirmBtn) state.els.saveConfirmBtn.addEventListener('click', confirmSave);
    if (state.els.saveCancelBtn) state.els.saveCancelBtn.addEventListener('click', closeSaveModal);
    if (state.els.saveCloseBtn) state.els.saveCloseBtn.addEventListener('click', closeSaveModal);
    if (state.els.saveModal) {
      state.els.saveModal.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-cc-save-close') === '1') closeSaveModal();
      });
    }
    if (state.els.reviewSuffixInput) state.els.reviewSuffixInput.addEventListener('input', updateReviewPreview);
    if (state.els.reviewConfirmBtn) state.els.reviewConfirmBtn.addEventListener('click', confirmSubmitForReview);
    if (state.els.reviewCancelBtn) state.els.reviewCancelBtn.addEventListener('click', () => closeReviewModal());
    if (state.els.reviewCloseBtn) state.els.reviewCloseBtn.addEventListener('click', () => closeReviewModal());
    if (state.els.reviewModal) {
      state.els.reviewModal.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-cc-review-close') === '1') closeReviewModal();
      });
    }
    if (state.els.deleteConfirmBtn) state.els.deleteConfirmBtn.addEventListener('click', confirmDelete);
    if (state.els.deleteCancelBtn) state.els.deleteCancelBtn.addEventListener('click', closeDeleteModal);
    if (state.els.deleteCloseBtn) state.els.deleteCloseBtn.addEventListener('click', closeDeleteModal);
    if (state.els.deleteModal) {
      state.els.deleteModal.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-cc-del-close') === '1') closeDeleteModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.els.saveModal && !state.els.saveModal.hidden) closeSaveModal();
        if (state.els.reviewModal && !state.els.reviewModal.hidden) closeReviewModal();
        if (state.els.deleteModal && !state.els.deleteModal.hidden) closeDeleteModal();
      }
    });
  }

  function bindGlobalEvents() {
    if (state.boundGlobal) return;
    state.boundGlobal = true;
    document.addEventListener('greyauth:changed', (e) => {
      const nextOwner = e && e.detail && e.detail.identity && e.detail.identity.ownerId;
      const keepUnsavedName = !state.ownerId && !!nextOwner;
      state.ownerId = nextOwner ? String(nextOwner) : '';
      state.draftRequestId += 1;
      state.drafts = [];
      state.selectedId = null;
      if (!keepUnsavedName && state.els.nameInput) state.els.nameInput.value = '';
      renderOwnerMeta();
      renderEditorState();
      closeSaveModal();
      closeReviewModal(true);
      closeDeleteModal();
      if (state.root && state.els.list) refreshList();
    });
  }

  function init(currentOwnerId) {
    state.ownerId = '';
    if (state.root) {
      captureEls();
      bindLocalEvents();
      renderOwnerMeta();
      renderEditorState();
    }
    bindGlobalEvents();
    return state.els.list ? refreshList() : Promise.resolve();
  }

  function mount(container, currentOwnerId) {
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) throw new Error('CharacterManager.mount: 未找到容器');
    target.innerHTML = template();
    state.root = target;
    state.els = {};
    captureEls();
    bindLocalEvents();
    bindGlobalEvents();
    state.ownerId = '';
    renderOwnerMeta();
    renderEditorState();
    return refreshList();
  }

  function setOwnerId(nextOwnerId) {
    state.ownerId = '';
    state.selectedId = null;
    if (state.els.nameInput) state.els.nameInput.value = '';
    renderOwnerMeta();
    renderEditorState();
    closeSaveModal();
    closeDeleteModal();
    return refreshList();
  }

  window.CharacterManager = {
    init: init,
    refreshList: refreshList,
    mount: mount,
    setOwnerId: setOwnerId,
    getState: function () { return { ownerId: state.ownerId, selectedId: state.selectedId, count: state.drafts.length }; },
    submitForReview: submitForReview
  };
})();
