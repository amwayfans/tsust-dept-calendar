/* ============================================================
 * 招生負責學校 — 邏輯
 *   資料表：recruit_schools（一列＝老師＋學校＋科別）
 *   兩種查法：①選老師 → 看他負責哪些學校 ②選學校 → 看哪幾位老師負責
 *   同一所學校的多個科在畫面上合併成同一列，科別用標籤並列。
 *
 * 安全原則（與教師通訊錄一致）：
 *   未登入完全不抓資料；確認登入後才發請求，RLS 也要求 authenticated。
 * ============================================================ */
(function () {
  'use strict';

  var A = window.App;
  var SB = A.sb;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    rows: [],        // [{teacher_name, teacher_emp, school, dept}]
    byTeacher: {},   // 姓名 → {emp, schools:{學校:[科別]}}
    bySchool: {},    // 學校 → {老師:{emp, depts:[]}}
    me: null
  };

  var elLogin = $('login-card'), elApp = $('app');

  /* ---------- 登入 ---------- */
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
    A.syncHeaderAuth(session, profile);
  }

  /* ---------- 資料 ---------- */
  function fetchRows() {
    return SB.from('recruit_schools')
      .select('teacher_name,teacher_emp,school,dept,sort_order')
      .order('sort_order', { ascending: true })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      });
  }

  function buildIndex() {
    var byTeacher = {}, bySchool = {};
    state.rows.forEach(function (r) {
      var t = byTeacher[r.teacher_name] || (byTeacher[r.teacher_name] = { emp: r.teacher_emp || '', schools: {} });
      var list = t.schools[r.school] || (t.schools[r.school] = []);
      if (r.dept && list.indexOf(r.dept) < 0) list.push(r.dept);

      var s = bySchool[r.school] || (bySchool[r.school] = {});
      var one = s[r.teacher_name] || (s[r.teacher_name] = { emp: r.teacher_emp || '', depts: [] });
      if (r.dept && one.depts.indexOf(r.dept) < 0) one.depts.push(r.dept);
    });
    state.byTeacher = byTeacher;
    state.bySchool = bySchool;
  }

  function schoolsSorted() {
    return Object.keys(state.bySchool).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
  }
  function teachersSorted() {
    return Object.keys(state.byTeacher).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
  }

  /* ---------- 渲染 ---------- */
  function chips(depts, noneText) {
    if (!depts || !depts.length) return '<span class="rc-chip rc-chip--none">' + noneText + '</span>';
    return depts.map(function (d) { return '<span class="rc-chip">' + A.esc(d) + '</span>'; }).join(' ');
  }

  function renderTeacherSelect() {
    var sel = $('t-select');
    var opts = ['<option value="">— 選擇老師 —</option>'];
    teachersSorted().forEach(function (name) {
      var t = state.byTeacher[name];
      var n = Object.keys(t.schools).length;
      opts.push('<option value="' + A.esc(name) + '">' + A.esc(name) +
                '（' + n + ' 所學校）</option>');
    });
    sel.innerHTML = opts.join('');
  }

  function renderSchoolSelect() {
    var q = ($('s-search').value || '').trim().toLowerCase();
    var sel = $('s-select');
    var cur = sel.value;
    var list = schoolsSorted().filter(function (s) {
      return !q || s.toLowerCase().indexOf(q) >= 0;
    });
    var opts = ['<option value="">— 選擇學校 —</option>'];
    list.forEach(function (s) {
      var n = Object.keys(state.bySchool[s]).length;
      opts.push('<option value="' + A.esc(s) + '">' + A.esc(s) + '（' + n + ' 位老師）</option>');
    });
    sel.innerHTML = opts.join('');
    if (cur && list.indexOf(cur) >= 0) sel.value = cur;
  }

  function renderTeacher(name) {
    var card = $('teacher-card'), body = $('t-body');
    if (!name || !state.byTeacher[name]) { card.hidden = true; body.innerHTML = ''; return; }
    var t = state.byTeacher[name];
    var schools = Object.keys(t.schools).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    var deptCount = 0;
    schools.forEach(function (s) { deptCount += t.schools[s].length; });

    $('t-title').innerHTML = '<span class="rc-teacher-name">' + A.esc(name) + '</span>' +
      (t.emp ? ' <span class="rc-teacher-emp">' + A.esc(t.emp) + '</span>' : '');
    var html = '<p class="rc-meta">負責 ' + schools.length + ' 所學校' +
               (deptCount ? '（' + deptCount + ' 個科別）' : '') + '</p>';
    html += '<ul class="rc-school-list">';
    schools.forEach(function (s) {
      html += '<li><span class="rc-school-name">' + A.esc(s) + '</span> ' +
              chips(t.schools[s], '未指定科別') + '</li>';
    });
    html += '</ul>';
    body.innerHTML = html;
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSchool(school) {
    var card = $('school-card'), body = $('s-body');
    if (!school || !state.bySchool[school]) { card.hidden = true; body.innerHTML = ''; return; }
    var teachers = Object.keys(state.bySchool[school]).sort(function (a, b) {
      return a.localeCompare(b, 'zh-Hant');
    });

    $('s-title').textContent = school;
    var html = '<p class="rc-meta">共 ' + teachers.length + ' 位老師負責</p>';
    html += '<ul class="rc-teacher-list">';
    teachers.forEach(function (name) {
      var t = state.bySchool[school][name];
      html += '<li><div class="rc-teacher-head">' +
                '<span class="rc-teacher-name">' + A.esc(name) + '</span>' +
                (t.emp ? '<span class="rc-teacher-emp">' + A.esc(t.emp) + '</span>' : '') +
              '</div><div class="rc-teacher-depts">' + chips(t.depts, '未指定科別') + '</div></li>';
    });
    html += '</ul>';
    body.innerHTML = html;
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderAll() {
    var schools = schoolsSorted();
    var rows = [];
    schools.forEach(function (s) {
      var teachers = Object.keys(state.bySchool[s]).sort(function (a, b) {
        return a.localeCompare(b, 'zh-Hant');
      });
      var lines = teachers.map(function (name) {
        var d = state.bySchool[s][name].depts;
        return A.esc(name) + (d.length ? '（' + d.map(A.esc).join('、') + '）' : '');
      });
      rows.push('<tr><td class="rc-col-school">' + A.esc(s) + '</td>' +
                '<td>' + lines.join('、') + '</td></tr>');
    });
    $('all-body').innerHTML =
      '<div class="rc-table-wrap"><table class="rc-table">' +
      '<thead><tr><th>學校</th><th>負責老師（科別）</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table></div>';
    $('all-count').textContent = '（' + schools.length + ' 所學校、' + state.rows.length + ' 筆負責關係）';
  }

  /* ---------- 進入頁面 ---------- */
  function enter(session) {
    elLogin.hidden = true;
    elApp.hidden = false;
    return SB.from('profiles').select('id,full_name,role,avatar_url').eq('id', session.user.id).maybeSingle()
      .then(function (r) {
        state.me = (r && !r.error && r.data) || null;
        setWho(session, state.me);
        return fetchRows();          // 確認登入後才抓資料
      })
      .then(function (rows) {
        state.rows = rows;
        buildIndex();
        renderTeacherSelect();
        renderSchoolSelect();
        renderAll();
        var nSchools = Object.keys(state.bySchool).length;
        var nTeachers = Object.keys(state.byTeacher).length;
        $('summary').textContent = nTeachers + ' 位老師、' + nSchools + ' 所學校、' + rows.length + ' 筆負責關係';
        $('booting').hidden = true;
      });
  }

  function boot() {
    A.getSession().then(function (session) {
      if (!session || !session.user) { showLogin(); $('booting').hidden = true; return; }
      return enter(session).catch(function (e) {
        $('booting').hidden = true;
        if (A.isMissingTable(e)) showLogin('招生負責學校資料表尚未建立，請洽系辦。');
        else showLogin('載入失敗：' + (e.message || e));
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

  $('t-select').addEventListener('change', function () { renderTeacher(this.value); });
  $('s-select').addEventListener('change', function () { renderSchool(this.value); });

  $('s-search').addEventListener('input', function () {
    renderSchoolSelect();
    // 只剩一所學校時直接帶出結果，少按一次
    var sel = $('s-select');
    if (sel.options.length === 2 && this.value.trim()) {
      sel.selectedIndex = 1;
      renderSchool(sel.value);
    }
  });

  $('t-clear').addEventListener('click', function () {
    $('t-select').value = ''; $('teacher-card').hidden = true; $('t-body').innerHTML = '';
  });
  $('s-clear').addEventListener('click', function () {
    $('s-select').value = ''; $('school-card').hidden = true; $('s-body').innerHTML = '';
  });
  $('btn-print').addEventListener('click', function () { window.print(); });

  A.accordion($('all-body').closest('.card'));

  /* 修改密碼 */
  var pwModal = $('pw-modal');
  $('btn-pw').addEventListener('click', function () { pwModal.classList.add('show'); });
  $('pw-cancel').addEventListener('click', function () { pwModal.classList.remove('show'); });
  pwModal.addEventListener('click', function (e) { if (e.target === this) pwModal.classList.remove('show'); });
  $('pw-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var p1 = $('pw1').value, p2 = $('pw2').value, err = $('pw-error');
    err.hidden = true;
    if (p1.length < 6) { err.textContent = '密碼至少 6 個字元。'; err.hidden = false; return; }
    if (p1 !== p2) { err.textContent = '兩次輸入不一致。'; err.hidden = false; return; }
    SB.auth.updateUser({ password: p1 }).then(function (res) {
      if (res.error) { err.textContent = res.error.message; err.hidden = false; return; }
      A.toast('密碼已更新', 'ok');
      pwModal.classList.remove('show');
      $('pw1').value = ''; $('pw2').value = '';
    });
  });

  boot();
})();
