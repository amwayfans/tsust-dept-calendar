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
  // 助理的判斷不看這裡，一律以資料庫 profiles.role 為準
  //（'admin' 或 'assistant' 都能代輸入教師記錄）。
  ADMIN_EMAIL: 'sr0035@tsust.edu.tw',

  // 記錄照片：存在 Supabase Storage 的私有桶，再由排程同步一份到 Google Drive
  PHOTO_BUCKET: 'record-photos',
  PHOTO_MAX_MB: 5,        // 單張上限（與資料庫的 file_size_limit 一致）
  PHOTO_MAX_PX: 1600,     // 上傳前等比縮到這個邊長（手機照片動輒 4000px）
  PHOTO_QUALITY: 0.82,    // JPEG 壓縮品質
  PHOTO_URL_TTL: 3600,    // 簽章網址有效秒數（私有桶必須簽章才看得到）

  // 事件類別與顏色
  // 每個類別三色一組（參考 Fantastical 的事件卡做法）：
  //   color = 飽和主色 → 左側色條、圖例圓點、清單圓點
  //   tint  = 極淡同色底 → 事件卡的底色（不是整片飽和色，讀起來才不刺眼）
  //   ink   = 深同色字 → 事件標題文字（比純黑柔和，又跟底色同一家族）
  // 這樣一顆事件卡＝「淡底＋左側飽和色條＋深色字」，
  // 一眼就能分辨類別，又不會整片月曆花花綠綠。
  CATEGORIES: {
    meeting:  { label: '會議', color: '#2563EB', tint: '#E8F0FE', ink: '#1E40AF' },
    course:   { label: '課程', color: '#16A34A', tint: '#E6F6EC', ink: '#15803D' },
    exam:     { label: '考試', color: '#7C3AED', tint: '#F1EAFE', ink: '#6D28D9' },
    activity: { label: '活動', color: '#F59E0B', tint: '#FEF3E2', ink: '#B45309' },
    holiday:  { label: '假日', color: '#DC2626', tint: '#FDEAEA', ink: '#B91C1C' },
    other:    { label: '其他', color: '#64748B', tint: '#EEF2F6', ink: '#475569' }
  },

  // 手機版斷點（小於此寬度改用議程列表）
  MOBILE_BREAKPOINT: 768
};
