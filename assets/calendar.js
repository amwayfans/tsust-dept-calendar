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
    },

    eventClick: function (info) {
      var r = info.event.extendedProps.row;
      openDetail(r);
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
