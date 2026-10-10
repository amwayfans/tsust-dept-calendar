/* ============================================================
 * 教師記錄分頁（records.html）
 *
 * 三個區塊：
 *   A. 我的記錄輸入（登入後）—— 教師寫自己的，管理員可代輸入
 *   B. 統計堆疊柱狀圖（公開）—— 只給聚合次數，不含任何明細
 *   C. 全部記錄列表（登入後）—— 篩選 + 分頁
 *
 * 重要原則：前端只負責「顯示」與「送出」。
 *   - teacher_name / academic_year 一律由資料庫 trigger 決定，
 *     前端就算亂送也會被覆蓋掉。
 *   - 訪客看不到任何一筆明細，統計數字走 record_stats() 這支
 *     只回傳加總結果的函式。
 * ============================================================ */
(function () {
  'use strict';

  var A = window.App;
  var cfg = A.cfg;
  var sb = A.sb;

  var PAGE_SIZE = 20;
  var TYPE_LABEL = { enrollment: '招生', duty: '公差' };
  var TYPE_COLOR = { enrollment: '#2563EB', duty: '#F59E0B' };

  /* ---------- 元素 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var elLogin = $('login-card'), elMy = $('my-section'), elAll = $('all-section');
  var elBooting = $('booting'), elForm = $('record-form');
  var elMyList = $('my-list'), elMyEmpty = $('my-empty'), elMyError = $('my-error');
  var elAllList = $('all-list'), elAllEmpty = $('all-empty'), elAllError = $('all-error');
  var elChartWrap = $('chart-wrap'), elChartEmpty = $('chart-empty'), elChartError = $('chart-error');
  var elYear = $('year-select');
  var f = {
    id: $('f-id'), type: $('f-type'), date: $('f-date'), desc: $('f-desc'),
    loc: $('f-loc'), note: $('f-note'), teacher: $('f-teacher')
  };

  /* ---------- 狀態 ---------- */
  var me = null;          // { session, profile, admin }
  var roster = [];        // 教師名冊
  var statsRows = [];     // 目前學年度的統計
  var chart = null;
  var allPage = 1, allTotal = 0;
  var pendingDelete = null;

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function today() { return A.tzParts(new Date().toISOString()).date; }

  /** 目前學年度：8/1 起算 */
  function currentYear() {
    var d = today();
    var y = parseInt(d.slice(0, 4), 10);
    var m = parseInt(d.slice(5, 7), 10);
    return y - 1911 - (m < 8 ? 1 : 0);
  }

  function friendlyAuthError(err) {
    var m = String((err && err.message) || err);
    if (/Invalid login credentials/i.test(m)) return '電子郵件或密碼不正確。';
    if (/Email not confirmed/i.test(m)) return '這個帳號尚未完成驗證，請洽系辦。';
    if (/rate limit|too many/i.test(m)) return '嘗試次數過多，請稍後再試。';
    return m;
  }

  function missingTableHint(el) {
    el.hidden = false;
    el.innerHTML = '資料表尚未建立。<br>請先在 Supabase 執行 <code>supabase/migration_records.sql</code>。';
  }

  /* ============================================================
   * 啟動
   * ============================================================ */
  loadRoster().then(function () {
    return loadYears();
  }).then(function () {
    return A.getSession();
  }).then(function (session) {
    elBooting.hidden = true;
    if (session && session.user) {
      return loadProfile(session.user.id).then(function (profile) {
        if (profile) { enter(session, profile); }
        else {
          return A.signOut().then(function () { showLogin('這個帳號沒有對應的教師資料，請洽系辦。'); });
        }
      });
    }
    showLogin();
  }).catch(function (err) {
    elBooting.hidden = true;
    showLogin();
    /* 資料表還沒建立時，給明確的下一步，而不是讓畫面空著 */
    if (A.isMissingTable(err)) {
      missingTableHint(elChartError);
      elYear.innerHTML = '<option>—</option>';
      elChartEmpty.hidden = true;
    } else {
      elChartError.hidden = false;
      elChartError.textContent = '載入失敗：' + ((err && err.message) || String(err));
    }
  });

  /* ---------- 名冊 / 學年度 ---------- */
  function loadRoster() {
    return sb.from('teacher_roster').select('email,full_name,category,title,sort_order')
      .order('sort_order')
      .then(function (res) {
        if (res.error) throw res.error;
        roster = res.data || [];
      });
  }

  function loadYears() {
    return sb.rpc('record_years').then(function (res) {
      if (res.error) throw res.error;
      var years = (res.data || []).map(function (r) { return r.academic_year; });
      var cur = currentYear();
      var list = [];
      for (var i = 0; i < 3; i++) list.push(cur - i);
      years.forEach(function (y) { if (list.indexOf(y) < 0) list.push(y); });
      list.sort(function (a, b) { return b - a; });

      elYear.innerHTML = list.map(function (y) {
        return '<option value="' + y + '">' + y + ' 學年度</option>';
      }).join('');
      elYear.value = String(cur);
      elYear.onchange = function () { loadStats(parseInt(elYear.value, 10)); };
      return loadStats(cur);
    });
  }

  /* ---------- 登入 ---------- */
  function showLogin(msg) {
    elLogin.hidden = false;
    elMy.hidden = true;
    elAll.hidden = true;
    if (msg) {
      var e = $('login-error');
      e.textContent = msg;
      e.hidden = false;
    }
  }

  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var errEl = $('login-error'), btn = $('btn-login');
    errEl.hidden = true; btn.disabled = true;
    var email = $('email').value.trim(), pw = $('password').value;

    A.signIn(email, pw).then(function (session) {
      return loadProfile(session.user.id).then(function (profile) {
        if (!profile) {
          return A.signOut().then(function () { throw new Error('這個帳號沒有對應的教師資料，請洽系辦（分機 2102）。'); });
        }
        $('password').value = '';
        enter(session, profile);
        A.toast('登入成功', 'ok');
      });
    }).catch(function (err) {
      errEl.textContent = friendlyAuthError(err);
      errEl.hidden = false;
    }).then(function () { btn.disabled = false; });
  });

  function loadProfile(uid) {
    return sb.from('profiles').select('id,email,full_name,role').eq('id', uid)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || null;
      });
  }

  /* ---------- 進入已登入狀態 ---------- */
  function enter(session, profile) {
    me = { session: session, profile: profile, admin: A.isAdmin(session) };

    elLogin.hidden = true;
    elMy.hidden = false;
    elAll.hidden = false;

    $('who').textContent = profile.full_name || profile.email || '（未命名）';
    var roleEl = $('who-role');
    roleEl.hidden = false;
    roleEl.textContent = me.admin ? '系辦管理員' : '教師';

    /* 姓名不在名冊中 → 不能寫入 */
    var onRoster = !!(profile.full_name && profile.full_name.trim());
    if (!onRoster) {
      elForm.querySelectorAll('input,select,textarea,button').forEach(function (n) { n.disabled = true; });
      var warn = $('e-form');
      warn.hidden = false;
      warn.textContent = '您的帳號不在教師名冊中，無法新增記錄。請洽系辦（分機 2102）。';
    }

    /* 管理員才顯示「代輸入」的教師選單 */
    if (me.admin && onRoster) {
      $('wrap-teacher').hidden = false;
      f.teacher.innerHTML = '<option value="">— 選擇教師 —</option>' +
        roster.map(function (r) {
          return '<option value="' + esc(r.email) + '">' + esc(r.full_name) +
                 (r.title ? '（' + esc(r.title) + '）' : '') + '</option>';
        }).join('');
    }

    f.date.value = today();
    f.date.max = today();
    loadMyRecords();
    loadAllRecords();
  }

  $('btn-logout').addEventListener('click', function () {
    A.signOut().then(function () {
      me = null;
      $('record-form').reset();
      resetForm();
      elMy.hidden = true; elAll.hidden = true;
      showLogin();
      A.toast('已登出');
    });
  });

  /* ============================================================
   * 區塊 B：統計（公開，不需要登入）
   * ============================================================ */
  function loadStats(year) {
    elChartError.hidden = true;
    return sb.rpc('record_stats', { p_year: year }).then(function (res) {
      if (res.error) {
        if (A.isMissingTable(res.error)) { missingTableHint(elChartError); }
        else { elChartError.hidden = false; elChartError.textContent = '統計載入失敗：' + res.error.message; }
        return;
      }
      statsRows = res.data || [];
      renderChart();
    });
  }

  function renderChart() {
    var hasData = statsRows.some(function (r) { return r.total_count > 0; });

    if (!statsRows.length || !hasData) {
      elChartWrap.hidden = true;
      elChartEmpty.hidden = false;
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    elChartEmpty.hidden = true;
    elChartWrap.hidden = false;

    var labels = statsRows.map(function (r) { return r.teacher_name; });
    var enroll = statsRows.map(function (r) { return r.enrollment_count; });
    var duty = statsRows.map(function (r) { return r.duty_count; });

    /* 手機：每根柱子至少 52px，不夠寬就讓外層橫向捲動 */
    var need = labels.length * 52;
    var avail = elChartWrap.clientWidth || 600;
    var w = Math.max(need, avail);

    elChartWrap.innerHTML =
      '<div class="chart-inner" style="position:relative;height:320px;width:' + w + 'px">' +
      '<canvas id="chart"></canvas></div>';

    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart($('chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '招生', data: enroll, backgroundColor: TYPE_COLOR.enrollment, stack: 's' },
          { label: '公差', data: duty, backgroundColor: TYPE_COLOR.duty, stack: 's' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            stacked: true,
            ticks: { autoSkip: false, maxRotation: 60, minRotation: 0, font: { size: 12 } },
            grid: { display: false }
          },
          y: {
            stacked: true, beginAtZero: true,
            ticks: { precision: 0, stepSize: 1 },
            title: { display: true, text: '次數' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return items[0].label; },
              label: function (c) { return c.dataset.label + '：' + c.parsed.y + ' 次'; },
              footer: function (items) {
                var t = items.reduce(function (s, i) { return s + (i.parsed.y || 0); }, 0);
                return '合計：' + t + ' 次';
              }
            }
          }
        }
      }
    });
  }

  /* ---------- CSV 匯出（UTF-8 BOM，Excel 開中文不亂碼） ---------- */
  $('btn-csv').addEventListener('click', function () {
    if (!statsRows.length) { A.toast('目前沒有可匯出的資料', 'error'); return; }
    var year = elYear.value;
    var lines = [['教師姓名', '招生次數', '公差次數', '合計']];
    statsRows.forEach(function (r) {
      lines.push([r.teacher_name, r.enrollment_count, r.duty_count, r.total_count]);
    });
    var csv = lines.map(function (row) {
      return row.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');

    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'teacher_records_' + year + '學年度.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    A.toast('已匯出 ' + year + ' 學年度統計', 'ok');
  });

  /* ============================================================
   * 區塊 A：我的記錄
   * ============================================================ */
  function resetForm() {
    f.id.value = '';
    f.type.value = 'enrollment';
    f.date.value = today();
    f.desc.value = '';
    f.loc.value = '';
    f.note.value = '';
    if (me && me.admin) f.teacher.value = '';
    $('form-title').textContent = me && me.admin ? '新增記錄（可代輸入）' : '新增記錄';
    $('btn-save').textContent = '新增';
    $('btn-cancel').hidden = true;
    $('e-desc').hidden = true;
    $('e-form').hidden = true;
  }

  $('btn-cancel').addEventListener('click', resetForm);

  elForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!me) return;
    $('e-desc').hidden = true; $('e-form').hidden = true;

    var desc = f.desc.value.trim();
    if (!desc) { $('e-desc').textContent = '事由說明必填。'; $('e-desc').hidden = false; f.desc.focus(); return; }
    if (!f.date.value) { A.toast('請選擇日期', 'error'); return; }
    if (f.date.value > today()) { A.toast('不可填寫未來的日期', 'error'); return; }

    /* 決定這筆記錄屬於誰 */
    var teacherId = me.session.user.id;
    var enteredByAdmin = false;
    if (me.admin && f.teacher.value) {
      var picked = roster.filter(function (r) { return r.email === f.teacher.value; })[0];
      if (!picked) { A.toast('請選擇教師', 'error'); return; }
      var prof = null;
      /* 管理員代輸入：需要該教師的 profile id */
      return sb.from('profiles').select('id').eq('email', f.teacher.value.toLowerCase())
        .maybeSingle().then(function (res) {
          if (!res.data) {
            A.toast('這位教師還沒有帳號，請先在 Supabase 建立', 'error');
            return;
          }
          submitRecord(res.data.id, true);
        });
    }
    submitRecord(teacherId, enteredByAdmin);
  });

  function submitRecord(teacherId, enteredByAdmin) {
    var payload = {
      teacher_id: teacherId,
      record_type: f.type.value,
      record_date: f.date.value,
      description: f.desc.value.trim(),
      location: f.loc.value.trim() || null,
      note: f.note.value.trim() || null,
      entered_by_admin: enteredByAdmin
      /* teacher_name / academic_year 由資料庫 trigger 決定，這裡不送 */
    };
    var id = f.id.value;
    var btn = $('btn-save');
    btn.disabled = true;

    var q = id
      ? sb.from('teacher_records').update(payload).eq('id', id)
      : sb.from('teacher_records').insert(payload);

    return q.select().then(function (res) {
      btn.disabled = false;
      if (res.error) {
        var msg = res.error.message || String(res.error);
        if (/不在教師名冊/.test(msg)) msg = '您的帳號不在教師名冊中，無法新增記錄。';
        if (/未來/.test(msg)) msg = '不可填寫未來的日期。';
        A.toast('儲存失敗：' + msg, 'error');
        return;
      }
      A.toast(id ? '已更新' : '已新增', 'ok');
      resetForm();
      loadMyRecords();
      loadAllRecords();
      loadYears();
    });
  }

  function loadMyRecords() {
    if (!me) return;
    elMyError.hidden = true;
    var q = sb.from('teacher_records').select('*').order('record_date', { ascending: false });

    /* 管理員：顯示全部（方便管理）；教師：只顯示自己的 */
    if (!me.admin) q = q.eq('teacher_id', me.session.user.id);

    return q.limit(200).then(function (res) {
      if (res.error) {
        if (A.isMissingTable(res.error)) missingTableHint(elMyError);
        else { elMyError.hidden = false; elMyError.textContent = '載入失敗：' + res.error.message; }
        return;
      }
      var rows = res.data || [];
      $('my-count').textContent = '（' + rows.length + ' 筆）';
      elMyEmpty.hidden = rows.length > 0;
      elMyList.innerHTML = rows.map(function (r) { return recordLi(r, true); }).join('');
      bindActions(elMyList);
    });
  }

  function recordLi(r, showActions) {
    var color = TYPE_COLOR[r.record_type] || '#64748B';
    var canEdit = me && (me.admin || r.teacher_id === me.session.user.id);
    var acts = (showActions && canEdit)
      ? '<div class="ev-actions">' +
          '<button class="btn" data-act="edit" data-id="' + esc(r.id) + '">編輯</button>' +
          '<button class="btn btn-danger" data-act="del" data-id="' + esc(r.id) + '">刪除</button>' +
        '</div>'
      : '';
    return '<li>' +
      '<span class="ev-dot" style="background:' + color + '"></span>' +
      '<div class="ev-main">' +
        '<strong>' + esc(r.description) + '</strong>' +
        '<small>' +
          esc(TYPE_LABEL[r.record_type] || r.record_type) + '｜' +
          esc(r.record_date) + '｜' + esc(r.teacher_name) +
          '｜' + esc(r.academic_year) + ' 學年度' +
          (r.location ? '｜' + esc(r.location) : '') +
          (r.note ? '｜' + esc(r.note) : '') +
          (r.entered_by_admin ? ' <span class="tag-admin">由管理員代輸入</span>' : '') +
        '</small>' +
      '</div>' + acts + '</li>';
  }

  function bindActions(container) {
    container.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        if (b.getAttribute('data-act') === 'edit') startEdit(id);
        else askDelete(id);
      });
    });
  }

  function startEdit(id) {
    sb.from('teacher_records').select('*').eq('id', id).maybeSingle().then(function (res) {
      if (res.error || !res.data) { A.toast('找不到這筆記錄', 'error'); return; }
      var r = res.data;
      f.id.value = r.id;
      f.type.value = r.record_type;
      f.date.value = r.record_date;
      f.desc.value = r.description;
      f.loc.value = r.location || '';
      f.note.value = r.note || '';
      $('form-title').textContent = '編輯記錄（' + r.teacher_name + '）';
      $('btn-save').textContent = '儲存變更';
      $('btn-cancel').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function askDelete(id) {
    pendingDelete = id;
    $('confirm-text').textContent = '刪除後無法復原，確定要刪除這筆記錄嗎？';
    $('confirm').classList.add('show');
  }
  $('c-no').addEventListener('click', function () {
    pendingDelete = null; $('confirm').classList.remove('show');
  });
  $('c-yes').addEventListener('click', function () {
    if (!pendingDelete) return;
    var id = pendingDelete, btn = $('c-yes');
    btn.disabled = true;
    sb.from('teacher_records').delete().eq('id', id).then(function (res) {
      btn.disabled = false;
      $('confirm').classList.remove('show');
      pendingDelete = null;
      if (res.error) { A.toast('刪除失敗：' + res.error.message, 'error'); return; }
      A.toast('已刪除', 'ok');
      loadMyRecords(); loadAllRecords(); loadYears();
    });
  });

  /* ============================================================
   * 區塊 C：全部記錄
   * ============================================================ */
  function initFilters() {
    var cur = currentYear();
    var list = [cur, cur - 1, cur - 2];
    $('flt-year').innerHTML = '<option value="">全部學年度</option>' +
      list.map(function (y) { return '<option value="' + y + '">' + y + ' 學年度</option>'; }).join('');
    $('flt-year').value = String(cur);

    $('flt-teacher').innerHTML = '<option value="">全部教師</option>' +
      roster.map(function (r) {
        return '<option value="' + esc(r.email) + '">' + esc(r.full_name) + '</option>';
      }).join('');

    ['flt-year', 'flt-type', 'flt-teacher'].forEach(function (id) {
      $(id).addEventListener('change', function () { allPage = 1; loadAllRecords(); });
    });
    $('pg-prev').addEventListener('click', function () { if (allPage > 1) { allPage--; loadAllRecords(); } });
    $('pg-next').addEventListener('click', function () {
      if (allPage * PAGE_SIZE < allTotal) { allPage++; loadAllRecords(); }
    });
  }

  function loadAllRecords() {
    if (!me) return;
    if (!elAllList._init) { initFilters(); elAllList._init = true; }

    elAllError.hidden = true;
    var from = (allPage - 1) * PAGE_SIZE;
    var y = $('flt-year').value;
    var t = $('flt-type').value;
    var teachEmail = $('flt-teacher').value;

    function build(teacherId) {
      var q = sb.from('teacher_records')
        .select('*', { count: 'exact' })
        .order('record_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (y) q = q.eq('academic_year', parseInt(y, 10));
      if (t) q = q.eq('record_type', t);
      if (teacherId) q = q.eq('teacher_id', teacherId);

      return q.range(from, from + PAGE_SIZE - 1).then(function (res) {
        if (res.error) {
          if (A.isMissingTable(res.error)) missingTableHint(elAllError);
          else { elAllError.hidden = false; elAllError.textContent = '載入失敗：' + res.error.message; }
          return;
        }
        var rows = res.data || [];
        allTotal = (res.count == null) ? rows.length : res.count;
        elAllEmpty.hidden = rows.length > 0;
        elAllList.innerHTML = rows.map(function (r) { return recordLi(r, false); }).join('');
        $('all-count').textContent = '共 ' + allTotal + ' 筆';

        var pages = Math.max(1, Math.ceil(allTotal / PAGE_SIZE));
        $('pager').hidden = allTotal <= PAGE_SIZE;
        $('pg-info').textContent = '第 ' + allPage + ' / ' + pages + ' 頁';
        $('pg-prev').disabled = allPage <= 1;
        $('pg-next').disabled = allPage >= pages;
      });
    }

    function showNone() {
      elAllList.innerHTML = '';
      elAllEmpty.hidden = false;
      $('all-count').textContent = '共 0 筆';
      $('pager').hidden = true;
    }

    /* 依教師 email 篩選：先查出對應的 profile id 再查記錄 */
    if (teachEmail) {
      return sb.from('profiles').select('id').eq('email', teachEmail.toLowerCase())
        .maybeSingle().then(function (res) {
          if (res.error || !res.data) { showNone(); return; }
          return build(res.data.id);
        });
    }
    return build(null);
  }

  /* ============================================================
   * 修改密碼
   * ============================================================ */
  $('btn-pw').addEventListener('click', function () {
    $('pw1').value = ''; $('pw2').value = '';
    $('pw-error').hidden = true;
    $('pw-modal').classList.add('show');
    $('pw1').focus();
  });
  $('pw-cancel').addEventListener('click', function () { $('pw-modal').classList.remove('show'); });

  $('pw-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var p1 = $('pw1').value, p2 = $('pw2').value, errEl = $('pw-error');
    errEl.hidden = true;
    if (p1.length < 6) { errEl.textContent = '密碼至少 6 個字元。'; errEl.hidden = false; return; }
    if (p1 !== p2) { errEl.textContent = '兩次輸入的密碼不一樣。'; errEl.hidden = false; return; }

    var btn = $('pw-save'); btn.disabled = true;
    sb.auth.updateUser({ password: p1 }).then(function (res) {
      btn.disabled = false;
      if (res.error) { errEl.textContent = res.error.message; errEl.hidden = false; return; }
      $('pw-modal').classList.remove('show');
      A.toast('密碼已更新', 'ok');
    });
  });

  /* 視窗大小改變時重畫圖表（維持最小柱寬） */
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (chart) renderChart(); }, 250);
  });
})();
