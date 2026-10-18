/* ============================================================
 * 管理後台（admin.html）
 * 登入 → 事件列表 → 新增 / 編輯 / 刪除
 * 前端只負責「顯示」與「送出」；真正的權限由資料庫 RLS 把關
 * （非管理員就算繞過畫面直接呼叫 API，也會被拒絕）。
 * ============================================================ */
(function () {
  'use strict';
  var A = window.App;
  var cfg = A.cfg;
  var sb = A.sb;

  var elLogin = document.getElementById('login-card');
  var elPanel = document.getElementById('panel');
  var elBooting = document.getElementById('booting');
  var elFormCard = document.getElementById('form-card');
  var elFormTitle = document.getElementById('form-title');
  var form = document.getElementById('event-form');
  var elList = document.getElementById('list');
  var elListEmpty = document.getElementById('list-empty');
  var elListError = document.getElementById('list-error');
  var elListLoading = document.getElementById('list-loading');
  var elWho = document.getElementById('who');

  var f = {
    id: document.getElementById('f-id'),
    title: document.getElementById('f-title'),
    category: document.getElementById('f-category'),
    visibility: document.getElementById('f-visibility'),
    allday: document.getElementById('f-allday'),
    startDate: document.getElementById('f-start-date'),
    startTime: document.getElementById('f-start-time'),
    endDate: document.getElementById('f-end-date'),
    endTime: document.getElementById('f-end-time'),
    lineNotify: document.getElementById('f-line-notify'),
    location: document.getElementById('f-location'),
    description: document.getElementById('f-description')
  };

  /* 類別選單 */
  Object.keys(cfg.CATEGORIES).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k;
    o.textContent = cfg.CATEGORIES[k].label + '（' + k + '）';
    f.category.appendChild(o);
  });

  /* ---------- 啟動 ---------- */
  /* LINE 登入還沒開通（provider 未設定）→ 把按鈕與分隔線一起收起來 */
  if (!A.lineEnabled()) A.hideLineUi();

  A.getSession().then(function (session) {
    elBooting.hidden = true;
    if (A.isAdmin(session)) {
      showPanel(session);
    } else if (A.takeOauthIntent() === 'login') {
      /* 從 LINE 回來但沒有 session ＝ 這個 LINE 帳號還沒綁定過任何帳號 */
      showLogin('這個 LINE 帳號還沒綁定過。請先用上方帳密登入一次，完成綁定後就能用 LINE 一鍵登入。');
    } else {
      showLogin();
    }
  });

  function showLogin(msg) {
    elPanel.hidden = true;
    elLogin.hidden = false;
    if (msg) {
      var e = document.getElementById('login-error');
      e.textContent = msg;
      e.hidden = false;
    }
    document.getElementById('email').focus();
  }

  /* LINE 登入（只有已綁定的帳號能用；綁定在「公差/招生記錄」頁做） */
  document.getElementById('btn-line-login').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    A.signInWithLine().catch(function (err) {
      btn.disabled = false;
      var e = document.getElementById('login-error');
      e.textContent = 'LINE 登入無法啟動：' + ((err && err.message) || '請稍後再試');
      e.hidden = false;
    });
  });

  function showPanel(session) {
    elLogin.hidden = true;
    elPanel.hidden = false;
    elWho.textContent = session.user.email;
    resetForm();
    loadList();
  }

  /* ---------- 登入 ---------- */
  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('btn-login');
    errEl.hidden = true;
    btn.disabled = true;

    var email = document.getElementById('email').value.trim();
    var pass = document.getElementById('password').value;

    A.signIn(email, pass).then(function (session) {
      if (!A.isAdmin(session)) {
        /* 不是管理員 → 立刻登出，不留在半登入狀態 */
        return A.signOut().then(function () {
          throw new Error('這個帳號沒有管理權限。');
        });
      }
      document.getElementById('password').value = '';
      showPanel(session);
      A.toast('登入成功', 'ok');
    }).catch(function (err) {
      errEl.textContent = friendlyAuthError(err);
      errEl.hidden = false;
    }).then(function () {
      btn.disabled = false;
    });
  });

  function friendlyAuthError(err) {
    var m = String((err && err.message) || err);
    if (/Invalid login credentials/i.test(m)) return '電子郵件或密碼不正確。';
    if (/Email not confirmed/i.test(m)) return '這個帳號尚未完成驗證。';
    if (/rate limit|too many/i.test(m)) return '嘗試次數過多，請稍後再試。';
    return m;
  }

  document.getElementById('btn-logout').addEventListener('click', function () {
    A.signOut().then(function () {
      showLogin();
      A.toast('已登出');
    });
  });

  /* ---------- 表單 ---------- */
  function resetForm() {
    form.reset();
    f.id.value = '';
    f.category.value = 'meeting';
    f.visibility.value = 'department';
    f.allday.checked = false;
    f.lineNotify.checked = true;       /* LINE 通知預設打勾 */
    var today = A.tzParts(new Date().toISOString()).date;
    f.startDate.value = today;
    f.endDate.value = today;
    f.startTime.value = '09:00';
    f.endTime.value = '10:00';
    elFormTitle.textContent = '新增事件';
    document.getElementById('btn-save').textContent = '新增';
    clearErrors();
    toggleAllDay();
  }

  function clearErrors() {
    ['e-title', 'e-time'].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
    document.getElementById('login-error').hidden = true;
  }

  function toggleAllDay() {
    var on = f.allday.checked;
    document.getElementById('wrap-start-time').hidden = on;
    document.getElementById('wrap-end-time').hidden = on;
  }
  f.allday.addEventListener('change', toggleAllDay);

  document.getElementById('btn-new').addEventListener('click', function () {
    resetForm();
    elFormCard.hidden = false;
    elFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.title.focus();
  });

  document.getElementById('btn-cancel').addEventListener('click', function () {
    elFormCard.hidden = true;
    resetForm();
  });

  /* ---------- 載入列表 ---------- */
  function loadList() {
    elListLoading.hidden = false;
    elListError.hidden = true;
    elList.innerHTML = '';
    elListEmpty.hidden = true;

    sb.from('events').select('*')
      .order('start_at', { ascending: false })
      .limit(500)
      .then(function (res) {
        elListLoading.hidden = true;
        if (res.error) {
          elListError.hidden = false;
          if (A.isMissingTable(res.error)) {
            elListError.innerHTML = '資料表尚未建立。<br>請先在 Supabase 執行 <code>supabase/migration.sql</code>。';
          } else {
            elListError.innerHTML = '載入失敗：<code>' + String(res.error.message) + '</code>';
          }
          return;
        }
        var rows = res.data || [];
        elListEmpty.hidden = rows.length > 0;
        rows.forEach(function (r) { elList.appendChild(listItem(r)); });
      });
  }

  function listItem(r) {
    var c = A.cat(r.category);
    var li = document.createElement('li');

    var dot = document.createElement('span');
    dot.className = 'ev-dot';
    dot.style.background = c.color;

    var main = document.createElement('div');
    main.className = 'ev-main';
    var strong = document.createElement('strong');
    strong.textContent = r.title;
    var small = document.createElement('small');
    small.textContent = A.fmtRange(r) + '｜' + c.label +
      (r.location ? '｜' + r.location : '') +
      (r.visibility === 'private' ? '｜private' : '');
    main.appendChild(strong);
    main.appendChild(small);

    var acts = document.createElement('div');
    acts.className = 'ev-actions';

    var bEdit = document.createElement('button');
    bEdit.className = 'btn';
    bEdit.type = 'button';
    bEdit.textContent = '編輯';
    bEdit.addEventListener('click', function () { editRow(r); });

    var bDel = document.createElement('button');
    bDel.className = 'btn btn-danger';
    bDel.type = 'button';
    bDel.textContent = '刪除';
    bDel.addEventListener('click', function () { askDelete(r); });

    acts.appendChild(bEdit);
    acts.appendChild(bDel);

    li.appendChild(dot);
    li.appendChild(main);
    li.appendChild(acts);
    return li;
  }

  /* ---------- 編輯 ---------- */
  function editRow(r) {
    var s = A.tzParts(r.start_at);
    var e = A.tzParts(r.end_at);
    f.id.value = r.id;
    f.title.value = r.title;
    f.category.value = r.category || 'other';
    f.visibility.value = r.visibility || 'department';
    f.allday.checked = !!r.all_day;
    f.lineNotify.checked = (r.line_notify === undefined || r.line_notify === null)
      ? true : !!r.line_notify;
    f.startDate.value = s.date;
    f.startTime.value = s.time;
    f.endDate.value = e.date;
    f.endTime.value = e.time;
    f.location.value = r.location || '';
    f.description.value = r.description || '';
    elFormTitle.textContent = '編輯事件';
    document.getElementById('btn-save').textContent = '儲存變更';
    clearErrors();
    toggleAllDay();
    elFormCard.hidden = false;
    elFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 儲存 ---------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();

    var title = f.title.value.trim();
    if (!title) {
      showFieldError('e-title', '標題必填。');
      f.title.focus();
      return;
    }
    if (!f.startDate.value || !f.endDate.value) {
      showFieldError('e-time', '開始與結束日期都要填。');
      return;
    }

    var allDay = f.allday.checked;
    var startIso = allDay
      ? A.tzToIso(f.startDate.value, '00:00')
      : A.tzToIso(f.startDate.value, f.startTime.value);
    var endIso = allDay
      ? A.tzToIso(f.endDate.value, '23:59')
      : A.tzToIso(f.endDate.value, f.endTime.value);

    if (new Date(endIso) < new Date(startIso)) {
      showFieldError('e-time', '結束時間不可以早於開始時間。');
      return;
    }

    var payload = {
      title: title,
      category: f.category.value,
      visibility: f.visibility.value,
      all_day: allDay,
      start_at: startIso,
      end_at: endIso,
      location: f.location.value.trim() || null,
      description: f.description.value.trim() || null,
      line_notify: f.lineNotify.checked
    };

    var btn = document.getElementById('btn-save');
    btn.disabled = true;

    var id = f.id.value;
    var q = id
      ? sb.from('events').update(payload).eq('id', id)
      : sb.from('events').insert(payload);

    q.select().then(function (res) {
      btn.disabled = false;
      if (res.error) {
        A.toast('儲存失敗：' + res.error.message, 'error');
        if (A.isMissingTable(res.error)) {
          elListError.hidden = false;
          elListError.innerHTML = '資料表尚未建立。<br>請先在 Supabase 執行 <code>supabase/migration.sql</code>。';
        }
        return;
      }
      A.toast(id ? '已更新' : '已新增', 'ok');
      elFormCard.hidden = true;
      resetForm();
      loadList();
    });
  });

  function showFieldError(id, msg) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.hidden = false;
  }

  /* ---------- 刪除（二次確認） ---------- */
  var pendingDelete = null;

  function askDelete(r) {
    pendingDelete = r;
    document.getElementById('confirm-text').textContent =
      '「' + r.title + '」（' + A.fmtRange(r) + '）';
    document.getElementById('confirm').classList.add('show');
  }

  document.getElementById('c-no').addEventListener('click', function () {
    pendingDelete = null;
    document.getElementById('confirm').classList.remove('show');
  });

  document.getElementById('c-yes').addEventListener('click', function () {
    if (!pendingDelete) return;
    var id = pendingDelete.id;
    var btn = document.getElementById('c-yes');
    btn.disabled = true;
    sb.from('events').delete().eq('id', id).then(function (res) {
      btn.disabled = false;
      document.getElementById('confirm').classList.remove('show');
      pendingDelete = null;
      if (res.error) {
        A.toast('刪除失敗：' + res.error.message, 'error');
        return;
      }
      A.toast('已刪除', 'ok');
      loadList();
    });
  });
})();
