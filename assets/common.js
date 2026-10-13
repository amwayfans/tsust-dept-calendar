/* ============================================================
 * 系所行事曆 — 共用工具
 *   Supabase 連線、時區換算、類別、事件查詢、登入狀態
 * 這個檔案被 index.html 與 admin.html 共用。
 * ============================================================ */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG;

  /* OAuth 回來時，Supabase 會把 ?code=／?error= 放在網址列，而且很快就會清掉。
     進站第一件事就先記下來，後面才能分辨「剛剛是登入成功」還是「被擋下來」。 */
  var OAUTH_RETURN = location.search + location.hash;

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

  /**
   * 取系上成員名單（姓名、職稱）。
   * 用途：會議事件的說明欄只寫職稱（例如「各系主任（含機自系主任）」），
   * 需要一份「姓名 ↔ 職稱」對照表才能把職稱換成系上人名。
   *
   * 為什麼用 members 而不是 teacher_roster：
   * teacher_roster 有 RLS 擋著，匿名讀不到（會回空陣列）；
   * members 是公開可讀的完整成員名單（含系助理），前端才拿得到。
   */
  function fetchMembers() {
    return sb.from('members')
      .select('name,title,category,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
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

  /* ---------- LINE 登入／綁定 ----------
     Supabase 的 custom provider 識別碼固定是 'custom:line'。

     為什麼一定要先「綁定」：LINE 那端不會給我們老師的學校信箱，
     純用 LINE 登入的話，系統只知道「有個 LINE 使用者來了」，
     不知道他是哪位老師、該給他哪個帳號的權限。
     所以流程是：先用帳密登入一次 → 把 LINE 身分連到這個既有帳號 → 之後才能一鍵登入。 */
  var LINE_PROVIDER = 'custom:line';
  var OAUTH_FLAG = 'ae_oauth_pending';

  /* 回到同一頁。不帶 query／hash，免得把 ?code= 又帶回去變成迴圈。 */
  function oauthRedirectTo() {
    return location.origin + location.pathname;
  }

  /* 用 LINE 登入（只有已綁定過的帳號能用）。
     同樣要注意：signInWithOAuth 失敗時也可能「回傳 { error }」而不 throw，
     所以一樣在這裡轉成 throw。 */
  function signInWithLine() {
    sessionStorage.setItem(OAUTH_FLAG, 'login');
    return sb.auth.signInWithOAuth({
      provider: LINE_PROVIDER,
      options: { redirectTo: oauthRedirectTo() }
    }).then(function (res) {
      if (res && res.error) {
        sessionStorage.removeItem(OAUTH_FLAG);
        throw res.error;
      }
      return res;
    });
  }

  /* 綁定 LINE 到目前登入的帳號。
     ⚠️ 陷阱：linkIdentity 失敗時是「回傳 { data, error }」而不是 throw，
     所以呼叫端用 .catch() 是收不到的 —— 使用者按了鈕只會覺得「卡住、沒反應」。
     這裡統一轉成 throw，讓呼叫端一種寫法就能處理。
     （實際踩過：Supabase 未開 Manual Linking 時回 404 manual_linking_disabled，
       畫面完全不動、沒有任何提示。） */
  function linkLine() {
    sessionStorage.setItem(OAUTH_FLAG, 'link');
    return sb.auth.linkIdentity({
      provider: LINE_PROVIDER,
      options: { redirectTo: oauthRedirectTo() }
    }).then(function (res) {
      if (res && res.error) {
        sessionStorage.removeItem(OAUTH_FLAG);
        throw res.error;
      }
      return res;
    });
  }

  /* 剛剛那次 OAuth 是「登入」還是「綁定」？讀完就清掉，重整不會再觸發一次 */
  function takeOauthIntent() {
    var v = sessionStorage.getItem(OAUTH_FLAG);
    if (v) sessionStorage.removeItem(OAUTH_FLAG);
    return v;
  }

  /* OAuth 回來時網址列有沒有帶錯誤 */
  function oauthReturnError() {
    var s = OAUTH_RETURN || '';
    var m = /[?#&]error=([^&]*)/.exec(s);
    if (!m) return null;
    var d = /[?#&]error_description=([^&]*)/.exec(s);
    return {
      code: decodeURIComponent(m[1]).replace(/\+/g, ' '),
      desc: d ? decodeURIComponent(d[1]).replace(/\+/g, ' ') : ''
    };
  }

  /* 這個帳號綁過 LINE 了嗎（身分清單裡有沒有 custom:line） */
  function hasLineIdentity(user) {
    var ids = (user && user.identities) || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].provider === LINE_PROVIDER) return true;
    }
    return false;
  }

  function getUser() {
    return sb.auth.getUser().then(function (r) {
      return (r.data && r.data.user) || null;
    });
  }

  /* LINE 登入有沒有開啟（provider 建好之前不要讓老師按到壞掉的按鈕） */
  function lineEnabled() {
    return !!cfg.LINE_LOGIN_ENABLED;
  }

  /* 把頁面上所有 LINE 相關的區塊收起來。
     按鈕、分隔線、說明文字要一起收，只收按鈕會留下孤零零一條「或」。 */
  function hideLineUi() {
    ['btn-line-login', 'line-bind', 'line-login-hint'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    var d = document.querySelector('.or-divider');
    if (d) d.hidden = true;
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

  /* ---------- 手勢滑動切換頁籤（行事曆 ⇄ 公差/招生記錄） ----------
     兩個頁面是各自獨立的 HTML 檔，所以「滑動」實作上就是換頁：
     手指往左滑＝去右邊那一頁，往右滑＝回左邊那一頁，
     跟 iOS 分段控制項的直覺一致（不是捲動、也不是切換月份）。

     桌機／筆電沒有 touch 事件，完全不受影響；
     管理後台這類不在頁籤清單裡的頁面也不啟用。 */
  (function () {
    /* ⚠️ 新增頁籤時一定要把檔名加進來，否則那一頁不會有滑動切換。
       順序要跟畫面上的頁籤一致（行事曆 → 公差/招生記錄 → 調查專區 → 教室課表）。 */
    var TABS = ['index.html', 'records.html', 'survey.html', 'rooms.html'];
    var here = location.pathname.split('/').pop() || 'index.html';
    var idx = TABS.indexOf(here);
    if (idx === -1) return;

    var MIN_X = 55;      // 水平位移門檻（px）：太小會誤判成點擊
    var RATIO = 1.5;     // 水平必須明顯大於垂直，才不會跟上下捲動打架
    var MAX_T = 700;     // 手勢最長時間（ms）：慢慢拖曳不算滑動
    var SLIDE = 60;      // 換頁前位移的距離（px）

    var sx = 0, sy = 0, st = 0, tracking = false, done = false;

    /* 手指起點在「可左右捲動」的區塊裡時，讓那個區塊自己捲，不要切頁 */
    function inHScroll(el) {
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4) {
          var ox = getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
      }
      return false;
    }

    /* 開著視窗（新增／詳情／確認框）時不要切頁 */
    function modalOpen() {
      return !!document.querySelector('.modal.show');
    }

    document.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      if (modalOpen() || inHScroll(e.target)) { tracking = false; return; }
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      tracking = true; done = false;
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      if (!tracking || done) return;
      tracking = false;

      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > MAX_T) return;
      if (Math.abs(dx) < MIN_X || Math.abs(dx) < Math.abs(dy) * RATIO) return;

      var next = idx + (dx < 0 ? 1 : -1);      // 往左滑＝下一頁
      if (next < 0 || next >= TABS.length) return;

      done = true;
      document.documentElement.style.overflowX = 'hidden';   // 位移時別冒出橫向捲軸
      document.body.style.transition = 'transform .16s ease, opacity .16s ease';
      document.body.style.transform = 'translateX(' + (dx < 0 ? -SLIDE : SLIDE) + 'px)';
      document.body.style.opacity = '.3';
      setTimeout(function () { location.href = TABS[next]; }, 155);
    }, { passive: true });
  })();

  /* ============================================================
     可收合區塊（手風琴）
     ------------------------------------------------------------
     原則：一進頁面要清爽，先看清單，要看內容再點開。
     所以整區預設「收起來」，點標題才展開。
     用法：HTML 把標題放 .acc-head、其餘內容放 .acc-body，
           再呼叫 App.accordion(卡片元素)。
     ============================================================ */
  function accordion(card) {
    if (!card) return null;
    var head = card.querySelector('.acc-head');
    var body = card.querySelector('.acc-body');
    if (!head || !body) return null;

    var open = false;                                  // 預設收起

    function setOpen(v) {
      open = !!v;
      body.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      card.classList.toggle('acc-open', open);
    }
    function toggle() { setOpen(!open); }

    head.addEventListener('click', toggle);
    head.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggle();
      }
    });

    setOpen(false);
    return { open: function () { setOpen(true); },
             close: function () { setOpen(false); },
             toggle: toggle,
             isOpen: function () { return open; } };
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
    fetchMembers: fetchMembers,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    signInWithLine: signInWithLine,
    linkLine: linkLine,
    takeOauthIntent: takeOauthIntent,
    oauthReturnError: oauthReturnError,
    hasLineIdentity: hasLineIdentity,
    getUser: getUser,
    lineEnabled: lineEnabled,
    hideLineUi: hideLineUi,
    isAdmin: isAdmin,
    isRecordManager: isRecordManager,
    roleLabel: roleLabel,
    signedUrls: signedUrls,
    esc: esc,
    avatarHtml: avatarHtml,
    avatarColor: avatarColor,
    toast: toast,
    isMissingTable: isMissingTable,
    accordion: accordion
  };
})();
