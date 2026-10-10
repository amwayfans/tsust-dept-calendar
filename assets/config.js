/* ============================================================
 * 系所行事曆 — 前端設定
 * ------------------------------------------------------------
 * 這裡只放「可以公開」的資訊。
 * Supabase 的 publishable / anon key 本來就是設計給前端使用的，
 * 真正的權限控制由資料庫的 RLS 負責：
 *   - 匿名（未登入）：只能「讀取」visibility = department 的事件
 *   - 管理員（登入後）：可以新增 / 編輯 / 刪除
 *
 * ⚠️ service_role key 絕對不可以放在這裡，也不可以進版控。
 * ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xhbbgnsnniphsephwsrq.supabase.co',

  // 由建置腳本填入（此金鑰可公開，權限由 RLS 控制）
  SUPABASE_ANON_KEY: 'sb_publishable_nrWaOOLOr9RJVvkPqh0hoQ_cEGpKPcF',

  // 網站標題（顯示在頁首）
  SITE_TITLE: '機械與自動化工程系 行事曆',
  SITE_SUBTITLE: '系務行程公告',

  // 時區：資料庫存 UTC，畫面一律顯示這個時區
  TIMEZONE: 'Asia/Taipei',

  // 一週起始日：1 = 星期一
  WEEK_STARTS_ON: 1,

  // 管理員信箱（僅用於畫面提示，真正的判斷在資料庫的 is_admin()）
  ADMIN_EMAIL: 'sr0035@tsust.edu.tw',

  // 事件類別與顏色
  CATEGORIES: {
    meeting:  { label: '會議', color: '#2563EB' },
    course:   { label: '課程', color: '#16A34A' },
    exam:     { label: '考試', color: '#DC2626' },
    activity: { label: '活動', color: '#F59E0B' },
    holiday:  { label: '假日', color: '#7C3AED' },
    other:    { label: '其他', color: '#64748B' }
  },

  // 手機版斷點（小於此寬度改用議程列表）
  MOBILE_BREAKPOINT: 768
};
