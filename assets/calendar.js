/* ============================================================
 * 公開月曆頁（index.html）
 * 免登入即可查看；管理員登入後才會出現「新增事件」按鈕，
 * 也可以在月曆的日期上連點兩下直接叫出新增視窗。
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
  var elWhoChip = document.getElementById('who-chip');

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

  function loadToday() {
    var t = todayStr();
    document.getElementById('today-date').textContent = dateLabel(t);

    A.fetchEvents(new Date(t + 'T00:00:00+08:00'),
                  new Date(t + 'T23:59:59+08:00'))
      .then(renderToday)
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
       後者依瀏覽器時區，會跟今日行程欄位差一天 */
    if (d === todayStr()) cls.push('fc-day-is-tpe');
    return cls;
  }

  /* ---------- 今天那一格的行程動畫（GSAP） ----------
     先由小放大進場，再輕輕呼吸光暈。
     跟上面的呼吸字一樣：GSAP 沒載入或「減少動態」就整段略過。 */
  function animateToday() {
    if (typeof window.gsap === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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

      /* 本週的行程特別凸顯（見 styles.css） */
      if (isThisWeek(r)) info.el.classList.add('fc-event-thisweek');
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

    var descWrap = document.getElementById('m-desc-wrap');
    if (r.description) {
      document.getElementById('m-desc').textContent = r.description;
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
    af.description.value = r.description || '';
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

    A.sb.from('profiles').select('full_name,avatar_url,role')
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
      });
  });

  /* 今日行程欄位（免登入即可看，跟月曆一樣是公開資訊） */
  loadToday();
})();
