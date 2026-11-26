/* auth.js
 * 灰星终端 - Supabase Auth 认证
 * 依赖：supabase-client.js (window.GreySupabase), auth.css
 */
(function () {
  'use strict';

  const INTERNAL_EMAIL_DOMAIN = 'greystar.internal';
  const LEGACY_EMAIL_DOMAIN = 'accounts.grey-terminal.invalid';
  const LEGACY_STORAGE_KEYS = ['grey_user', 'grey_guest_id', 'current_user_is_admin'];
  const $ = (selector, root) => (root || document).querySelector(selector);
  let modalEl = null;
  let lastFocusEl = null;
  let currentIdentity = {
    type: 'guest',
    ownerId: null,
    label: '游客（未接入）',
    user: null,
    isAdmin: false,
    authenticated: false
  };
  let authSubscription = null;
  let identityRevision = 0;
  let initPromise = null;

  function getSupabase() {
    if (!window.GreySupabase) throw new Error('Supabase 客户端未初始化');
    return window.GreySupabase;
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
    const { data, error } = await getSupabase().auth.getUser();
    if (error) {
      if (error.name === 'AuthSessionMissingError' || error.code === 'session_not_found') return null;
      throw new Error('读取登录会话失败：' + error.message);
    }
    return data && data.user ? data.user : null;
  }

  async function usernameToEmail(username) {
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

  async function requireAuthenticatedSession(expectedUserId, allowAnonymous) {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) throw new Error('确认登录会话失败：' + error.message);
    const sessionUser = data && data.session && data.session.user;
    if (!sessionUser || sessionUser.id !== expectedUserId) {
      throw new Error('认证会话尚未建立，请稍后重试。');
    }
    const isAnonymous = !!(sessionUser.is_anonymous ||
      (sessionUser.app_metadata && sessionUser.app_metadata.provider === 'anonymous'));
    if (isAnonymous && !allowAnonymous) {
      throw new Error('当前仍是游客会话，暂不能访问账号资料。');
    }
    return sessionUser;
  }

  async function getUserProfile(authUser) {
    const { data, error } = await getSupabase()
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
    await requireAuthenticatedSession(authUser.id, false);
    const { data, error } = await getSupabase()
      .from('users')
      .insert([{
        id: authUser.id,
        auth_user_id: authUser.id,
        username: username,
        role: 'player'
      }])
      .select('id, auth_user_id, username, role')
      .single();
    if (error) {
      console.error('[GreyAuth] public.users profile insert failed:', error);
      if (error.code === '23505') {
        const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ');
        if (/auth_user_id/i.test(detail)) {
          const { data: updated, error: updateError } = await getSupabase()
            .from('users')
            .update({ username: username })
            .eq('auth_user_id', authUser.id)
            .select('id, auth_user_id, username, role')
            .single();
          if (updateError) {
            console.error('[GreyAuth] public.users profile update failed:', updateError);
            throw new Error('更新用户资料失败：' + updateError.message);
          }
          return updated;
        }
        if (/username/i.test(detail)) {
          throw new Error('用户名已存在，请更换一个用户名。');
        }
        throw new Error('用户资料发生唯一键冲突：' + (error.message || '请检查 users 表中的 id、auth_user_id 和 username。'));
      }
      throw new Error('创建用户资料失败：' + error.message);
    }
    return data;
  }

  async function hydrateIdentity(authUser, revision) {
    const user = authUser || await getAuthenticatedUser();
    if (revision !== identityRevision) return currentIdentity;
    if (!user) {
      currentIdentity = {
        type: 'guest',
        ownerId: null,
        label: '游客（未接入）',
        user: null,
        isAdmin: false,
        authenticated: false
      };
      return currentIdentity;
    }

    const anonymous = !!(user.is_anonymous || (user.app_metadata && user.app_metadata.provider === 'anonymous'));
    if (anonymous) {
      currentIdentity = {
        type: 'guest',
        ownerId: String(user.id),
        label: '游客',
        user: user,
        role: 'player',
        isAdmin: false,
        authenticated: true
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
      '<span class="auth-value" id="authStatusValue">游客</span>'
    ].join('');
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
      value.textContent = currentIdentity.type === 'user'
        ? (currentIdentity.roleError ? '权限验证失败 - ' : currentIdentity.isAdmin ? '管理员 - ' : '玩家 - ') + currentIdentity.label
        : currentIdentity.label;
    }
    if (reviewButton) reviewButton.hidden = !currentIdentity.isAdmin;
    if (button) {
      button.classList.toggle('is-user', currentIdentity.type === 'user');
      button.classList.toggle('is-admin', currentIdentity.isAdmin);
      button.title = currentIdentity.type === 'user'
        ? '当前身份：' + (currentIdentity.isAdmin ? '管理员 - ' : '玩家 - ') + currentIdentity.label
        : currentIdentity.authenticated ? '当前身份：游客' : '点击接入游客或账号';
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
      +     '<p class="auth-hint">游客稿件可通过注册升级当前匿名身份；登录已有账号不会自动迁移其他匿名会话的数据。</p>'
      +     '<div class="auth-msg" id="authLoginMsg" aria-live="polite"></div>'
      +     '<div class="auth-actions"><button type="submit" class="auth-submit">接入账号</button></div>'
      +   '</form>'
      +   '<form id="authPanelRegister" class="auth-panel" role="tabpanel" aria-labelledby="authTabRegister" hidden novalidate>'
      +     '<div class="auth-field"><label for="authRegisterUsername">账号名</label>'
      +     '<input class="auth-input" id="authRegisterUsername" autocomplete="username" maxlength="32" placeholder="设置账号名（唯一）" /></div>'
      +     '<div class="auth-field"><label for="authRegisterPassword">密码</label>'
      +     '<input class="auth-input" id="authRegisterPassword" type="password" autocomplete="new-password" minlength="6" maxlength="64" placeholder="设置密码（至少 6 位）" /></div>'
      +     '<div class="auth-field"><label for="authRegisterPassword2">确认密码</label>'
      +     '<input class="auth-input" id="authRegisterPassword2" type="password" autocomplete="new-password" minlength="6" maxlength="64" placeholder="再次输入密码" /></div>'
      +     '<p class="auth-hint warn">账号名将映射为不可收信的内部登录地址，不支持邮件找回；请妥善保管密码。</p>'
      +     '<div class="auth-msg" id="authRegisterMsg" aria-live="polite"></div>'
      +     '<div class="auth-actions"><button type="submit" class="auth-submit">建立身份</button></div>'
      +   '</form>'
      +   '<div class="auth-guest-access">'
      +     '<span class="auth-guest-label">或</span>'
      +     '<button type="button" class="auth-secondary" id="authGuestBtn">游客访问</button>'
      +   '</div>'
      +   '<div class="auth-meta" id="authMeta"></div>'
      + '</div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', event => {
      if (event.target && event.target.getAttribute('data-auth-close') === '1') closeModal();
    });
    $('#authModalClose', modalEl).addEventListener('click', closeModal);
    $('#authTabLogin', modalEl).addEventListener('click', () => switchTab('login'));
    $('#authTabRegister', modalEl).addEventListener('click', () => switchTab('register'));
    $('#authGuestBtn', modalEl).addEventListener('click', onGuestAccess);
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
    const button = form.querySelector('.auth-submit');
    if (button) {
      button.disabled = !!busy;
      button.dataset.originalText = button.dataset.originalText || button.textContent;
      button.textContent = busy ? '处理中…' : button.dataset.originalText;
    }
    form.querySelectorAll('input').forEach(input => { input.disabled = !!busy; });
  }

  function openModal() {
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
    } else if (currentIdentity.authenticated) {
      meta.innerHTML = '<strong>游客模式：</strong>Supabase 匿名会话已接入。'
        + '<br><button type="button" class="auth-secondary" id="authLogoutBtn" style="margin-top:10px">结束游客会话</button>';
      $('#authLogoutBtn', meta).addEventListener('click', onLogout);
    } else {
      meta.textContent = '尚未接入。选择游客访问，或使用账号登录/注册。';
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

  async function onGuestAccess() {
    const button = $('#authGuestBtn');
    if (button) { button.disabled = true; button.textContent = '正在接入…'; }
    try {
      const user = await getAuthenticatedUser();
      if (user) {
        await refreshIdentity(user);
      } else {
        const { data, error } = await getSupabase().auth.signInAnonymously();
        if (error) throw new Error('游客接入失败：' + error.message);
        if (!data || !data.user) throw new Error('游客接入失败：Supabase 未返回用户会话。');
        await refreshIdentity(data.user);
      }
      renderMeta();
      dispatchIdentityEvent('greyauth:changed');
      closeModal();
    } catch (error) {
      setMsg($('#authLoginMsg'), error.message || '游客接入失败', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = '游客访问'; }
    }
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
      const sb = getSupabase();
      const email = await usernameToEmail(username);
      const authUser = await getAuthenticatedUser();
      let user;
      let message;

      if (authUser && (authUser.is_anonymous ||
          (authUser.app_metadata && authUser.app_metadata.provider === 'anonymous'))) {
        const { data, error } = await sb.auth.updateUser({
          email: email,
          password: password,
          data: { username: username }
        });
        if (error) {
          console.error('[GreyAuth] Anonymous account upgrade failed:', error);
          if (/already|exists|registered|duplicate/i.test(error.message || '')) {
            throw new Error('该账号名已被占用。游客身份和现有稿件仍保留，请更换账号名后重试。');
          }
          throw new Error('游客账号升级失败：' + error.message);
        }
        user = data.user;
        if (!user || !user.id) throw new Error('账号升级失败：Supabase 未返回用户。');
        await requireAuthenticatedSession(user.id, false);
        await persistProfile(user, username);
        message = '游客身份已升级为正式账号，原有角色卡沿用当前 Auth ID。';
      } else {
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
        user = data && data.user;
        if (!user) throw new Error('注册失败：Supabase 未返回用户。');
        if (!data.session) {
          throw new Error('Supabase 尚未建立登录会话。请关闭邮箱确认后再注册，或完成邮箱确认后登录。');
        }
        await requireAuthenticatedSession(user.id, false);
        await persistProfile(user, username);
        message = '账号注册成功。';
      }

      await refreshIdentity(user);
      renderMeta();
      dispatchIdentityEvent('greyauth:changed');
      setMsg(msg, message, 'ok');
      setTimeout(closeModal, 900);
    } catch (error) {
      console.error('[GreyAuth] Registration flow failed:', error);
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
      const emails = [
        await usernameToEmail(username),
        await legacyUsernameToEmail(username)
      ];
      let data = null;
      let error = null;
      for (const email of emails) {
        const result = await getSupabase().auth.signInWithPassword({ email: email, password: password });
        data = result.data;
        error = result.error;
        if (!error) break;
      }
      if (error) {
        console.error('[GreyAuth] Supabase signInWithPassword failed:', error);
        throw new Error('账号或密码错误：' + error.message);
      }
      if (!data || !data.user) throw new Error('登录失败：Supabase 未返回用户。');

      await requireAuthenticatedSession(data.user.id, false);
      const identity = await refreshIdentity(data.user);
      renderMeta();
      dispatchIdentityEvent('greyauth:changed');
      if (identity.roleError) {
        setMsg(msg, '账号已登录，但读取用户角色失败；为安全起见暂按普通玩家处理。' + identity.roleError, 'warn');
      } else if (identity.profileMissing) {
        setMsg(msg, '账号已登录，但 users 表中没有对应资料；当前按普通玩家权限显示。', 'warn');
      } else {
        setMsg(msg, identity.isAdmin ? '管理员身份接入成功。' : '登录成功。', 'ok');
      }
      setTimeout(closeModal, 800);
    } catch (error) {
      console.error('[GreyAuth] Login flow failed:', error);
      setMsg(msg, error.message || '登录失败', 'error');
    } finally {
      setBusy(form, false);
    }
  }

  async function onLogout() {
    try {
      const { error } = await getSupabase().auth.signOut();
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
    if (!user) throw new Error('请先接入账号或游客会话。');
    const targetId = ownerId ? String(ownerId) : String(user.id);
    if (targetId !== String(user.id)) throw new Error('不能读取其他用户的角色稿件。');
    const { data, error } = await getSupabase()
      .from('characters')
      .select('*')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message || '拉取角色卡失败');
    return data || [];
  }

  async function saveCharacterDraft({ id, name, content, status }) {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error('请先接入账号或游客会话。');
    const payload = {
      owner_id: user.id,
      name: name,
      content: content || {},
      status: status || 'draft'
    };
    let query = getSupabase().from('characters');
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
      LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
      ensureStatusButton();
      ensureAdminReviewButton();
      ensureModal();
      const sb = getSupabase();
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
      console.error('[GreyAuth] initialization failed:', error);
      throw error;
    }
  }

  window.GreyAuth = {
    init: init,
    getIdentity: getIdentity,
    getAuthenticatedUser: getAuthenticatedUser,
    openModal: openModal,
    closeModal: closeModal,
    fetchMyCharacters: fetchMyCharacters,
    saveCharacterDraft: saveCharacterDraft,
    refreshIdentity: refreshIdentity,
    signInAnonymously: onGuestAccess,
    destroy: function () {
      if (authSubscription) authSubscription.unsubscribe();
      authSubscription = null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(error => {
      console.error('[GreyAuth] initialization failed:', error);
    }), { once: true });
  } else {
    init().catch(error => console.error('[GreyAuth] initialization failed:', error));
  }
})();
