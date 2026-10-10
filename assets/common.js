/* ============================================================
 * 系所行事曆 — 共用工具
 *   Supabase 連線、時區換算、類別、事件查詢、登入狀態
 * 這個檔案被 index.html 與 admin.html 共用。
 * ============================================================ */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /* ---------- 時區 ----------
   * 台灣沒有日光節約時間（全年固定 UTC+8），所以直接用固定位移換算即可，
   * 不需要引入 date-fns-tz 之類的套件。若未來改成有 DST 的時區，這裡要改。
   */
  var TZ = cfg.TIMEZONE;
  var TZ_OFFSET = '+08:00';

  /** UTC ISO 字串 → 台北時間的 { date:'YYYY-MM-DD', time:'HH:mm' } */
  function tzParts(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    var p = {};
    fmt.formatToParts(d).forEach(function (part) { p[part.type] = part.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
  }

  /** 台北時間的 'YYYY-MM-DD' + 'HH:mm' → UTC ISO 字串 */
  function tzToIso(dateStr, timeStr) {
    var t = /^\d{2}:\d{2}$/.test(timeStr || '') ? timeStr : '00:00';
    return new Date(dateStr + 'T' + t + ':00' + TZ_OFFSET).toISOString();
  }

  /** 'YYYY-MM-DD' → '10/05' */
  function shortDate(dateStr) {
    return dateStr ? dateStr.slice(5).replace('-', '/') : '';
  }

  /** 事件時間的顯示文字 */
  function fmtRange(ev) {
    var s = tzParts(ev.start_at);
    var e = tzParts(ev.end_at);
    if (ev.all_day) {
      if (s.date === e.date) return shortDate(s.date) + '（全天）';
      return shortDate(s.date) + ' – ' + shortDate(e.date) + '（全天）';
    }
    if (s.date === e.date) return shortDate(s.date) + ' ' + s.time + '–' + e.time;
    return shortDate(s.date) + ' ' + s.time + ' – ' + shortDate(e.date) + ' ' + e.time;
  }

  /* ---------- 類別 ---------- */
  function cat(key) {
    return cfg.CATEGORIES[key] || cfg.CATEGORIES.other;
  }

  /* ---------- 事件查詢 ---------- */
  /**
   * 取一段時間範圍內的事件。
   * 用 start_at < 範圍結束 且 end_at >= 範圍開始，才能抓到跨月／跨日事件。
   */
  function fetchEvents(rangeStart, rangeEnd) {
    return sb.from('events')
      .select('*')
      .lt('start_at', rangeEnd.toISOString())
      .gte('end_at', rangeStart.toISOString())
      .order('start_at', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  /* ---------- 登入狀態 ---------- */
  function getSession() {
    return sb.auth.getSession().then(function (r) {
      return (r.data && r.data.session) || null;
    });
  }

  function signIn(email, password) {
    return sb.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data.session;
      });
  }

  function signOut() {
    return sb.auth.signOut();
  }

  /** 目前登入者是否為管理員（前端判斷只用於「顯示按鈕」，真正把關在 RLS） */
  function isAdmin(session) {
    if (!session || !session.user) return false;
    return (session.user.email || '').toLowerCase() === cfg.ADMIN_EMAIL.toLowerCase();
  }

  /**
   * 是否可代輸入教師記錄。
   * 管理員與助理都可以 —— 一律看資料庫的 profiles.role，
   * 不寫死信箱，日後換人只要改資料庫，前端不必動。
   * 前端只用於顯示表單，真正把關在 RLS 的 is_record_manager()。
   */
  function isRecordManager(profile) {
    var r = profile && profile.role;
    return r === 'admin' || r === 'assistant';
  }

  /** 角色顯示名稱 */
  function roleLabel(profile) {
    var r = profile && profile.role;
    if (r === 'admin') return '系辦管理員';
    if (r === 'assistant') return '系辦助理';
    return '教師';
  }

  /**
   * 私有桶的簽章網址（一次問一批，避免逐張打 API）。
   * 回傳 { 路徑: 網址 }。
   */
  function signedUrls(bucket, paths, expiresIn) {
    var uniq = [];
    (paths || []).forEach(function (p) {
      if (p && uniq.indexOf(p) < 0) uniq.push(p);
    });
    if (!uniq.length) return Promise.resolve({});
    return sb.storage.from(bucket)
      .createSignedUrls(uniq, expiresIn || cfg.PHOTO_URL_TTL || 3600)
      .then(function (r) {
        if (r.error) throw r.error;
        var map = {};
        (r.data || []).forEach(function (d) {
          var p = d.path || d.pathname;
          if (p) map[p] = d.signedUrl || d.signedURL || '';
        });
        return map;
      });
  }

  /* ---------- 小工具 ---------- */
  /** 跳出提示訊息 */
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    if (!el) { window.alert(msg); return; }
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' toast-' + kind : '');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  /** 資料表還沒建立時的明確提示（而不是讓畫面空白） */
  function isMissingTable(err) {
    if (!err) return false;
    var code = err.code || '';
    var msg = (err.message || '') + ' ' + (err.details || '');
    return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(msg);
  }

  window.App = {
    cfg: cfg,
    sb: sb,
    tzParts: tzParts,
    tzToIso: tzToIso,
    shortDate: shortDate,
    fmtRange: fmtRange,
    cat: cat,
    fetchEvents: fetchEvents,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    isAdmin: isAdmin,
    isRecordManager: isRecordManager,
    roleLabel: roleLabel,
    signedUrls: signedUrls,
    toast: toast,
    isMissingTable: isMissingTable
  };
})();
