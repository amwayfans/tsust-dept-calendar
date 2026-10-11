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

  /* ---------- 頭像 ---------- */
  /** HTML 逃逸（頭像與姓名都要經過這道） */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 沒有照片時的替代色：由姓名決定，同一個人永遠同色 */
  function avatarColor(name) {
    var palette = ['#2563EB', '#0891B2', '#059669', '#D97706',
                   '#DC2626', '#7C3AED', '#DB2777', '#475569'];
    var s = String(name || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  /**
   * 圓形頭像。
   * 有 avatar_url 就用照片；沒有（例如系辦助理不在系網師資名單裡）
   * 就用姓名首字加底色 —— 不留空白，也不會出現破圖。
   */
  function avatarHtml(name, url, cls) {
    var n = String(name || '').trim();
    var c = 'avatar' + (cls ? ' ' + cls : '');
    if (url) {
      return '<span class="' + c + '">' +
               '<img src="' + esc(url) + '" alt="' + esc(n) + '" loading="lazy">' +
             '</span>';
    }
    var ch = n ? n.charAt(0) : '?';
    return '<span class="' + c + ' avatar-fallback" style="background:' +
             avatarColor(n) + '" title="' + esc(n) + '">' + esc(ch) + '</span>';
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

  /* ---------- 手機的漢堡選單（各頁共用） ----------
     頁首只留「行事曆／公差/招生記錄」兩個頁籤與登入者頭像，
     其餘功能（管理後台、新增事件…）收進這裡，手機才不會被頁首吃掉半個畫面。 */
  (function () {
    var toggle = document.getElementById('nav-toggle');
    var menu = document.getElementById('nav-menu');
    if (!toggle || !menu) return;

    /* 把桌機版按鈕的狀態複製進選單：
       登入後才出現的項目（＋新增事件）與會變動的文字（管理員登入／管理後台）
       兩邊才不會一個顯示、一個不顯示，或一個寫「管理員登入」一個寫「管理後台」。 */
    function syncFromHeader() {
      [['menu-admin', 'link-admin'], ['menu-add', 'btn-add']].forEach(function (pair) {
        var dst = document.getElementById(pair[0]);
        var src = document.getElementById(pair[1]);
        if (!dst || !src) return;
        dst.hidden = src.hidden;
        var label = (src.textContent || '').trim();
        if (label) dst.textContent = label;
      });
    }

    function open() {
      syncFromHeader();
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close() {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });

    /* 點選單以外的地方、或按 Esc 就收起來 */
    document.addEventListener('click', function (e) {
      if (menu.hidden) return;
      if (toggle.contains(e.target) || menu.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  })();

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
    esc: esc,
    avatarHtml: avatarHtml,
    avatarColor: avatarColor,
    toast: toast,
    isMissingTable: isMissingTable
  };
})();
