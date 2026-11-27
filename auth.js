/* auth.js
 * 灰星终端 - Supabase Auth 认证
 * 依赖：supabase-client.js (window.GreySupabase), auth.css
 */
(function () {
  'use strict';

  const INTERNAL_EMAIL_DOMAIN = 'greystar.internal';
  const LEGACY_EMAIL_DOMAIN = 'accounts.grey-terminal.invalid';
  const INITIALIZATION_MESSAGE = '系统加载缓慢，请检查网络或稍候重试';
  const $ = (selector, root) => (root || document).querySelector(selector);
  let modalEl = null;
  let lastFocusEl = null;
  let clientReady = false;
  let initToastTimer = null;
  let currentIdentity = {
    type: 'signed-out',
    ownerId: null,
    label: '未登录',
    user: null,
    isAdmin: false,
    authenticated: false
  };
  let authSubscription = null;
  let identityRevision = 0;
  let initPromise = null;

  async function getSupabase() {
    try {
      const client = typeof window.getGreySupabase === 'function'
        ? await window.getGreySupabase()
        : window.GreySupabase;
      if (!client) throw new Error('Supabase 客户端尚未就绪。');
      setClientReady(true);
      return client;
    } catch (error) {
      setClientReady(false);
      showInitializationToast();
      console.warn('[GreyAuth] Supabase client is not ready:', error);
      throw new Error(INITIALIZATION_MESSAGE);
    }
  }

  function showInitializationToast() {
    let toast = $('#authInitToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'authInitToast';
      toast.className = 'auth-init-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = INITIALIZATION_MESSAGE;
    toast.hidden = false;
    if (initToastTimer) clearTimeout(initToastTimer);
    initToastTimer = setTimeout(() => {
      toast.hidden = true;
      initToastTimer = null;
    }, 7000);
  }

  function setClientReady(ready) {
    clientReady = !!ready;
    const statusButton = $('#authStatusBtn');
    if (statusButton) statusButton.disabled = !clientReady;

    if (modalEl) {
      modalEl.querySelectorAll('.auth-submit').forEach(button => {
        const form = button.closest('form');
        const busy = !!(form && form.dataset.busy === 'true');
        button.disabled = !clientReady || busy;
        button.textContent = busy
          ? '处理中…'
          : clientReady
            ? button.dataset.readyLabel
            : '终端初始化中...';
      });
    }
    renderIdentity();
  }

  function dispatchIdentityEvent(eventName) {
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: { identity: getIdentity() }
    }));
  }

  function getIdentity() {
    return currentIdentity;
  }

  async function getAuthenticatedUser() {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.getUser();
    if (error) {
      if (error.name === 'AuthSessionMissingError' || error.code === 'session_not_found') return null;
      throw new Error('读取登录会话失败：' + error.message);
    }
    const user = data && data.user;
    return user && user.email ? user : null;
  }

  async function usernameToEmail(username) {
    const normalized = username.trim().toLowerCase();
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const safeUsername = normalized.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const codepointLabel = Array.from(normalized)
      .slice(0, 4)
      .map(character => character.codePointAt(0).toString(16))
      .join('_');
    const readablePrefix = safeUsername || ('u' + codepointLabel);
    return readablePrefix + '_' + hex.slice(0, 12) + '@' + INTERNAL_EMAIL_DOMAIN;
  }

  async function previousUsernameToEmail(username) {
    const normalized = username.trim().toLowerCase();
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const safeUsername = normalized.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'user';
    return safeUsername + hex.slice(0, 24) + '@' + INTERNAL_EMAIL_DOMAIN;
  }

  async function legacyUsernameToEmail(username) {
    const bytes = new TextEncoder().encode(username.trim().toLowerCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return 'u' + hex.slice(0, 40) + '@' + LEGACY_EMAIL_DOMAIN;
  }

  async function requireAuthenticatedSession(expectedUserId) {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.getSession();
    if (error) throw new Error('确认登录会话失败：' + error.message);
    const sessionUser = data && data.session && data.session.user;
    if (!sessionUser || sessionUser.id !== expectedUserId || !sessionUser.email) {
      throw new Error('请先登录后再继续。');
    }
    return sessionUser;
  }

  async function getUserProfile(authUser) {
    const sb = await getSupabase();
    const { data, error } = await sb
      .from('users')
      .select('id, auth_user_id, username, role')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (error) {
      console.error('[GreyAuth] public.users profile lookup failed:', error);
      throw new Error('读取用户角色失败：' + error.message);
    }
    return data;
  }

  async function persistProfile(authUser, username) {
    const sb = await getSupabase();
    const { error } = await sb
      .from('users')
      .insert({
        id: authUser.id,
        auth_user_id: authUser.id,
        username: username,
        role: 'player'
      });
    if (error) {
      console.error('[GreyAuth] public.users profile insert failed:', error);
      if (error.code === '23505') {
        const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ');
        if (/username/i.test(detail)) {
          throw new Error('用户名已存在，请更换一个用户名。');
        }
        throw new Error('用户资料发生唯一键冲突：' + (error.message || '请检查 users 表中的 id 和 auth_user_id。'));
      }
      throw new Error('创建用户资料失败：' + error.message);
    }
  }

  async function hydrateIdentity(authUser, revision) {
    const candidate = authUser || await getAuthenticatedUser();
    const user = candidate && candidate.email ? candidate : null;
    if (revision !== identityRevision) return currentIdentity;
    if (!user) {
      currentIdentity = {
        type: 'signed-out',
        ownerId: null,
        label: '未登录',
        user: null,
        isAdmin: false,
        authenticated: false
      };
      return currentIdentity;
    }

    let profile;
    let profileError = null;
    try {
      profile = await getUserProfile(user);
    } catch (error) {
      profileError = error;
      console.error('[GreyAuth] profile lookup failed:', error);
    }
    if (revision !== identityRevision) return currentIdentity;

    const role = profileError ? null : profile && profile.role === 'admin' ? 'admin' : 'player';
    const username = profile && profile.username
      ? profile.username
      : (user.user_metadata && user.user_metadata.username) || user.email || '玩家';
    currentIdentity = {
      type: 'user',
      ownerId: String(user.id),
      label: username,
      user: Object.assign({}, user, { username: username, role: role }),
      role: role,
      isAdmin: role === 'admin',
      authenticated: true,
      roleError: profileError ? profileError.message : '',
      profileMissing: !profileError && !profile
    };
    return currentIdentity;
  }

  function ensureStatusButton() {
    const header = $('.bar-t');
    if (!header) return null;
    let button = $('#authStatusBtn');
    if (button) return button;

    button = document.createElement('button');
    button.type = 'button';
    button.id = 'authStatusBtn';
    button.className = 'auth-status-btn';
    button.innerHTML = [
      '<span class="auth-dot" aria-hidden="true"></span>',
      '<span class="auth-label">当前身份</span>',
      '<span class="auth-value" id="authStatusValue">' +
        (clientReady ? '未登录' : '终端初始化中...') +
      '</span>'
    ].join('');
    button.disabled = !clientReady;
    button.addEventListener('click', openModal);
    header.appendChild(button);
    return button;
  }

  function ensureAdminReviewButton() {
    const header = $('.bar-t');
    if (!header) return null;
    let button = $('#authAdminReviewBtn');
    if (button) return button;

    button = document.createElement('button');
    button.type = 'button';
    button.id = 'authAdminReviewBtn';
    button.className = 'auth-admin-review-btn';
    button.textContent = '审核台';
    button.hidden = true;
    button.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('greyadmin:open-review'));
    });
    header.appendChild(button);
    return button;
  }

  function renderIdentity() {
    ensureStatusButton();
    ensureAdminReviewButton();
    const button = $('#authStatusBtn');
    const value = $('#authStatusValue');
    const reviewButton = $('#authAdminReviewBtn');
    if (value) {
      value.textContent = !clientReady
        ? '终端初始化中...'
        : currentIdentity.type === 'user'
        ? (currentIdentity.roleError ? '权限验证失败 - ' : currentIdentity.isAdmin ? '管理员 - ' : '玩家 - ') + currentIdentity.label
        : currentIdentity.label;
    }
    if (reviewButton) reviewButton.hidden = !currentIdentity.isAdmin;
    if (button) {
      button.disabled = !clientReady;
      button.classList.toggle('is-loading', !clientReady);
      button.classList.toggle('is-user', currentIdentity.type === 'user');
      button.classList.toggle('is-admin', currentIdentity.isAdmin);
      button.title = currentIdentity.type === 'user'
        ? '当前身份：' + (currentIdentity.isAdmin ? '管理员 - ' : '玩家 - ') + currentIdentity.label
        : clientReady ? '点击登录或注册' : INITIALIZATION_MESSAGE;
      button.setAttribute('aria-label', button.title);
    }
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'auth-modal';
    modalEl.id = 'authModal';
    modalEl.hidden = true;
    modalEl.innerHTML = ''
      + '<div class="auth-modal-backdrop" data-auth-close="1"></div>'
      + '<div class="auth-modal-panel" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">'
      +   '<div class="auth-modal-head">'
      +     '<div><div class="auth-modal-kicker">GREYSTAR IDENTITY ACCESS</div>'
      +     '<div class="auth-modal-title" id="authModalTitle">身份接入</div></div>'
      +     '<button type="button" class="auth-modal-close" id="authModalClose" aria-label="关闭">×</button>'
      +   '</div>'
      +   '<div class="auth-tabs" role="tablist" aria-label="认证方式">'
      +     '<button type="button" class="auth-tab" role="tab" id="authTabLogin" aria-controls="authPanelLogin" aria-selected="true">登录</button>'
      +     '<button type="button" class="auth-tab" role="tab" id="authTabRegister" aria-controls="authPanelRegister" aria-selected="false">注册</button>'
      +   '</div>'
      +   '<form id="authPanelLogin" class="auth-panel" role="tabpanel" aria-labelledby="authTabLogin" novalidate>'
      +     '<div class="auth-field"><label for="authLoginUsername">账号名</label>'
      +     '<input class="auth-input" id="authLoginUsername" autocomplete="username" maxlength="32" placeholder="输入账号名" /></div>'
      +     '<div class="auth-field"><label for="authLoginPassword">密码</label>'
      +     '<input class="auth-input" id="authLoginPassword" type="password" autocomplete="current-password" maxlength="64" placeholder="输入密码" /></div>'
      +     '<div class="auth-msg" id="authLoginMsg" aria-live="polite"></div>'
      +     '<div class="auth-actions"><button type="submit" class="auth-submit" data-ready-label="接入账号" disabled>终端初始化中...</button></div>'
      +   '</form>'
      +   '<form id="authPanelRegister" class="auth-panel" role="tabpanel" aria-labelledby="authTabRegister" hidden novalidate>'
      +     '<div class="auth-field"><label for="authRegisterUsername">账号名</label>'
      +     '<input class="auth-input" id="authRegisterUsername" autocomplete="username" maxlength="32" placeholder="设置账号名（唯一）" /></div>'
      +     '<div class="auth-field"><label for="authRegisterPassword">密码</label>'
      +     '<input class="auth-input" id="authRegisterPassword" type="password" autocomplete="new-password" minlength="6" maxlength="64" placeholder="设置密码（至少 6 位）" /></div>'
      +     '<div class="auth-field"><label for="authRegisterPassword2">确认密码</label>'
      +     '<input class="auth-input" id="authRegisterPassword2" type="password" autocomplete="new-password" minlength="6" maxlength="64" placeholder="再次输入密码" /></div>'
      +     '<p class="auth-hint warn">无需填写邮箱或手机号，请注意保存账号与密码</p>'
      +     '<div class="auth-msg" id="authRegisterMsg" aria-live="polite"></div>'
      +     '<div class="auth-actions"><button type="submit" class="auth-submit" data-ready-label="建立身份" disabled>终端初始化中...</button></div>'
      +   '</form>'
      +   '<div class="auth-meta" id="authMeta"></div>'
      + '</div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', event => {
      if (event.target && event.target.getAttribute('data-auth-close') === '1') closeModal();
    });
    $('#authModalClose', modalEl).addEventListener('click', closeModal);
    $('#authTabLogin', modalEl).addEventListener('click', () => switchTab('login'));
    $('#authTabRegister', modalEl).addEventListener('click', () => switchTab('register'));
    $('#authPanelLogin', modalEl).addEventListener('submit', onLoginSubmit);
    $('#authPanelRegister', modalEl).addEventListener('submit', onRegisterSubmit);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
    });
    return modalEl;
  }

  function switchTab(tab) {
    ensureModal();
    const login = tab === 'login';
    $('#authTabLogin').setAttribute('aria-selected', login ? 'true' : 'false');
    $('#authTabRegister').setAttribute('aria-selected', login ? 'false' : 'true');
    $('#authPanelLogin').hidden = !login;
    $('#authPanelRegister').hidden = login;
    clearMsg($('#authLoginMsg'));
    clearMsg($('#authRegisterMsg'));
    const focus = document.getElementById(login ? 'authLoginUsername' : 'authRegisterUsername');
    if (focus) focus.focus();
  }

  function setMsg(element, text, type) {
    if (!element) return;
    element.textContent = text || '';
    element.className = 'auth-msg' + (type ? ' is-' + type : '');
  }

  function clearMsg(element) { setMsg(element, '', ''); }

  function setBusy(form, busy) {
    form.dataset.busy = String(!!busy);
    const button = form.querySelector('.auth-submit');
    if (button) {
      button.disabled = !!busy || !clientReady;
      button.textContent = busy
        ? '处理中…'
        : clientReady
          ? button.dataset.readyLabel
          : '终端初始化中...';
    }
    form.querySelectorAll('input').forEach(input => { input.disabled = !!busy; });
  }

  async function openModal() {
    try {
      await getSupabase();
    } catch (_) {
      return;
    }
    ensureModal();
    lastFocusEl = document.activeElement;
    renderMeta();
    modalEl.hidden = false;
    document.body.style.overflow = 'hidden';
    switchTab('login');
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.hidden = true;
    document.body.style.overflow = '';
    if (lastFocusEl && typeof lastFocusEl.focus === 'function') lastFocusEl.focus();
  }

  function renderMeta() {
    const meta = $('#authMeta');
    if (!meta) return;
    if (currentIdentity.authenticated && currentIdentity.type === 'user') {
      meta.innerHTML = (currentIdentity.roleError
        ? '<strong>权限验证失败：</strong>' + escapeHtml(currentIdentity.roleError) + '<br>'
        : '<strong>已登录：</strong>' + escapeHtml(currentIdentity.label)
          + ' · ' + (currentIdentity.isAdmin ? '管理员' : '玩家') + '<br>')
        + '<button type="button" class="auth-secondary" id="authLogoutBtn" style="margin-top:10px">退出当前账号</button>';
      $('#authLogoutBtn', meta).addEventListener('click', onLogout);
    } else {
      meta.textContent = '可先浏览终端内容；登录后即可创建和管理个人角色。';
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function validateUsername(username) {
    if (!username) return '请输入账号名';
    if (username.length < 2) return '账号名至少 2 个字符';
    if (username.length > 32) return '账号名不能超过 32 个字符';
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(username)) return '账号名仅支持字母、数字、下划线、短横线或中文';
    return '';
  }

  function validatePassword(password) {
    if (!password) return '请输入密码';
    if (password.length < 6) return '密码至少 6 个字符';
    if (password.length > 64) return '密码不能超过 64 个字符';
    return '';
  }

  async function onRegisterSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const msg = $('#authRegisterMsg');
    clearMsg(msg);
    const username = $('#authRegisterUsername').value.trim();
    const password = $('#authRegisterPassword').value;
    const password2 = $('#authRegisterPassword2').value;
    const usernameError = validateUsername(username);
    if (usernameError) return setMsg(msg, usernameError, 'error');
    const passwordError = validatePassword(password);
    if (passwordError) return setMsg(msg, passwordError, 'error');
    if (password !== password2) return setMsg(msg, '两次输入的密码不一致', 'error');

    setBusy(form, true);
    try {
      const sb = await getSupabase();
      const email = await usernameToEmail(username);
      const { data, error } = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { username: username } }
      });
      if (error) {
        console.error('[GreyAuth] Supabase signUp failed:', error);
        if (/already|exists|registered|duplicate/i.test(error.message || '')) {
          throw new Error('该账号名已被占用，请更换一个用户名。');
        }
        throw new Error('注册失败：' + error.message);
      }
      const user = data && data.user;
      if (!user) throw new Error('注册失败：Supabase 未返回用户。');
      if (!data.session || !data.session.access_token || !data.session.user ||
          data.session.user.id !== user.id) {
        throw new Error('Auth 用户已创建，但 Supabase 未返回有效会话，因此无法按 RLS 写入 users 资料。请先完成邮箱确认后登录（登录时会尝试补建资料）；若使用无法收信的内部邮箱，请在 Supabase 控制台删除这个 Auth 用户、关闭邮箱确认后再注册。');
      }
      let profileWriteError = null;
      try {
        await persistProfile(user, username);
      } catch (error) {
        profileWriteError = error;
        console.error('[GreyAuth] account created but profile insert failed:', error);
      }

      await refreshIdentity(user);
      renderMeta();
      dispatchIdentityEvent('greyauth:changed');
      setMsg(msg, profileWriteError
        ? '账号已创建并登录，但 users 资料写入失败：' + profileWriteError.message
        : '账号注册成功。', profileWriteError ? 'warn' : 'ok');
      setTimeout(closeModal, 900);
    } catch (error) {
      if (error.message === INITIALIZATION_MESSAGE) {
        console.warn('[GreyAuth] registration is waiting for the Supabase client:', error);
      } else {
        console.error('[GreyAuth] Registration flow failed:', error);
      }
      setMsg(msg, error.message || '注册失败', 'error');
    } finally {
      setBusy(form, false);
    }
  }

  async function onLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const msg = $('#authLoginMsg');
    clearMsg(msg);
    const username = $('#authLoginUsername').value.trim();
    const password = $('#authLoginPassword').value;
    const usernameError = validateUsername(username);
    if (usernameError) return setMsg(msg, usernameError, 'error');
    if (!password) return setMsg(msg, '请输入密码', 'error');

    setBusy(form, true);
    try {
      const sb = await getSupabase();
      const emails = [
        await usernameToEmail(username),
        await previousUsernameToEmail(username),
        await legacyUsernameToEmail(username)
      ];
      let data = null;
      let error = null;
      for (const email of emails) {
        const result = await sb.auth.signInWithPassword({ email: email, password: password });
        data = result.data;
        error = result.error;
        if (!error) break;
      }
      if (error) {
        console.error('[GreyAuth] Supabase signInWithPassword failed:', error);
        throw new Error('账号或密码错误：' + error.message);
      }
      if (!data || !data.user) throw new Error('登录失败：Supabase 未返回用户。');

      await requireAuthenticatedSession(data.user.id);
      let profileWriteError = null;
      try {
        const profile = await getUserProfile(data.user);
        if (!profile) await persistProfile(data.user, username);
      } catch (error) {
        profileWriteError = error;
        console.error('[GreyAuth] login succeeded but profile repair failed:', error);
      }
      const identity = await refreshIdentity(data.user);
      renderMeta();
      dispatchIdentityEvent('greyauth:changed');
      if (profileWriteError) {
        setMsg(msg, '账号已登录，但 users 资料未能读取或补建：' + profileWriteError.message, 'warn');
      } else if (identity.roleError) {
        setMsg(msg, '账号已登录，但读取用户角色失败；为安全起见暂按普通玩家处理。' + identity.roleError, 'warn');
      } else if (identity.profileMissing) {
        setMsg(msg, '账号已登录，但 users 表中没有对应资料；当前按普通玩家权限显示。', 'warn');
      } else {
        setMsg(msg, identity.isAdmin ? '管理员身份接入成功。' : '登录成功。', 'ok');
      }
      setTimeout(closeModal, 800);
    } catch (error) {
      if (error.message === INITIALIZATION_MESSAGE) {
        console.warn('[GreyAuth] login is waiting for the Supabase client:', error);
      } else {
        console.error('[GreyAuth] Login flow failed:', error);
      }
      setMsg(msg, error.message || '登录失败', 'error');
    } finally {
      setBusy(form, false);
    }
  }

  async function onLogout() {
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signOut();
      if (error) throw new Error('退出失败：' + error.message);
      await refreshIdentity(null);
      renderMeta();
      dispatchIdentityEvent('greyauth:changed');
      setMsg($('#authLoginMsg'), '已退出当前会话。', 'warn');
    } catch (error) {
      setMsg($('#authLoginMsg'), error.message || '退出失败', 'error');
    }
  }

  async function refreshIdentity(user) {
    const revision = ++identityRevision;
    const identity = await hydrateIdentity(user, revision);
    if (revision === identityRevision) {
      renderIdentity();
      renderMeta();
    }
    return identity;
  }

  async function fetchMyCharacters(ownerId) {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error('请先登录。');
    const targetId = ownerId ? String(ownerId) : String(user.id);
    if (targetId !== String(user.id)) throw new Error('不能读取其他用户的角色稿件。');
    const sb = await getSupabase();
    const { data, error } = await sb
      .from('characters')
      .select('*')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message || '拉取角色卡失败');
    return data || [];
  }

  async function saveCharacterDraft({ id, name, content, status }) {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error('请先登录。');
    const payload = {
      owner_id: user.id,
      name: name,
      content: content || {},
      status: status || 'draft'
    };
    const sb = await getSupabase();
    let query = sb.from('characters');
    if (id) {
      query = query.update(payload).eq('id', id).eq('owner_id', user.id).select().single();
    } else {
      query = query.insert([payload]).select().single();
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message || '保存失败');
    return data;
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      ensureStatusButton();
      ensureAdminReviewButton();
      ensureModal();
      setClientReady(false);
      const sb = await getSupabase();
      const { data: listener } = sb.auth.onAuthStateChange((_event, session) => {
        const revision = ++identityRevision;
        Promise.resolve().then(() => hydrateIdentity(session && session.user, revision))
          .then(identity => {
            if (revision !== identityRevision) return;
            renderIdentity();
            renderMeta();
            dispatchIdentityEvent('greyauth:changed');
          })
          .catch(error => console.error('[GreyAuth] session identity refresh failed:', error));
      });
      authSubscription = listener && listener.subscription;
      const { data, error } = await sb.auth.getSession();
      if (error) throw new Error('恢复登录会话失败：' + error.message);
      await refreshIdentity(data && data.session ? data.session.user : null);
      dispatchIdentityEvent('greyauth:ready');
      return currentIdentity;
    })();
    try {
      return await initPromise;
    } catch (error) {
      initPromise = null;
      if (error.message === INITIALIZATION_MESSAGE) {
        console.warn('[GreyAuth] initialization is waiting for the Supabase client:', error);
      } else {
        console.error('[GreyAuth] initialization failed:', error);
      }
      setMsg($('#authLoginMsg'), error.message === INITIALIZATION_MESSAGE
        ? INITIALIZATION_MESSAGE
        : '无法恢复登录会话：' + error.message, 'error');
      throw error;
    }
  }

  window.addEventListener('supabase-ready', () => {
    if (!clientReady) {
      init().catch(error => {
        if (error.message !== INITIALIZATION_MESSAGE) {
          console.error('[GreyAuth] initialization after client-ready event failed:', error);
        }
      });
    }
  });

  window.GreyAuth = {
    init: init,
    getIdentity: getIdentity,
    isAuthenticated: function () {
      return !!(currentIdentity.authenticated && currentIdentity.type === 'user');
    },
    getAuthenticatedUser: getAuthenticatedUser,
    openModal: openModal,
    closeModal: closeModal,
    fetchMyCharacters: fetchMyCharacters,
    saveCharacterDraft: saveCharacterDraft,
    refreshIdentity: refreshIdentity,
    destroy: function () {
      if (authSubscription) authSubscription.unsubscribe();
      authSubscription = null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(error => {
      if (error.message === INITIALIZATION_MESSAGE) {
        console.warn('[GreyAuth] client initialization is still pending:', error);
      } else {
        console.error('[GreyAuth] initialization failed:', error);
      }
    }), { once: true });
  } else {
    init().catch(error => {
      if (error.message === INITIALIZATION_MESSAGE) {
        console.warn('[GreyAuth] client initialization is still pending:', error);
      } else {
        console.error('[GreyAuth] initialization failed:', error);
      }
    });
  }
})();
