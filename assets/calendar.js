/* ============================================================
 * 公開月曆頁（index.html）
 * 免登入即可查看；管理員登入後才會出現「新增事件」按鈕。
 * ============================================================ */
(function () {
  'use strict';
  var A = window.App;
  var cfg = A.cfg;

  var elCal = document.getElementById('calendar');
  var elLabel = document.getElementById('month-label');
  var elLoading = document.getElementById('loading');
  var elEmpty = document.getElementById('empty');
  var elError = document.getElementById('error');
  var btnAdd = document.getElementById('btn-add');
  var btnView = document.getElementById('btn-view');
  var linkAdmin = document.getElementById('link-admin');
  var badge = document.getElementById('admin-badge');

  document.getElementById('site-title').textContent = cfg.SITE_TITLE;
  document.getElementById('site-subtitle').textContent = cfg.SITE_SUBTITLE;
  document.title = cfg.SITE_TITLE;

  /* 圖例 */
  var lg = document.getElementById('legend');
  Object.keys(cfg.CATEGORIES).forEach(function (k) {
    var c = cfg.CATEGORIES[k];
    var s = document.createElement('span');
    s.innerHTML = '<i style="background:' + c.color + '"></i>' + c.label;
    lg.appendChild(s);
  });

  /* ---------- 統計列 ---------- */
  /* 只查本學年度（8/1 起）的行程，前端算統計。
     統計只是加分項：查不到就整列隱藏，不影響月曆。 */
  var statRows = [];

  /** 'YYYY-MM-DD' → '日一二三四五六'（用 UTC 算，不受瀏覽器時區影響） */
  function weekdayOf(dateStr) {
    return '日一二三四五六'.charAt(new Date(dateStr + 'T00:00:00Z').getUTCDay());
  }

  /** 學年度起始日：8/1 起算 */
  function academicYearStart(d) {
    var y = d.getFullYear();
    var startY = (d.getMonth() + 1 >= 8) ? y : y - 1;
    return startY + '-08-01';
  }

  function loadStats() {
    var el = document.getElementById('stats');
    if (!el) return;
    var today = A.tzParts(new Date().toISOString()).date;

    A.sb.from('events')
      .select('title,start_at,end_at,category')
      .gte('start_at', academicYearStart(new Date()) + 'T00:00:00+08:00')
      .order('start_at')
      .then(function (r) {
        if (r.error) return;              /* 統計失敗不干擾月曆 */
        statRows = r.data || [];
        renderStats(el, today, statRows);
      });
  }

  function renderStats(el, today, rows) {
    var month = today.slice(0, 7);

    var inMonth = rows.filter(function (r) {
      return A.tzParts(r.start_at).date.slice(0, 7) === month;
    });
    document.getElementById('stat-year').textContent = rows.length;
    document.getElementById('stat-month').textContent = inMonth.length;

    /* 下一個行程（含今天） */
    var next = null;
    for (var i = 0; i < rows.length; i++) {
      if (A.tzParts(rows[i].start_at).date >= today) { next = rows[i]; break; }
    }
    var elNext = document.getElementById('stat-next');
    var elNextDate = document.getElementById('stat-next-date');
    if (next) {
      var nd = A.tzParts(next.start_at).date;
      elNext.textContent = next.title;
      elNextDate.textContent = A.shortDate(nd) + '（' + weekdayOf(nd) + '）';
    } else {
      elNext.textContent = '近期無行程';
      elNextDate.textContent = '—';
    }

    /* 最近一次放假 */
    var hol = null;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].category === 'holiday' &&
          A.tzParts(rows[j].start_at).date >= today) { hol = rows[j]; break; }
    }
    var elHol = document.getElementById('stat-holiday');
    var elHolDate = document.getElementById('stat-holiday-date');
    if (hol) {
      var hd = A.tzParts(hol.start_at).date;
      /* 加上「還有幾天」，否則當下一個行程本身就是放假時，
         這張卡會跟第一張寫得一模一樣，看起來像重複。 */
      var diff = Math.round(
        (new Date(hd + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
      var when = diff === 0 ? '就是今天' : (diff > 0 ? '還有 ' + diff + ' 天' : '');
      elHol.textContent = hol.title;
      elHolDate.textContent = A.shortDate(hd) + '（' + weekdayOf(hd) + '）' +
                              (when ? '・' + when : '');
    } else {
      elHol.textContent = '—';
      elHolDate.textContent = '—';
    }

    el.hidden = false;
  }

  loadStats();

  /* ---------- 日期小工具 ---------- */
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* 把資料庫的一列轉成 FullCalendar 事件 */
  function toFcEvent(r) {
    var c = A.cat(r.category);
    var ev = {
      id: r.id,
      title: r.title,
      backgroundColor: c.color,
      borderColor: c.color,
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

  function isMobile() { return window.innerWidth < cfg.MOBILE_BREAKPOINT; }

  function showError(err) {
    elLoading.hidden = true;
    elError.hidden = false;
    if (A.isMissingTable(err)) {
      elError.innerHTML = '資料表尚未建立。<br>請先在 Supabase 執行 <code>supabase/migration.sql</code>。';
    } else {
      elError.innerHTML = '載入失敗，請稍後再試。' +
        '<br><code>' + String(err.message || err) + '</code>';
    }
  }

  /* ---------- 本週與今天 ----------
     「今天」一律以台北日期為準（A.tzParts），跟上面的統計列同一個來源。
     不要用瀏覽器當地日期：筆電時區沒調好（或使用者出國）時，
     統計列說「今天 10/10」、月曆卻把 10/11 圈起來，兩邊會互相打臉。 */
  function todayStr() { return A.tzParts(new Date().toISOString()).date; }

  /** FullCalendar 傳進來的 Date → 那一格代表的日期字串 'YYYY-MM-DD' */
  function cellDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' +
           (day < 10 ? '0' : '') + day;
  }

  /** 本週（台北今天的週一～週日） */
  function currentWeekRange() {
    var t = todayStr();
    var dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7;   /* 0 = 週一 */
    return [addDays(t, -dow), addDays(t, 6 - dow)];
  }

  /** 這筆行程有沒有落在本週（含跨日，只要重疊就算） */
  function isThisWeek(r) {
    if (!r) return false;
    var w = currentWeekRange();
    var s = A.tzParts(r.start_at).date;
    var e = A.tzParts(r.end_at).date;      /* 全天存末日、有時間存結束當下，兩者都含 */
    return s <= w[1] && e >= w[0];
  }

  function weekClass(arg) {
    var r = currentWeekRange(), d = cellDate(arg.date), cls = [];
    if (d >= r[0] && d <= r[1]) cls.push('fc-day-is-week');
    /* 自己標「今天」而不是靠 FullCalendar 的 fc-day-today：
       後者依瀏覽器時區，會跟統計列差一天 */
    if (d === todayStr()) cls.push('fc-day-is-tpe');
    return cls;
  }

  /* ---------- 今天的事件動畫（GSAP） ----------
     只在「今天」那一格的行程上跑：先由小放大進場，再輕輕呼吸，
     讓使用者一眼就看到今天的行程。
     兩道防線：GSAP 沒載入成功、或系統設定了「減少動態」→ 直接不跑，月曆照常可用。 */
  function animateToday() {
    if (typeof window.gsap === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* 用 data-date 指定今天那一格，而不是 .fc-day-today（見上） */
    var cell = elCal.querySelector('td[data-date="' + todayStr() + '"]');
    if (!cell) return;
    var els = cell.querySelectorAll('.fc-event');
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

  /* ---------- 月曆 ---------- */
  var calendar = new FullCalendar.Calendar(elCal, {
    initialView: isMobile() ? 'listMonth' : 'dayGridMonth',
    locale: 'zh-tw',
    firstDay: cfg.WEEK_STARTS_ON,
    headerToolbar: false,          /* 用自製的工具列 */
    height: 'auto',
    dayMaxEventRows: 4,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    noEventsText: '本月尚無行程',

    /* 本週整列淡底色、今天再加一圈外框（見 styles.css） */
    dayCellClassNames: weekClass,

    events: function (info, success, failure) {
      A.fetchEvents(info.start, info.end).then(function (rows) {
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
      var r = info.event.extendedProps.row;
      openDetail(r);
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
      var tip = [A.fmtRange(r), r.title].filter(Boolean).join('　');
      if (r.location) tip += '（' + r.location + '）';
      var t = info.el.querySelector('.fc-event-title') || info.el;
      t.setAttribute('title', tip);

      /* 本週的行程特別凸顯（見 styles.css）。
         用 class 而不是直接改樣式，才能一眼看出是哪條規則在作用。 */
      if (isThisWeek(r)) info.el.classList.add('fc-event-thisweek');
    }
  });

  calendar.render();

  /* ---------- 事件詳情 ---------- */
  function openDetail(r) {
    document.getElementById('m-title').textContent = r.title;
    document.getElementById('m-time').textContent = A.fmtRange(r);
    document.getElementById('m-cat').textContent = A.cat(r.category).label;

    var locWrap = document.getElementById('m-loc-wrap');
    if (r.location) {
      document.getElementById('m-loc').textContent = r.location;
      locWrap.hidden = false;
    } else { locWrap.hidden = true; }

    var descWrap = document.getElementById('m-desc-wrap');
    if (r.description) {
      document.getElementById('m-desc').textContent = r.description;
      descWrap.hidden = false;
    } else { descWrap.hidden = true; }

    document.getElementById('modal').classList.add('show');
  }

  document.getElementById('m-close').addEventListener('click', function () {
    document.getElementById('modal').classList.remove('show');
  });
  document.getElementById('modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('show');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.getElementById('modal').classList.remove('show');
  });

  /* ---------- 工具列 ---------- */
  document.getElementById('btn-prev').addEventListener('click', function () { calendar.prev(); });
  document.getElementById('btn-next').addEventListener('click', function () { calendar.next(); });
  document.getElementById('btn-today').addEventListener('click', function () { calendar.today(); });
  btnView.addEventListener('click', function () {
    calendar.changeView(calendar.view.type === 'listMonth' ? 'dayGridMonth' : 'listMonth');
  });

  /* 視窗尺寸改變時，自動在「月曆 / 列表」之間切換（手機用列表較好用） */
  var lastMobile = isMobile();
  window.addEventListener('resize', function () {
    var m = isMobile();
    if (m !== lastMobile) {
      lastMobile = m;
      calendar.changeView(m ? 'listMonth' : 'dayGridMonth');
    }
  });

  /* ---------- 登入狀態（只影響按鈕顯示；真正把關在 RLS） ---------- */
  A.getSession().then(function (session) {
    if (A.isAdmin(session)) {
      btnAdd.hidden = false;
      badge.hidden = false;
      linkAdmin.textContent = '管理後台';
    }
  });
})();
