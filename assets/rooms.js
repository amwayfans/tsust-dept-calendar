/* ============================================================
 * 教室課表 — 邏輯
 *   教室查詢（含空堂、現在這一節）／我的課表／找老師或課程
 *
 * 資料表 room_schedule 由教務系統的教室課表 PDF 解析匯入，
 * 教室清單不寫死 —— 學期增減教室時，只要重新匯入就會自動出現。
 * ============================================================ */
(function () {
  'use strict';

  var A = window.App;
  var SB = A.sb;

  var DAYS = [1, 2, 3, 4, 5, 6, 7];
  var DAY_NAME = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    rows: [],
    semester: '',
    room: '',
    mode: 'room',
    onlyFree: false,
    dayFilter: null,
    me: null            // 目前登入者的 profile
  };

  /* ---------- 登入 ---------- */
  var elLogin = $('login-card'), elApp = $('app');

  function showLogin(msg) {
    elLogin.hidden = false;
    elApp.hidden = true;
    var e = $('login-error');
    if (msg) { e.textContent = msg; e.hidden = false; } else { e.hidden = true; }
  }

  function setWho(session, profile) {
    var chip = $('who-chip');
    if (!session || !session.user) { chip.hidden = true; return; }
    var name = (profile && profile.full_name) || session.user.email;
    chip.hidden = false;
    $('who-avatar').innerHTML = A.avatarHtml(name, profile && profile.avatar_url, 'avatar-sm');
    $('who').textContent = name;
    var role = A.roleLabel(profile);
    var rEl = $('who-role');
    if (role) { rEl.textContent = role; rEl.hidden = false; } else { rEl.hidden = true; }
    $('menu-user').hidden = false;
  }

  /* ---------- 資料 ---------- */
  function fetchAll() {
    // 一學期的教室課表約 400 筆，一次抓完最單純，也省得多打 API。
    return SB.from('room_schedule')
      .select('semester,room,day,period,period_label,start_time,end_time,course,teacher,class_name')
      .order('room', { ascending: true })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      });
  }

  function semestersOf(rows) {
    var s = {};
    rows.forEach(function (r) { s[r.semester] = 1; });
    // '115-1' 這種格式：學年大的排前面，同學年學期大的排前面
    return Object.keys(s).sort(function (a, b) {
      var pa = a.split('-'), pb = b.split('-');
      if (pa[0] !== pb[0]) return (+pb[0]) - (+pa[0]);
      return (+(pb[1] || 0)) - (+(pa[1] || 0));
    });
  }

  function currentRows() {
    return state.rows.filter(function (r) { return r.semester === state.semester; });
  }

  function periodsOf(rows) {
    var seen = {};
    rows.forEach(function (r) { seen[r.period] = r.period_label; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; })
      .map(function (p) { return { period: p, label: seen[p] }; });
  }

  /* ---------- 教室選擇 ---------- */
  function renderPicker() {
    var rows = currentRows();
    var rooms = {};
    rows.forEach(function (r) { rooms[r.room] = (rooms[r.room] || 0) + 1; });
    var names = Object.keys(rooms).sort();
    if (!state.room || names.indexOf(state.room) < 0) state.room = names[0] || '';

    $('room-picker').innerHTML = names.map(function (n) {
      return '<button type="button" class="rs-room-btn' + (n === state.room ? ' is-active' : '') +
             '" data-room="' + A.esc(n) + '">' + A.esc(n) +
             '<span class="rs-cnt">' + rooms[n] + '</span></button>';
    }).join('');
  }

  /* ---------- 課表 ---------- */
  function todayIdx() { return new Date().getDay() === 0 ? 7 : new Date().getDay(); }

  function hhmmNow() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** 現在正在上課的節次（用「今天」那一組的時段判斷，週間與週末時段不同） */
  function nowPeriod(rows) {
    var day = todayIdx(), now = hhmmNow();
    var hit = rows.filter(function (r) {
      return r.day === day && r.start_time && r.end_time &&
             r.start_time <= now && now < r.end_time;
    });
    if (!hit.length) return null;
    return { day: day, period: hit[0].period,
             label: hit[0].period_label, until: hit[0].end_time };
  }

  function renderGrid() {
    var all = currentRows();
    var rows = all.filter(function (r) { return r.room === state.room; });
    var periods = periodsOf(all);
    var np = nowPeriod(all);

    var head = '<thead><tr><th>節次</th>' + DAYS.map(function (d) {
      return '<th data-day="' + d + '">週' + DAY_NAME[d] + '</th>';
    }).join('') + '</tr></thead>';

    var body = '<tbody>' + periods.map(function (p) {
      var cells = DAYS.map(function (d) {
        var items = rows.filter(function (r) { return r.day === d && r.period === p.period; });
        var cls = ['rs-cell'];
        if (d === state.dayFilter || state.dayFilter === null) cls.push('rs-show');
        if (np && np.day === d && np.period === p.period) cls.push('rs-now');
        if (!items.length) cls.push('rs-free');
        if (state.onlyFree && items.length) cls.push('rs-hide');
        var inner = items.map(function (r) {
          return '<span class="rs-course">' +
                   '<b>' + A.esc(r.course) + '</b>' +
                   '<span>' + A.esc(r.teacher || '—') + '</span>' +
                   (r.class_name ? '<span class="rs-cls">' + A.esc(r.class_name) + '</span>' : '') +
                 '</span>';
        }).join('');
        return '<td class="' + cls.join(' ') + '" data-day="' + d + '">' + inner + '</td>';
      }).join('');
      return '<tr><th>' + A.esc(p.label) + '</th>' + cells + '</tr>';
    }).join('') + '</tbody>';

    $('grid').innerHTML = head + body;
    $('grid').className = 'rs-grid' + (state.onlyFree ? ' rs-only-free' : '');

    var note = rows.length
      ? state.room + '：這學期共 ' + rows.length + ' 節有排課'
      : '這間教室這學期沒有排課';
    $('room-note').textContent = note;

    var nEl = $('now-label');
    if (np) {
      nEl.textContent = '現在是 週' + DAY_NAME[np.day] + ' 第 ' + np.label + ' 節（到 ' + np.until + '）';
      nEl.hidden = false;
    } else {
      nEl.hidden = true;
    }
    renderDayTabs();
  }

  /* 手機：一次只看一天 */
  function renderDayTabs() {
    var isNarrow = window.matchMedia('(max-width: 720px)').matches;
    var el = $('day-tabs');
    el.hidden = !isNarrow;
    if (!isNarrow) { state.dayFilter = null; return; }
    if (state.dayFilter === null) state.dayFilter = todayIdx();
    el.innerHTML = DAYS.map(function (d) {
      return '<button type="button" class="' + (d === state.dayFilter ? 'is-active' : '') +
             '" data-day="' + d + '">週' + DAY_NAME[d] + '</button>';
    }).join('');
  }

  /* ---------- 我的課表 ---------- */
  function renderMine() {
    var name = state.me && state.me.full_name;
    if (!name) {
      $('mine-title').textContent = '我的課表';
      $('mine-body').innerHTML = '<p class="rs-none">查不到您的教師姓名，請洽系辦（分機 2102）。</p>';
      return;
    }
    $('mine-title').textContent = name + ' 老師 — 這學期的課';
    var rows = currentRows().filter(function (r) { return r.teacher === name; });
    if (!rows.length) {
      $('mine-body').innerHTML = '<p class="rs-none">這學期在教室課表裡沒有查到您的課。' +
        '若應該有課，請洽系辦（分機 2102）。</p>';
      return;
    }
    rows.sort(function (a, b) { return a.day - b.day || a.period - b.period; });
    $('mine-body').innerHTML = '<ul class="rs-list">' + rows.map(function (r) {
      return '<li>' +
        '<span class="rs-when">週' + DAY_NAME[r.day] + ' 第 ' + A.esc(r.period_label) + ' 節' +
          (r.start_time ? '<br>' + A.esc(r.start_time) + '–' + A.esc(r.end_time) : '') + '</span>' +
        '<span class="rs-what"><b>' + A.esc(r.course) + '</b>' +
          '<span>' + A.esc(r.room) + '　' + A.esc(r.class_name || '') + '</span></span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  /* ---------- 找老師／課程 ---------- */
  function renderFind() {
    var q = ($('find-q').value || '').trim();
    var body = $('find-body');
    if (q.length < 1) { body.innerHTML = '<p class="rs-none">輸入老師姓名或課程名稱就會列出他在哪些教室、哪幾節。</p>'; return; }

    var rows = currentRows().filter(function (r) {
      return (r.teacher && r.teacher.indexOf(q) >= 0) ||
             (r.course && r.course.indexOf(q) >= 0) ||
             (r.class_name && r.class_name.indexOf(q) >= 0);
    });
    if (!rows.length) {
      body.innerHTML = '<p class="rs-none">查不到「' + A.esc(q) + '」。請試試其他關鍵字（可用部分名稱）。</p>';
      return;
    }

    // 依老師分組（同一門課可能跨多節，合併顯示）
    var byTeacher = {};
    rows.forEach(function (r) {
      var k = r.teacher || '（未標老師）';
      (byTeacher[k] = byTeacher[k] || []).push(r);
    });
    var html = '';
    Object.keys(byTeacher).sort().forEach(function (t) {
      var list = byTeacher[t].sort(function (a, b) { return a.day - b.day || a.period - b.period; });
      html += '<div class="rs-group-title">' + A.esc(t) + '　' + list.length + ' 節</div>';
      html += '<ul class="rs-list">' + list.map(function (r) {
        return '<li>' +
          '<span class="rs-when">週' + DAY_NAME[r.day] + ' 第 ' + A.esc(r.period_label) + ' 節' +
            (r.start_time ? '<br>' + A.esc(r.start_time) + '–' + A.esc(r.end_time) : '') + '</span>' +
          '<span class="rs-what"><b>' + A.esc(r.course) + '</b>' +
            '<span>' + A.esc(r.room) + '　' + A.esc(r.class_name || '') + '</span></span>' +
        '</li>';
      }).join('') + '</ul>';
    });
    body.innerHTML = html;
  }

  /* ---------- 模式切換 ---------- */
  function setMode(m) {
    state.mode = m;
    ['room', 'mine', 'find'].forEach(function (k) {
      $('pane-' + k).hidden = (k !== m);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.rs-mode'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === m);
    });
    if (m === 'mine') renderMine();
    if (m === 'find') renderFind();
  }

  /* ---------- 進入 ---------- */
  function enter(session) {
    elLogin.hidden = true;
    elApp.hidden = false;
    return SB.from('profiles').select('*').eq('email', session.user.email).maybeSingle()
      .then(function (r) {
        state.me = (r.data) || null;
        setWho(session, state.me);
        return fetchAll();
      })
      .then(function (rows) {
        state.rows = rows;
        var sems = semestersOf(rows);
        state.semester = sems[0] || '';
        $('semester-hint').textContent = state.semester
          ? state.semester.replace('-', ' 學年度第 ') + ' 學期　·　資料來源：教務系統教室課表'
          : '目前沒有教室課表資料';
        renderPicker();
        renderGrid();
        setMode('room');
      });
  }

  function boot() {
    A.getSession().then(function (session) {
      if (!session) { showLogin(); return; }
      return enter(session).catch(function (e) {
        if (A.isMissingTable(e)) {
          showLogin('教室課表資料表尚未建立，請洽系辦。');
        } else {
          showLogin('載入失敗：' + (e.message || e));
        }
      });
    });
  }

  /* ---------- 事件 ---------- */
  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var e = $('login-error'); e.hidden = true;
    A.signIn($('email').value.trim(), $('password').value)
      .then(function (s) { return enter(s); })
      .catch(function (err) {
        e.textContent = '登入失敗：' + (err.message || '請確認帳號密碼');
        e.hidden = false;
      });
  });

  $('btn-line-login').addEventListener('click', function () {
    A.signInWithLine().catch(function (err) {
      var e = $('login-error');
      e.textContent = 'LINE 登入未完成：' + (err.message || err);
      e.hidden = false;
    });
  });

  $('room-picker').addEventListener('click', function (ev) {
    var b = ev.target.closest('.rs-room-btn');
    if (!b) return;
    state.room = b.getAttribute('data-room');
    renderPicker();
    renderGrid();
  });

  document.querySelector('.rs-modes').addEventListener('click', function (ev) {
    var b = ev.target.closest('.rs-mode');
    if (b) setMode(b.getAttribute('data-mode'));
  });

  $('only-free').addEventListener('change', function () {
    state.onlyFree = this.checked;
    // 空堂模式：把有課的格子淡出，讓空堂一目了然
    Array.prototype.forEach.call(document.querySelectorAll('#grid td'), function (td) {
      var has = td.querySelector('.rs-course');
      td.classList.toggle('rs-free', !has);
      td.style.opacity = (state.onlyFree && has) ? '.25' : '';
    });
  });

  $('day-tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-day]');
    if (!b) return;
    state.dayFilter = +b.getAttribute('data-day');
    renderGrid();
  });

  $('find-q').addEventListener('input', renderFind);

  window.addEventListener('resize', function () {
    var wasNull = state.dayFilter === null;
    renderDayTabs();
    if (state.dayFilter !== null) renderGrid();
    else if (!wasNull) renderGrid();
  });

  boot();
})();
