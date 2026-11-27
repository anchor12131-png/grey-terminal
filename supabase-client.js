/* supabase-client.js
 * 灰星终端 - Supabase 客户端（含官方 Auth 会话持久化）
 * 依赖：先通过 CDN 引入 @supabase/supabase-js@2
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://ehuarcyhoczfrtfkshkc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_51oZG6OnBjFvsonkWHMNHw_MCspzAlK';
  let failedSdk = null;
  let initializationError = null;

  if (!window.GreySupabase) window.GreySupabase = null;

  function initializeClient() {
    if (window.GreySupabase) return window.GreySupabase;
    const sdk = window.supabase;
    if (!sdk || typeof sdk.createClient !== 'function' || sdk === failedSdk) return null;

    try {
      window.GreySupabase = sdk.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      initializationError = null;
      window.dispatchEvent(new Event('supabase-ready'));
      return window.GreySupabase;
    } catch (error) {
      failedSdk = sdk;
      initializationError = error;
      console.error('[GreySupabase] Client initialization failed:', error);
      return null;
    }
  }

  window.getGreySupabase = async function (timeoutMs) {
    const timeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 15000;
    const deadline = Date.now() + timeout;
    while (true) {
      const client = initializeClient();
      if (client) return client;
      if (Date.now() >= deadline) {
        const detail = initializationError && initializationError.message
          ? ' ' + initializationError.message
          : '';
        throw new Error('Supabase 客户端加载超时，请检查网络后重试。' + detail);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  initializeClient();
})();
