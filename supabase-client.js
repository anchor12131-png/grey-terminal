/* supabase-client.js
 * 灰星终端 - Supabase 客户端（含官方 Auth 会话持久化）
 * 依赖：先通过 CDN 引入 @supabase/supabase-js@2
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 */
(function () {
  'use strict';

  // 生产环境建议改为环境注入/构建时替换。
  const SUPABASE_URL = 'https://ehuarcyhoczfrtfkshkc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_51oZG6OnBjFvsonkWHMNHw_MCspzAlK';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[GreySupabase] 未找到 Supabase SDK，请先引入 @supabase/supabase-js@2');
    window.GreySupabase = null;
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  window.GreySupabase = client;
})();
