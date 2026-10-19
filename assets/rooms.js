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
    me: null,           // 目前登入者的 profile
    canEdit: false,     // 是否為系辦（admin／assistant）—— 決定要不要顯示編輯功能
    editingId: null,    // 正在修改的 room_schedule.id（null＝新增）
    mineTeacher: ''     // 管理員在「我的課表」選的老師
  };

  /* 節次完整範圍（1~10 日間、13~17 進修部夜間 A~E）——
     教室課表會調課，不能只列「這學期剛好有課」的節次。 */
  var ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17];

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
    /* 一般老師不顯示「管理後台」；頭像接上修改密碼視窗 */
    A.syncHeaderAuth(session, profile);
  }

  /* ---------- 資料 ---------- */
  function fetchAll() {
    // 一學期的教室課表約 400 筆，一次抓完最單純，也省得多打 API。
    return SB.from('room_schedule')
      .select('id,semester,room,day,period,period_label,start_time,end_time,course,teacher,class_name')
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

    // 教室清單一律由資料產生（學期增減教室會自己出現，不寫死）
    var sel = $('room-select');
    sel.innerHTML = names.map(function (n) {
      return '<option value="' + A.esc(n) + '"' + (n === state.room ? ' selected' : '') + '>' +
             A.esc(n) + '（' + rooms[n] + ' 節）</option>';
    }).join('');
    sel.value = state.room;
    $('room-count').textContent = names.length ? '共 ' + names.length + ' 間教室' : '';
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
          /* 管理員：整格可以點開修改（調課、換教室）；一般老師純顯示 */
          var attrs = state.canEdit
            ? ' data-id="' + r.id + '" role="button" tabindex="0" title="點一下修改這筆課程"'
            : '';
          return '<span class="rs-course' + (state.canEdit ? ' rs-editable' : '') + '"' + attrs + '>' +
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
  /** 管理員專用：老師下拉（只列這學期課表裡出現過的老師） */
  function fillTeacherPicker() {
    var seen = {};
    currentRows().forEach(function (r) { if (r.teacher) seen[r.teacher] = 1; });
    var list = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    var sel = $('mine-teacher');
    sel.innerHTML = list.map(function (n) {
      return '<option value="' + A.esc(n) + '">' + A.esc(n) + '</option>';
    }).join('');
    if (!state.mineTeacher || list.indexOf(state.mineTeacher) < 0) {
      var own = state.me && state.me.full_name;
      state.mineTeacher = (own && list.indexOf(own) >= 0) ? own : (list[0] || '');
    }
    sel.value = state.mineTeacher;
  }

  /** 管理員看到的「目前正在檢視哪位老師」 */
  function viewingTeacher() {
    var own = state.me && state.me.full_name;
    if (!state.canEdit) return own;
    return state.mineTeacher || own;
  }

  function renderMine() {
    var name = viewingTeacher();
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

  /* ---------- 管理員：教室課表修改 ---------- */
  function openModal(id) { $(id).classList.add('show'); }
  function closeModal(id) { $(id).classList.remove('show'); }

  function fillEditorOptions() {
    var rooms = {}, teachers = {}, known = {};
    currentRows().forEach(function (r) {
      if (r.room) rooms[r.room] = 1;
      if (r.teacher) teachers[r.teacher] = 1;
      known[r.period] = r.period_label;
    });
    $('rs-room-list').innerHTML = Object.keys(rooms).sort().map(function (n) {
      return '<option value="' + A.esc(n) + '"></option>';
    }).join('');
    $('rs-teacher-list').innerHTML = Object.keys(teachers)
      .sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); })
      .map(function (n) { return '<option value="' + A.esc(n) + '"></option>'; }).join('');
    $('rs-e-period').innerHTML = ALL_PERIODS.map(function (p) {
      return '<option value="' + p + '">第 ' + p + ' 節' +
             (known[p] ? '（' + A.esc(known[p]) + '）' : '') + '</option>';
    }).join('');
  }

  function openEditor(row) {
    state.editingId = row ? row.id : null;
    $('rs-e-title').textContent = row ? '修改課程' : '新增課程';
    $('rs-e-sub').textContent = row
      ? '調課、換教室改這裡就好；儲存後課表立刻更新。'
      : '教室清單會依資料自動增減，直接打新的教室名稱也可以。';
    $('rs-e-error').hidden = true;
    fillEditorOptions();
    $('rs-e-semester').value = row ? row.semester : (state.semester || '');
    $('rs-e-room').value = row ? row.room : (state.room || '');
    $('rs-e-day').value = String(row ? row.day : todayIdx());
    $('rs-e-period').value = String(row ? row.period : ALL_PERIODS[0]);
    $('rs-e-period-label').value = row ? (row.period_label || '') : '';
    $('rs-e-start').value = row ? (row.start_time || '') : '';
    $('rs-e-end').value = row ? (row.end_time || '') : '';
    $('rs-e-course').value = row ? row.course : '';
    $('rs-e-teacher').value = row ? (row.teacher || '') : '';
    $('rs-e-class').value = row ? (row.class_name || '') : '';
    $('rs-e-delete').hidden = !row;
    openModal('rs-edit-modal');
    setTimeout(function () { $('rs-e-course').focus(); }, 60);
  }

  function saveEditor() {
    var err = $('rs-e-error');
    function bad(m) { err.textContent = m; err.hidden = false; }
    var p = {
      semester: $('rs-e-semester').value.trim(),
      room: $('rs-e-room').value.trim(),
      day: +$('rs-e-day').value,
      period: +$('rs-e-period').value,
      period_label: $('rs-e-period-label').value.trim() || $('rs-e-period').value,
      start_time: $('rs-e-start').value.trim() || null,
      end_time: $('rs-e-end').value.trim() || null,
      course: $('rs-e-course').value.trim(),
      teacher: $('rs-e-teacher').value.trim() || null,
      class_name: $('rs-e-class').value.trim() || null
    };
    err.hidden = true;
    if (!p.semester) { return bad('請填學期（例：115-1）。'); }
    if (!p.room) { return bad('請填教室。'); }
    if (!p.course) { return bad('請填課程名稱。'); }

    var btn = $('rs-e-save');
    btn.disabled = true;
    var wasEdit = !!state.editingId;
    var q = wasEdit
      ? SB.from('room_schedule').update(p).eq('id', state.editingId)
      : SB.from('room_schedule').insert(p);
    q.then(function (r) {
      btn.disabled = false;
      if (r.error) {
        if (r.error.code === '23505' || /duplicate/i.test(r.error.message || '')) {
          return bad('同樣的「教室＋星期＋節次＋課程＋老師」已經有一筆了，請確認是不是重複。');
        }
        return bad('儲存失敗：' + (r.error.message || r.error));
      }
      closeModal('rs-edit-modal');
      A.toast(wasEdit ? '已更新課程' : '已新增課程', 'ok');
      return refresh();
    }, function (e) {
      btn.disabled = false;
      bad('儲存失敗：' + (e.message || e));
    });
  }

  function refresh() {
    return fetchAll().then(function (rows) {
      state.rows = rows;
      renderPicker();
      renderGrid();
      fillTeacherPicker();
      if (state.mode === 'mine') { renderMine(); }
      if (state.mode === 'find') { renderFind(); }
    });
  }

  function askDelete() {
    if (!state.editingId) { return; }
    var r = state.rows.filter(function (x) { return x.id === state.editingId; })[0];
    $('rs-del-text').textContent = r
      ? '確定要刪除嗎？刪掉就救不回來了。\n\n' + r.room + '　週' + DAY_NAME[r.day] +
        ' 第 ' + r.period_label + ' 節\n' + r.course + '（' + (r.teacher || '未標老師') + '）'
      : '確定要刪除嗎？';
    openModal('rs-del-modal');
  }

  function doDelete() {
    var id = state.editingId;
    if (!id) { return; }
    SB.from('room_schedule').delete().eq('id', id).then(function (r) {
      closeModal('rs-del-modal');
      if (r.error) {
        A.toast('刪除失敗：' + (r.error.message || r.error), 'error');
        return;
      }
      closeModal('rs-edit-modal');
      A.toast('已刪除課程', 'ok');
      refresh();
    });
  }

  /** 管理員功能一律 fail-closed：HTML 先 hidden，這裡確認角色後才顯示 */
  function applyManagerUi() {
    state.canEdit = !!(state.me && A.isRecordManager(state.me));
    $('manage-bar').hidden = !state.canEdit;
    $('mine-picker').hidden = !state.canEdit;
    if (state.canEdit) { fillEditorOptions(); }
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
        applyManagerUi();
        renderPicker();
        renderGrid();
        fillTeacherPicker();
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

  $('room-select').addEventListener('change', function () {
    state.room = this.value;
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

  /* ---------- 管理員：修改／新增／刪除 ---------- */
  $('grid').addEventListener('click', function (ev) {
    var el = ev.target.closest('.rs-course');
    if (!el || !state.canEdit) { return; }
    var id = +el.getAttribute('data-id');
    var row = state.rows.filter(function (r) { return +r.id === id; })[0];
    if (row) { openEditor(row); }
  });
  $('grid').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
    var el = ev.target.closest('.rs-course');
    if (!el || !state.canEdit) { return; }
    ev.preventDefault();
    var row = state.rows.filter(function (r) { return +r.id === +el.getAttribute('data-id'); })[0];
    if (row) { openEditor(row); }
  });

  $('btn-add-course').addEventListener('click', function () { openEditor(null); });
  $('rs-e-save').addEventListener('click', saveEditor);
  $('rs-e-cancel').addEventListener('click', function () { closeModal('rs-edit-modal'); });
  $('rs-e-delete').addEventListener('click', askDelete);
  $('rs-del-cancel').addEventListener('click', function () { closeModal('rs-del-modal'); });
  $('rs-del-ok').addEventListener('click', doDelete);

  /* 換節次時自動帶入那個節次的時間（同一天已有的為準），讓調課少打幾個字 */
  $('rs-e-period').addEventListener('change', function () {
    var d = +$('rs-e-day').value, p = +$('rs-e-period').value;
    var hit = currentRows().filter(function (r) {
      return r.day === d && r.period === p && r.start_time;
    })[0];
    if (hit) {
      $('rs-e-start').value = hit.start_time || '';
      $('rs-e-end').value = hit.end_time || '';
      $('rs-e-period-label').value = hit.period_label || String(p);
    } else {
      $('rs-e-period-label').value = String(p);
    }
  });

  $('mine-teacher').addEventListener('change', function () {
    state.mineTeacher = this.value;
    renderMine();
  });

  /* 點空白處／按 Esc 關閉（桌機也適用） */
  Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
    m.addEventListener('click', function (ev) {
      if (ev.target === m) { m.classList.remove('show'); }
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') { return; }
    Array.prototype.forEach.call(document.querySelectorAll('.modal.show'), function (m) {
      m.classList.remove('show');
    });
  });

  window.addEventListener('resize', function () {
    var wasNull = state.dayFilter === null;
    renderDayTabs();
    if (state.dayFilter !== null) renderGrid();
    else if (!wasNull) renderGrid();
  });

  boot();
})();
