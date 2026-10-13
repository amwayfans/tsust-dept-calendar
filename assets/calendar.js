/* ============================================================
 * 公開月曆頁（index.html）
 * 免登入即可查看；管理員登入後才會出現「新增事件」按鈕，
 * 也可以在月曆的日期上連點兩下直接叫出新增視窗。
 * ============================================================ */
(function () {
  'use strict';
  var A = window.App;
  if (!A) {
    /* common.js 沒載入成功（最常見是新舊快取混搭）→ 直接把骨架收掉並說明。
       不這樣做的話，下面取 A.cfg 會丟例外，使用者只看到一片灰條。 */
    var _l = document.getElementById('loading'), _e = document.getElementById('error');
    if (_l) _l.hidden = true;
    if (_e) { _e.hidden = false; _e.textContent = '頁面資源載入不完整，請重新整理。'; }
    return;
  }
  var cfg = A.cfg;

  var elCal = document.getElementById('calendar');
  var elLabel = document.getElementById('month-label');
  var elLoading = document.getElementById('loading');
  var elEmpty = document.getElementById('empty');
  var elError = document.getElementById('error');
  var btnAdd = document.getElementById('btn-add');
  var btnView = document.getElementById('btn-view');
  var linkAdmin = document.getElementById('link-admin');
  var menuAdmin = document.getElementById('menu-admin');
  var badge = document.getElementById('admin-badge');
  var elWhoChip = document.getElementById('who-chip');

  /* ---------- 載入保險（避免骨架永遠卡住） ----------
     只要初始化過程中任何一步丟出例外，後面的 calendar.render() 就不會執行，
     載入骨架（#loading）會永遠蓋在畫面上 —— 使用者只看到一片灰條，
     完全不知道發生什麼事，只能一直重新整理。
     （實際發生過：部署途中開頁面，拿到新舊混搭的 JS，
       calendar.js 呼叫到舊 common.js 沒有的方法，整個初始化中斷。）

     兩道保險：
       1. window error 攔截：初始化期間任何未捕捉的例外 → 立刻收掉骨架並說明
       2. 逾時保險：12 秒還沒 render 完成（例如某個請求卡住）→ 一樣收掉並說明
     月曆一旦成功 render（rendered = true），兩道保險都不再作用。 */
  var rendered = false;
  var failsafe = setTimeout(function () {
    bailOut('月曆載入逾時，請重新整理頁面。');
  }, 12000);

  function bailOut(msg) {
    if (rendered) return;
    rendered = true;                 /* 避免兩道保險互相蓋訊息 */
    clearTimeout(failsafe);
    elLoading.hidden = true;
    elError.hidden = false;
    elError.innerHTML = msg +
      '<br><span style="font-size:13px">重新整理即可；若持續發生請洽系辦（分機 2102）。</span>';
  }

  window.addEventListener('error', function () {
    bailOut('月曆載入失敗，請重新整理頁面。');
  });

  document.getElementById('site-title').textContent = cfg.SITE_TITLE;
  document.getElementById('site-subtitle').textContent = cfg.SITE_SUBTITLE;
  document.title = cfg.SITE_TITLE;

  /* 目前登入者（null = 未登入）。雙擊新增事件時要用它判斷權限。 */
  var session = null;

  /* 圖例 */
  var lg = document.getElementById('legend');
  Object.keys(cfg.CATEGORIES).forEach(function (k) {
    var c = cfg.CATEGORIES[k];
    var s = document.createElement('span');
    s.innerHTML = '<i style="background:' + c.color + '"></i>' + c.label;
    lg.appendChild(s);
  });

  /* ---------- 日期小工具 ---------- */
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** 'YYYY-MM-DD' → '日一二三四五六'（用 UTC 算，不受瀏覽器時區影響） */
  function weekdayOf(dateStr) {
    return '日一二三四五六'.charAt(new Date(dateStr + 'T00:00:00Z').getUTCDay());
  }

  /** 'YYYY-MM-DD' → '10/11（六）' */
  function dateLabel(dateStr) {
    return A.shortDate(dateStr) + '（' + weekdayOf(dateStr) + '）';
  }

  /* 「今天」一律以台北日期為準（A.tzParts）。
     不要用瀏覽器當地日期：筆電時區沒調好（或使用者出國）時，
     畫面各處會互相打臉。 */
  function todayStr() { return A.tzParts(new Date().toISOString()).date; }

  /** FullCalendar 傳進來的 Date → 那一格代表的日期字串 'YYYY-MM-DD' */
  function cellDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' +
           (day < 10 ? '0' : '') + day;
  }

  /* ============================================================
   * 一、今日行程欄位（取代原本的四格統計列）
   * ============================================================ */
  var elToday = document.getElementById('today-panel');
  var elTodayBody = document.getElementById('today-body');
  var elTodayCount = document.getElementById('today-count');

  /* 「N 項行程」徽章。0 筆時不顯示 —— 空狀態已經有一行字了，
     再掛一個「0 項」只是多一句廢話。 */
  function setTodayCount(n) {
    if (!elTodayCount) return;
    elTodayCount.hidden = !n;
    elTodayCount.textContent = n ? n + ' 項行程' : '';
  }

  /* ---------- 系上參加人員 ----------
     會議事件的說明欄常寫「出席：副校長、教務長、各系主任（含機自系主任）…」，
     這裡只挑出「系上的人」，外部單位（副校長、教務長、校外委員）不列。

     兩種命中方式：
       1. 直接是名冊上的姓名（有些開會通知直接列名字，例如課程咨詢委員會）
       2. 是系上的職稱 → 用 TITLE_MAP 換成人名（例如「各系主任（含機自系主任）」）
     對不到的一律略過，不猜。

     名冊用 members（公開可讀）而不是 teacher_roster（RLS 擋住，匿名讀不到）。 */
  var MEMBERS = [];
  /* 這裡刻意寫得防禦性一點：這是「附加資訊」，不該讓它拖垮整個月曆。
     如果 common.js 是舊版（還沒有 fetchMembers）而 calendar.js 是新版，
     直接呼叫會丟 TypeError，整個 IIFE 中斷 → 月曆永遠不 render、骨架卡住。 */
  var membersReady = Promise.resolve();
  try {
    if (typeof A.fetchMembers === 'function') {
      membersReady = A.fetchMembers()
        .then(function (rows) { MEMBERS = rows.map(function (m) { return m.name; }); })
        .catch(function () { MEMBERS = []; });
    }
  } catch (e) { MEMBERS = []; }

  var TITLE_MAP = [
    ['系主任', '楊至誠'],        /* 含「各系主任（含機自系主任）」「本系主任」 */
    ['工程學院院長', '楊至誠']
  ];

  /* ---------- 從說明欄把「出席人員」抽出來（顯示用）----------
     新的事件會把名單放在獨立的 attendees 欄位；舊事件的名單還埋在說明裡，
     這裡負責把它們撈出來單獨顯示，讓說明欄乾淨好讀。

     與 supabase/extract_attendees.py 用同一套規則（標籤／停止字），
     但這裡**唯讀**：只影響畫面，不改資料。 */
  var ATT_LABELS = ['列席人員', '出席人員', '與會人員', '參加人員', '主持人', '出席', '列席', '主席', '委員'];
  var ATT_STOPS = ['來源', '討論議題', '討論事項', '聯絡', '開會事由', '提案', '備註', '議題',
                   '說明', '附件', '開會通知', '時間', '地點'];
  var ATT_EXCEPTIONS = { '提案': ['單位'] };
  var ATT_ORDER = ['主持人', '主席', '出席', '出席人員', '與會人員', '參加人員', '委員', '列席', '列席人員'];

  function extractAttendees(desc) {
    if (!desc) return '';
    var text = String(desc).replace(/\u3000/g, ' ');
    var hits = [], taken = [];
    ATT_LABELS.forEach(function (label) {
      var re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[：:]', 'g'), m;
      while ((m = re.exec(text)) !== null) {
        var s = m.index;
        if (taken.some(function (t) { return s >= t[0] && s < t[1]; })) continue;
        var e = text.length, nl = text.indexOf('\n\n', m.index + m[0].length);
        if (nl !== -1) e = Math.min(e, nl);
        (ATT_LABELS.concat(ATT_STOPS)).forEach(function (other) {
          var re2 = new RegExp(other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[：:]?', 'g'), m2;
          re2.lastIndex = m.index + m[0].length;
          while ((m2 = re2.exec(text)) !== null) {
            var pos = m2.index;
            var tail = text.substr(pos + other.length, 4);
            if ((ATT_EXCEPTIONS[other] || []).some(function (x) { return tail.indexOf(x) === 0; })) continue;
            if (text.substr(pos + other.length, 1) !== '：' &&
                text.substr(pos + other.length, 1) !== ':') continue;
            e = Math.min(e, pos);
            break;
          }
        });
        if (e <= m.index + m[0].length) continue;
        taken.push([s, e]);
        var val = text.slice(m.index + m[0].length, e).replace(/\s*\n\s*/g, ' ')
                    .replace(/\s{2,}/g, ' ').replace(/^[ 。，、;；]+|[ 。，、;；]+$/g, '');
        if (val) hits.push([label, val]);
      }
    });
    if (!hits.length) return '';
    hits.sort(function (a, b) {
      var ia = ATT_ORDER.indexOf(a[0]), ib = ATT_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return hits.map(function (h) { return h[0] + '：' + h[1]; }).join('\n');
  }

  /* 把說明拆成「出席人員」與「剩下的說明」。
     使用者要的是：名單單獨一列，說明欄只留事由／議題／來源。

     與 supabase/extract_attendees.py 同一套規則（含「剩下太短就不要拆」），
     所以畫面上看到的、跟之後資料搬移的結果會一致。 */
  function splitAttendees(desc) {
    if (!desc) return { attendees: '', rest: desc || '' };
    var att = extractAttendees(desc);
    if (!att) return { attendees: '', rest: desc };

    /* 逐段移除名單：找出每一段「標籤：值」的起訖，再從後往前刪。
       這裡用與 extractAttendees 相同的掃描，確保兩者一致。 */
    var text = String(desc).replace(/\u3000/g, ' ');
    var spans = [];
    ATT_LABELS.forEach(function (label) {
      var re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[：:]', 'g'), m;
      while ((m = re.exec(text)) !== null) {
        var s = m.index;
        if (spans.some(function (t) { return s >= t[0] && s < t[1]; })) continue;
        var e = text.length, nl = text.indexOf('\n\n', m.index + m[0].length);
        if (nl !== -1) e = Math.min(e, nl);
        (ATT_LABELS.concat(ATT_STOPS)).forEach(function (other) {
          var re2 = new RegExp(other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[：:]?', 'g'), m2;
          re2.lastIndex = m.index + m[0].length;
          while ((m2 = re2.exec(text)) !== null) {
            var pos = m2.index;
            var tail = text.substr(pos + other.length, 4);
            if ((ATT_EXCEPTIONS[other] || []).some(function (x) { return tail.indexOf(x) === 0; })) continue;
            if (text.substr(pos + other.length, 1) !== '：' &&
                text.substr(pos + other.length, 1) !== ':') continue;
            e = Math.min(e, pos);
            break;
          }
        });
        if (e <= m.index + m[0].length) continue;
        spans.push([s, e]);
      }
    });

    var rest = String(desc);
    spans.sort(function (a, b) { return b[0] - a[0]; }).forEach(function (sp) {
      rest = rest.slice(0, sp[0]) + rest.slice(sp[1]);
    });
    rest = rest.replace(/\u3000/g, ' ').replace(/[ \t]{2,}/g, ' ')
               .replace(/\n{3,}/g, '\n\n').trim();

    /* 剩下的太少＝整段本來就只是名單 → 不要拆，維持原樣最安全 */
    if (rest.length < 20) return { attendees: '', rest: desc };
    return { attendees: att, rest: rest };
  }

  /* 事件要顯示的出席人員：以獨立欄位為主，沒有才回頭從說明撈 */
  function attendeesOf(r) {
    if (!r) return '';
    if (r.attendees && String(r.attendees).trim()) return String(r.attendees).trim();
    return splitAttendees(r.description).attendees;
  }

  /* 說明欄要顯示的內容：若名單是從說明撈出來的，就把它從說明拿掉 */
  function descWithoutAttendees(r) {
    if (!r) return '';
    if (r.attendees && String(r.attendees).trim()) return r.description || '';
    return splitAttendees(r.description).rest;
  }

  /* 出席名單的來源：新欄位優先，沒有才從說明撈。
     逐行找（主持人／委員／列席人員…都可能是本系的人），
     不再只認第一個「出席：」——院務會議的本系委員寫在「委員：」那行。 */
  var ATT_LINE_RE = /(?:列席人員|出席人員|與會人員|參加人員|主持人|出席|列席|委員)[：:](.*)$/;

  function deptAttendees(r) {
    var src = attendeesOf(r);
    if (!src) return [];
    var out = [];
    src.split('\n').forEach(function (line) {
      var m = ATT_LINE_RE.exec(line);
      if (!m) return;
      (m[1] || '').split(/[、,，;；\/]/).forEach(function (raw) {
        var seg = raw.trim();
        if (!seg) return;
        var hit = MEMBERS.filter(function (n) { return seg.indexOf(n) >= 0; });
        if (!hit.length) {
          hit = TITLE_MAP.filter(function (t) { return seg.indexOf(t[0]) >= 0; })
                         .map(function (t) { return t[1]; });
        }
        hit.forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
      });
    });
    return out;
  }

  function loadToday() {
    var t = todayStr();
    document.getElementById('today-date').textContent = dateLabel(t);

    /* 等名冊載入再渲染，否則「系上參加人員」會因為名冊還沒到而空白 */
    Promise.all([
      A.fetchEvents(new Date(t + 'T00:00:00+08:00'),
                    new Date(t + 'T23:59:59+08:00')),
      membersReady
    ])
      .then(function (out) { renderToday(out[0]); })
      .catch(function () {
        /* 今日行程只是輔助資訊，查不到就顯示「無行程」，不干擾月曆 */
        elTodayBody.innerHTML = '<p class="today-none">目前無法讀取今日行程。</p>';
        setTodayCount(0);
        elToday.hidden = false;
      });
  }

  function renderToday(rows) {
    elTodayBody.innerHTML = '';
    setTodayCount(rows.length);

    if (!rows.length) {
      elTodayBody.innerHTML =
        '<p class="today-none">今天沒有安排行程。</p>';
      elToday.hidden = false;
      /* 沒有行程時，這行字就是整個欄位唯一的內容，
         一樣讓它呼吸 —— 否則整塊面板會靜得像壞掉。 */
      breatheToday();
      return;
    }

    rows.forEach(function (r) {
      var c = A.cat(r.category);
      var item = document.createElement('div');
      item.className = 'today-item';
      item.style.setProperty('--ev-accent', c.color);

      var time = document.createElement('span');
      time.className = 'today-item-time';
      time.textContent = r.all_day ? '全天' : A.tzParts(r.start_at).time;

      var title = document.createElement('span');
      title.className = 'today-item-title';
      title.textContent = r.title;

      item.appendChild(time);
      item.appendChild(title);

      if (r.location) {
        var loc = document.createElement('span');
        loc.className = 'today-item-loc';
        loc.textContent = r.location;
        item.appendChild(loc);
      }

      /* 系上參加人員（從說明欄的「出席」解析，只列本系的人）。
         解析不到就不顯示，不要留一行空標籤。 */
      var who = deptAttendees(r);
      if (who.length) {
        var people = document.createElement('span');
        people.className = 'today-item-people';
        people.textContent = '系上參加：' + who.join('、');
        item.appendChild(people);
      }

      elTodayBody.appendChild(item);
    });

    elToday.hidden = false;
    breatheToday();
  }

  /* 呼吸字：讓今天每一筆行程的標題「一明一暗」慢慢起伏，
     眼睛自然會被拉過去。
     兩道防線：GSAP 沒載入成功、或系統設定了「減少動態」→ 直接不跑，
     文字維持全不透明（CSS 的預設值），不會變成一團看不到的字。 */
  function breatheToday() {
    if (typeof window.gsap === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* 今天有行程 → 呼吸每一筆的標題；
       今天沒行程 → 呼吸「今天沒有安排行程。」那行字。
       兩者用同一段動畫，看起來才像同一個系統。 */
    var titles = elTodayBody.querySelectorAll('.today-item-title, .today-none');
    if (!titles.length) return;

    window.gsap.killTweensOf(titles);
    window.gsap.fromTo(titles,
      { opacity: 1, textShadow: '0 0 0 rgba(30,58,95,0)' },
      {
        opacity: .48,
        textShadow: '0 0 16px rgba(30,58,95,.38)',
        duration: 1.5, repeat: -1, yoyo: true, ease: 'sine.inOut',
        stagger: .18
      });
  }

  /* ============================================================
   * 二、過去的事件反灰
   * ============================================================ */
  /** 這筆行程是否已經結束（用台北日期比，當天一律算「還沒過去」）。
   *  只比到「日」為止：今天稍早結束的行程仍然算今天，不反灰 ——
   *  它同時也是「今日行程」欄位要突顯的對象，反灰會互相打架。 */
  function isPast(r) {
    if (!r) return false;
    return A.tzParts(r.end_at).date < todayStr();
  }

  /* ============================================================
   * 三、月曆
   * ============================================================ */
  function isMobile() { return window.innerWidth < cfg.MOBILE_BREAKPOINT; }

  function showError(err) {
    rendered = true;                 /* 已有明確錯誤畫面，逾時保險不用再插手 */
    clearTimeout(failsafe);
    elLoading.hidden = true;
    elError.hidden = false;
    if (A.isMissingTable(err)) {
      elError.innerHTML = '資料表尚未建立。<br>請先在 Supabase 執行 <code>supabase/migration.sql</code>。';
    } else {
      elError.innerHTML = '載入失敗，請稍後再試。' +
        '<br><code>' + String(err.message || err) + '</code>';
    }
  }

  /* 把資料庫的一列轉成 FullCalendar 事件。
     顏色採 Fantastical 式的事件卡：
       底色 = 極淡的同色 tint、文字 = 深同色 ink，
       左側飽和色條由 CSS 的 ::before 畫（見 styles.css）。 */
  function toFcEvent(r) {
    var c = A.cat(r.category);
    var ev = {
      id: r.id,
      title: r.title,
      backgroundColor: c.tint || c.color,
      borderColor: c.tint || c.color,
      textColor: c.ink || '#ffffff',
      extendedProps: { row: r }
    };
    if (r.all_day) {
      /* 全天事件：用日期字串，且 FullCalendar 的 end 是「不含」，
         所以要往後加一天，否則跨日全天事件會少顯示一天。 */
      ev.allDay = true;
      ev.start = A.tzParts(r.start_at).date;
      ev.end = addDays(A.tzParts(r.end_at).date, 1);
    } else {
      ev.allDay = false;
      ev.start = r.start_at;
      ev.end = r.end_at;
    }
    return ev;
  }

  /** 這筆行程是不是「連續多日」的長條（橫跨好幾天） */
  function isMultiDay(r) {
    if (!r) return false;
    return A.tzParts(r.start_at).date !== A.tzParts(r.end_at).date;
  }

  /* 日期格的 class。
     只標「今天」，不標「本週」——
     使用者指定本週格子不要有底色（原本整列淡藍底太干擾），
     所以 fc-day-is-week 已移除，currentWeekRange() 一併刪除。 */
  function weekClass(arg) {
    var d = cellDate(arg.date);
    /* 自己標「今天」而不是靠 FullCalendar 的 fc-day-today：
       後者依瀏覽器時區，會跟今日行程欄位差一天 */
    return d === todayStr() ? ['fc-day-is-tpe'] : [];
  }

  /* ---------- 今天那一格的行程動畫（GSAP） ----------
     先由小放大進場，再輕輕呼吸光暈。
     跟上面的呼吸字一樣：GSAP 沒載入或「減少動態」就整段略過。

     只挑「單日」事件：連續多日的長條（.fc-event-multiday）不參與，
     因為整條長條一起發光比單日事件搶眼太多，使用者指定不要凸顯它。 */
  function animateToday() {
    if (typeof window.gsap === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var cell = elCal.querySelector('td[data-date="' + todayStr() + '"]');
    if (!cell) return;
    var els = cell.querySelectorAll('.fc-event:not(.fc-event-multiday)');
    if (!els.length) return;

    /* 換月或重新整理時要先把上一輪的補間清掉，
       否則事件會卡在動畫中途的狀態（縮小、半透明）。 */
    window.gsap.killTweensOf(els);
    Array.prototype.forEach.call(els, function (el) { el.style.boxShadow = ''; });

    window.gsap.fromTo(els,
      { scale: .78, opacity: 0, y: -8 },
      {
        scale: 1, opacity: 1, y: 0,
        duration: .5, ease: 'back.out(1.7)', stagger: .07,
        clearProps: 'transform',
        onComplete: function () {
          window.gsap.to(els, {
            boxShadow: '0 0 0 3px rgba(30, 58, 95, .32)',
            duration: 1.15, repeat: -1, yoyo: true,
            ease: 'sine.inOut', stagger: .12
          });
        }
      });
  }

  var calendar = new FullCalendar.Calendar(elCal, {
    /* 一律用月曆當預設檢視。
       先前手機（< MOBILE_BREAKPOINT）預設用 listMonth 列表，
       但使用者指定「預設要看月曆」，所以行動裝置也從月曆開始。
       列表仍可透過工具列的「切換列表」按鈕進入。 */
    initialView: 'dayGridMonth',
    locale: 'zh-tw',
    firstDay: cfg.WEEK_STARTS_ON,
    headerToolbar: false,          /* 用自製的工具列 */
    height: 'auto',
    dayMaxEventRows: 4,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    noEventsText: '本月尚無行程',
    /* 列表檢視的全天行程原本顯示英文 "all-day"（FullCalendar 的預設值，
       連 zh-tw 語系檔也沒覆蓋），這裡明確改成中文。 */
    allDayText: '全天',

    /* 本週整列淡底色、今天再加一圈外框（見 styles.css） */
    dayCellClassNames: weekClass,

    /* 月曆格子的日期：zh-tw 語系給的是「1日」「28日」，
       那個「日」字在格子裡會自己折成第二行，白白吃掉一格高度。
       只留數字就好。
       只影響月曆格；列表檢視的完整日期（2026年10月7日）與
       表頭的星期（週一…週日）都不動。 */
    dayCellContent: function (arg) {
      return arg.dayNumberText.replace(/日$/, '');
    },

    events: function (info, success, failure) {
      A.fetchEvents(info.start, info.end).then(function (rows) {
        rendered = true;             /* 月曆已成功渲染，關掉逾時保險 */
        clearTimeout(failsafe);
        elLoading.hidden = true;
        elEmpty.hidden = rows.length > 0;
        elError.hidden = true;
        success(rows.map(toFcEvent));
      }).catch(function (err) {
        showError(err);
        failure(err);
      });
    },

    datesSet: function (info) {
      elLabel.textContent = info.view.currentStart.getFullYear() + ' 年 ' +
                            (info.view.currentStart.getMonth() + 1) + ' 月';
      btnView.hidden = !isMobile();
      btnView.textContent = (info.view.type === 'listMonth') ? '切換月曆' : '切換列表';
      window.requestAnimationFrame(function () { window.setTimeout(animateToday, 60); });
    },

    eventClick: function (info) {
      openDetail(info.event.extendedProps.row);
    },

    /* 事件進到 DOM 之後才跑動畫。
       用 eventsSet 而不是 eventDidMount：前者是「這一批都渲染完了」，
       這時才抓得到今天那格裡的全部事件，也才能一起做 stagger。 */
    eventsSet: function () {
      window.requestAnimationFrame(function () { window.setTimeout(animateToday, 60); });
    },

    /* 格子很窄，標題一定會被截斷（加刪節號）。
       被截斷就等於資訊看不到，所以一定要掛 title 讓滑鼠移上去能讀全名。 */
    eventDidMount: function (info) {
      var r = info.event.extendedProps.row || {};
      var c = A.cat(r.category);

      /* 左側飽和色條的顏色。用 CSS 變數傳給 ::before，
         不必為六個類別各寫一條規則，也不會被 FullCalendar 的行內樣式蓋掉。 */
      info.el.style.setProperty('--ev-accent', c.color);

      /* 事件文字顏色。
         有底色的整塊事件，FullCalendar 會把 textColor 設在標題元素上；
         但「有時段」的行程在月檢視是一顆小圓點，沒有底色，
         標題就只會繼承 .fc-event（＝<a>）的連結藍，跟類別無關。
         這裡直接把 ink 色補在事件元素上，兩種型態都一致。
         整塊事件的標題有自己的行內色，不受影響。 */
      if (c.ink) info.el.style.color = c.ink;

      var tip = [A.fmtRange(r), r.title].filter(Boolean).join('　');
      if (r.location) tip += '（' + r.location + '）';
      var t = info.el.querySelector('.fc-event-title') || info.el;
      t.setAttribute('title', tip);

      /* 過去的事件反灰（見 styles.css）。
         用 class 而不是直接改樣式，才能一眼看出是哪條規則在作用。 */
      if (isPast(r)) info.el.classList.add('fc-event-past');

      /* 連續多日的長條事件標記起來（見 styles.css / animateToday）。
         這種橫跨好幾天的長條不參與「今天」的呼吸凸顯 ——
         整條長條發光比單日事件搶眼得多，使用者指定不要特別凸顯它。 */
      if (isMultiDay(r)) info.el.classList.add('fc-event-multiday');
    }
  });

  calendar.render();

  /* ---------- 雙擊日期 → 新增事件 ----------
     用瀏覽器原生的 dblclick，不要用 FullCalendar 的 dateClick：
     1. dateClick 走的是 FullCalendar 自家的指標事件層（PointerDragging），
        對合成事件沒有反應，自動化測試驅動不了、也難驗證。
     2. 原生 dblclick 的「連點兩下」判定交給作業系統，
        會跟著使用者的「雙擊速度」系統設定走，
        不必自己寫死「400ms 內第二次」這種門檻（手慢的人會被判成兩次單擊）。
     3. 掛在整個月曆容器上（事件代理），月曆重繪也不用重新綁。 */
  document.getElementById('calendar').addEventListener('dblclick', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* 雙擊在事件卡上＝想看這筆的詳細內容，不該跳出「新增」視窗 */
    if (t.closest('.fc-event')) return;

    /* 只認日期格。點到表頭、工具列或「+N more」都不算。 */
    var cell = t.closest('.fc-daygrid-day[data-date]');
    if (!cell) return;

    var dateStr = cell.getAttribute('data-date');
    if (!dateStr) return;

    /* 連點兩下預設會選取格子裡的文字，這裡把它擋掉 */
    e.preventDefault();
    openAddModal(dateStr);
  });

  /* ---------- 事件詳情 ---------- */
  /* 目前詳情視窗顯示的是哪一筆。修改／刪除都從這裡取資料。 */
  var detailRow = null;

  function openDetail(r) {
    detailRow = r;

    document.getElementById('m-title').textContent = r.title;
    document.getElementById('m-time').textContent = A.fmtRange(r);
    document.getElementById('m-cat').textContent = A.cat(r.category).label;

    var locWrap = document.getElementById('m-loc-wrap');
    if (r.location) {
      document.getElementById('m-loc').textContent = r.location;
      locWrap.hidden = false;
    } else { locWrap.hidden = true; }

    /* 出席人員單獨一列（不再擠在說明裡）。
       新事件讀 attendees 欄位；舊事件還沒補資料時，即時從說明撈出來顯示。 */
    var attWrap = document.getElementById('m-att-wrap');
    var attText = attendeesOf(r);
    if (attText) {
      var attEl = document.getElementById('m-att');
      attEl.textContent = '';
      attText.split('\n').forEach(function (line, i) {
        if (i) attEl.appendChild(document.createElement('br'));
        attEl.appendChild(document.createTextNode(line));
      });
      attWrap.hidden = false;
    } else { attWrap.hidden = true; }

    var descWrap = document.getElementById('m-desc-wrap');
    var descText = descWithoutAttendees(r);   /* 名單已移到上面那一列 */
    if (descText) {
      document.getElementById('m-desc').textContent = descText;
      descWrap.hidden = false;
    } else { descWrap.hidden = true; }

    /* 修改／刪除只給管理員看。
       不是管理員就算按了也寫不進去（RLS 會擋），
       與其讓他填完一輪才失敗，不如一開始就不要出現這顆鈕。 */
    var canEdit = A.isAdmin(session);
    document.getElementById('m-edit').hidden = !canEdit;
    document.getElementById('m-delete').hidden = !canEdit;

    document.getElementById('modal').classList.add('show');
  }

  function closeDetail() {
    document.getElementById('modal').classList.remove('show');
  }

  document.getElementById('m-close').addEventListener('click', closeDetail);
  document.getElementById('modal').addEventListener('click', function (e) {
    if (e.target === this) closeDetail();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeDetail();
    closeAddModal();
    closeDelModal();
  });

  /* 修改：關掉詳情，改用同一個表單（欄位帶入原本的值） */
  document.getElementById('m-edit').addEventListener('click', function () {
    var r = detailRow;
    closeDetail();
    if (r) openEditModal(r);
  });

  /* 刪除：先跳確認，不直接刪 */
  document.getElementById('m-delete').addEventListener('click', function () {
    var r = detailRow;
    closeDetail();
    if (r) openDelModal(r);
  });

  /* ============================================================
   * 四、新增事件視窗（雙擊日期後打開）
   * ============================================================ */
  var elAddModal = document.getElementById('add-modal');
  var addForm = document.getElementById('add-form');
  var af = {
    title: document.getElementById('a-title-input'),
    category: document.getElementById('a-category'),
    allday: document.getElementById('a-allday'),
    startDate: document.getElementById('a-start-date'),
    startTime: document.getElementById('a-start-time'),
    endDate: document.getElementById('a-end-date'),
    endTime: document.getElementById('a-end-time'),
    location: document.getElementById('a-location'),
    attendees: document.getElementById('a-attendees'),
    description: document.getElementById('a-description'),
    error: document.getElementById('a-error')
  };

  /* 類別選單 */
  Object.keys(cfg.CATEGORIES).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k;
    o.textContent = cfg.CATEGORIES[k].label;
    af.category.appendChild(o);
  });

  function toggleAddAllDay() {
    var on = af.allday.checked;
    document.getElementById('wrap-a-start-time').hidden = on;
    document.getElementById('wrap-a-end-time').hidden = on;
  }
  af.allday.addEventListener('change', toggleAddAllDay);

  /* 表單目前是「新增」還是「修改」。
     null = 新增；有值 = 正在改這一筆。 */
  var editingId = null;
  /* 修改時要沿用原本的可見性，不要偷偷改成公開 */
  var editingVisibility = 'department';

  function openAddModal(dateStr) {
    /* 沒登入（或不是管理員）不開表單 —— 就算開了，寫入也會被資料庫的
       RLS 擋掉，不如當下就講清楚，不要讓使用者填完才失敗。 */
    if (!A.isAdmin(session)) {
      A.toast('新增事件需要管理員權限，請先從右上角登入。', 'error');
      return;
    }

    editingId = null;
    editingVisibility = 'department';

    addForm.reset();
    af.category.value = 'meeting';
    af.allday.checked = false;
    af.startDate.value = dateStr;
    af.endDate.value = dateStr;
    af.startTime.value = '09:00';
    af.endTime.value = '10:00';
    af.error.hidden = true;

    document.getElementById('a-heading').textContent = '新增事件';
    document.getElementById('a-when').textContent = dateLabel(dateStr);
    document.getElementById('a-save').textContent = '新增';
    toggleAddAllDay();

    elAddModal.classList.add('show');
    window.setTimeout(function () { af.title.focus(); }, 60);
  }

  /* 修改：同一個表單，欄位帶入原本的值。
     日期時間要換算成台北時間再填 —— 資料庫存的是 UTC。 */
  function openEditModal(r) {
    if (!A.isAdmin(session)) {
      A.toast('修改事件需要管理員權限，請先從右上角登入。', 'error');
      return;
    }

    editingId = r.id;
    editingVisibility = r.visibility || 'department';

    addForm.reset();
    af.title.value = r.title || '';
    af.category.value = r.category || 'meeting';
    af.allday.checked = !!r.all_day;

    var s = A.tzParts(r.start_at), e = A.tzParts(r.end_at);
    af.startDate.value = s.date;
    af.startTime.value = s.time;
    af.endDate.value = e.date;
    af.endTime.value = e.time;

    af.location.value = r.location || '';
    af.attendees.value = attendeesOf(r);       /* 舊事件：名單從說明搬到這裡，直接編輯 */
    af.description.value = descWithoutAttendees(r);   /* 說明只留事由／議題／來源 */
    af.error.hidden = true;

    document.getElementById('a-heading').textContent = '修改事件';
    document.getElementById('a-when').textContent = A.fmtRange(r);
    document.getElementById('a-save').textContent = '儲存';
    toggleAddAllDay();

    elAddModal.classList.add('show');
    window.setTimeout(function () { af.title.focus(); }, 60);
  }

  function closeAddModal() {
    elAddModal.classList.remove('show');
  }

  document.getElementById('a-cancel').addEventListener('click', closeAddModal);
  elAddModal.addEventListener('click', function (e) {
    if (e.target === this) closeAddModal();
  });

  addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    af.error.hidden = true;

    var title = af.title.value.trim();
    if (!title) {
      showAddError('標題必填。');
      af.title.focus();
      return;
    }
    if (!af.startDate.value || !af.endDate.value) {
      showAddError('開始與結束日期都要填。');
      return;
    }

    var allDay = af.allday.checked;
    var startIso = A.tzToIso(af.startDate.value, allDay ? '00:00' : af.startTime.value);
    var endIso = A.tzToIso(af.endDate.value, allDay ? '23:59' : af.endTime.value);

    if (new Date(endIso) < new Date(startIso)) {
      showAddError('結束時間不可以早於開始時間。');
      return;
    }

    var payload = {
      title: title,
      category: af.category.value,
      visibility: editingVisibility,   /* 新增＝系上公開；修改＝沿用原本的 */
      all_day: allDay,
      start_at: startIso,
      end_at: endIso,
      location: af.location.value.trim() || null,
      attendees: af.attendees.value.trim() || null,
      description: af.description.value.trim() || null
    };

    var btn = document.getElementById('a-save');
    var isEdit = !!editingId;
    btn.disabled = true;

    /* 新增用 insert、修改用 update。
       兩者都接 .select()：RLS 擋掉時不會報錯，只會回 0 筆，
       沒有 .select() 就沒辦法分辨「成功」與「其實沒寫進去」。 */
    var q = isEdit
      ? A.sb.from('events').update(payload).eq('id', editingId)
      : A.sb.from('events').insert(payload);

    q.select().then(function (res) {
      /* 資料庫還沒跑 attendees 的 migration 時，退回不含該欄位再送一次，
         免得為了這個選填欄位讓整個「新增事件」壞掉。 */
      if (res.error && /attendees/i.test(res.error.message || '')) {
        delete payload.attendees;
        var q2 = isEdit
          ? A.sb.from('events').update(payload).eq('id', editingId)
          : A.sb.from('events').insert(payload);
        return q2.select();
      }
      return res;
    }).then(function (res) {
      btn.disabled = false;

      if (res.error) {
        showAddError((isEdit ? '修改失敗：' : '新增失敗：') + res.error.message);
        return;
      }
      if (!res.data || !res.data.length) {
        showAddError('沒有權限' + (isEdit ? '修改' : '新增') +
                     '這筆事件，請確認已用管理員帳號登入。');
        return;
      }

      closeAddModal();
      A.toast((isEdit ? '已更新「' : '已新增「') + title + '」', 'ok');
      refreshAll();
    });
  });

  /* ---------- 刪除事件 ---------- */
  var elDelModal = document.getElementById('del-modal');
  var pendingDelete = null;

  function openDelModal(r) {
    if (!A.isAdmin(session)) {
      A.toast('刪除事件需要管理員權限，請先從右上角登入。', 'error');
      return;
    }
    pendingDelete = r;
    document.getElementById('del-text').textContent =
      '確定要刪除「' + r.title + '」嗎？' + A.fmtRange(r) + '。此動作無法復原。';
    elDelModal.classList.add('show');
    /* 焦點放在「取消」而不是「確定刪除」：
       刪除無法復原，不能讓使用者順手按 Enter 就刪掉。 */
    window.setTimeout(function () { document.getElementById('del-cancel').focus(); }, 60);
  }

  function closeDelModal() {
    elDelModal.classList.remove('show');
    pendingDelete = null;
  }

  document.getElementById('del-cancel').addEventListener('click', closeDelModal);
  elDelModal.addEventListener('click', function (e) {
    if (e.target === this) closeDelModal();
  });

  document.getElementById('del-ok').addEventListener('click', function () {
    if (!pendingDelete) return;
    var r = pendingDelete;
    var btn = this;
    btn.disabled = true;

    A.sb.from('events').delete().eq('id', r.id).select().then(function (res) {
      btn.disabled = false;

      if (res.error) {
        closeDelModal();
        A.toast('刪除失敗：' + res.error.message, 'error');
        return;
      }
      if (!res.data || !res.data.length) {
        closeDelModal();
        A.toast('沒有權限刪除這筆事件，請確認已用管理員帳號登入。', 'error');
        return;
      }

      closeDelModal();
      A.toast('已刪除「' + r.title + '」', 'ok');
      refreshAll();
    });
  });

  function showAddError(msg) {
    af.error.textContent = msg;
    af.error.hidden = false;
  }

  /** 月曆與今日行程一起重讀 */
  function refreshAll() {
    calendar.refetchEvents();
    loadToday();
  }

  /* ---------- 工具列 ---------- */
  document.getElementById('btn-prev').addEventListener('click', function () { calendar.prev(); });
  document.getElementById('btn-next').addEventListener('click', function () { calendar.next(); });
  document.getElementById('btn-today').addEventListener('click', function () { calendar.today(); });
  btnView.addEventListener('click', function () {
    calendar.changeView(calendar.view.type === 'listMonth' ? 'dayGridMonth' : 'listMonth');
  });

  /* 視窗尺寸改變時，只更新「切換列表／切換月曆」按鈕的顯示，
     不再自動更換檢視 —— 預設一律是月曆，不因螢幕變窄就被換成列表。 */
  window.addEventListener('resize', function () {
    btnView.hidden = !isMobile();
  });

  /* ---------- 登入狀態 ---------- */
  /* 畫面（按鈕、頭像）只是提示；真正把關的是資料庫的 RLS。 */
  A.getSession().then(function (s) {
    session = s;
    if (!s || !s.user) return;

    var email = s.user.email || '';
    if (A.isAdmin(s)) {
      btnAdd.hidden = false;
      badge.hidden = false;
      linkAdmin.textContent = '管理後台';
    }

    /* 在行事曆最上方顯示登入者與頭像。
       姓名與照片取自 profiles（跟公差/招生記錄頁同一份資料），
       讀不到就退回用信箱，至少讓使用者知道自己是誰。 */
    document.getElementById('who-name').textContent = email;
    elWhoChip.hidden = false;

    A.sb.from('profiles').select('id,full_name,avatar_url,role')
      .eq('id', s.user.id).maybeSingle()
      .then(function (r) {
        var p = (r && !r.error && r.data) || {};
        var name = (p.full_name || '').trim() || email;
        document.getElementById('who-name').textContent = name;
        document.getElementById('who-avatar').innerHTML =
          A.avatarHtml(name, p.avatar_url, 'avatar-md');
        if (p.role) {
          var roleEl = document.getElementById('who-role');
          roleEl.textContent = A.roleLabel(p);
          roleEl.hidden = false;
        }

        /* 管理後台只給系辦（admin／assistant）：一般老師登入後不該看到，
           所以登入後依角色重新決定顯示與否（匿名時它是「管理員登入」入口）。 */
        var isMgr = A.isRecordManager(p);
        linkAdmin.hidden = !isMgr;
        if (menuAdmin) menuAdmin.hidden = !isMgr;
        if (isMgr) linkAdmin.textContent = '管理後台';

        /* 頭像接上修改密碼視窗 */
        A.syncHeaderAuth(s, p);
      });
  });

  /* 今日行程欄位（免登入即可看，跟月曆一樣是公開資訊） */
  loadToday();
})();
