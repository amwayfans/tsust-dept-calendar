/* ============================================================
 * 調查專區（survey.html）
 *
 * 兩個角色共用同一頁：
 *   老師 —— 勾選選項 → 送出 → 看「各選項人數」（不含姓名）
 *   系辦 —— 建立調查、開關、刪除、統計、匯出 CSV 給系主任
 *
 * 重要原則：
 *   - 前端只負責「顯示」與「送出」，統計數字一律走資料庫的
 *     survey_stats()／survey_export()，不自己在瀏覽器加總。
 *   - 姓名只有管理員拿得到（survey_export 內有 is_admin() 把關），
 *     老師看到的統計永遠只有人數。
 * ============================================================ */
(function () {
  'use strict';

  var A = window.App;
  var sb = A.sb;

  var $ = function (id) { return document.getElementById(id); };
  var elLogin = $('login-card'), elMy = $('my-section'), elAdmin = $('admin-section');
  var elBooting = $('booting');
  var elWrap = $('surveys-wrap'), elNoSurvey = $('no-survey'), elMyError = $('my-error');
  var elAdminList = $('admin-list'), elAdminEmpty = $('admin-empty'), elAdminError = $('admin-error');
  var elExportCard = $('export-card'), elExportBody = $('export-body'), elExportTitle = $('export-title');
  var elIntro = $('survey-intro');

  var me = null;            // { session, profile, isAdmin }
  var surveys = [];         // 目前開放的調查
  var optionsBySurvey = {}; // survey_id -> [options]
  var myBySurvey = {};      // survey_id -> response
  var allSurveys = [];      // 管理員用：全部調查
  var exportSurvey = null;  // 目前匯出中的調查

  /* ============================================================
   * 啟動
   * ============================================================ */
  if (!A.lineEnabled()) A.hideLineUi();

  Promise.all([A.getSession()]).then(function (r) {
    var session = r[0];
    elBooting.hidden = true;
    var oauthIntent = A.takeOauthIntent();
    var oerr = A.oauthReturnError();

    if (session && session.user) {
      return loadProfile(session.user.id).then(function (profile) {
        if (profile) { enter(session, profile); }
        else {
          return A.signOut().then(function () {
            showLogin('這個帳號沒有對應的教師資料，請洽系辦。');
          });
        }
      });
    }
    if (oauthIntent === 'login') {
      showLogin('這個 LINE 帳號還沒綁定過。請先用上方帳密登入一次，完成綁定後就能用 LINE 一鍵登入。');
    } else if (oerr) {
      showLogin('LINE 登入未完成（' + oerr.code + '）。請改用帳密登入，或洽系辦（分機 2102）。');
    } else {
      showLogin();
    }
  }).catch(function (err) {
    elBooting.hidden = true;
    showLogin();
    if (A.isMissingTable(err)) {
      elMyError.hidden = false;
      elMyError.innerHTML = '調查功能的資料表尚未建立。<br>請先在 Supabase 執行 '
        + '<code>supabase/migration_survey.sql</code> 與 <code>seed_survey_deepfarm.sql</code>。';
    }
  });

  function loadProfile(uid) {
    return sb.from('profiles').select('id,email,full_name,role,avatar_url').eq('id', uid)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || null;
      });
  }

  /* ---------- 登入畫面 ---------- */
  function showLogin(msg) {
    elLogin.hidden = false;
    elMy.hidden = true;
    elAdmin.hidden = true;
    $('who-chip').hidden = true;
    $('menu-user').hidden = true;
    var e = $('login-error');
    if (msg) { e.textContent = msg; e.hidden = false; } else { e.hidden = true; }
  }

  /* ---------- 進入已登入狀態 ---------- */
  function enter(session, profile) {
    me = { session: session, profile: profile, isAdmin: A.isAdmin(session) };
    elLogin.hidden = true;
    elMy.hidden = false;

    $('who-chip').hidden = false;
    $('menu-user').hidden = false;
    $('who').textContent = profile.full_name || profile.email || '—';
    var role = A.roleLabel(profile);
    var elRole = $('who-role');
    if (role) { elRole.textContent = role; elRole.hidden = false; } else { elRole.hidden = true; }
    $('who-avatar').innerHTML = A.avatarHtml(profile.full_name || profile.email,
                                             profile.avatar_url, 'avatar-md');

    if (me.isAdmin) elAdmin.hidden = false;

    refreshLineBind();
    if (me.isAdmin) loadAdminList();
    return loadTeacherView();
  }

  /* ============================================================
   * 老師視角
   * ============================================================ */
  function loadTeacherView() {
    elMyError.hidden = true;
    return sb.from('surveys')
      .select('id,title,description,status,multi,max_choices,show_stats,allow_edit,deadline,sort_order')
      .eq('status', 'open')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        surveys = res.data || [];
        if (!surveys.length) {
          elWrap.innerHTML = '';
          elNoSurvey.hidden = false;
          elIntro.textContent = '目前沒有開放填寫的調查。';
          return;
        }
        elNoSurvey.hidden = true;
        elIntro.textContent = '請勾選您的意願，送出後可以再修改。';
        var ids = surveys.map(function (s) { return s.id; });
        return Promise.all([
          sb.from('survey_options').select('*').in('survey_id', ids).eq('active', true)
            .order('sort_order', { ascending: true }).order('label', { ascending: true }),
          sb.from('survey_responses').select('*').eq('profile_id', me.profile.id).in('survey_id', ids)
        ]).then(function (rs) {
          if (rs[0].error) throw rs[0].error;
          if (rs[1].error) throw rs[1].error;
          optionsBySurvey = {};
          (rs[0].data || []).forEach(function (o) {
            (optionsBySurvey[o.survey_id] = optionsBySurvey[o.survey_id] || []).push(o);
          });
          myBySurvey = {};
          (rs[1].data || []).forEach(function (r) { myBySurvey[r.survey_id] = r; });
          renderSurveys();
        });
      })
      .catch(showError);
  }

  function renderSurveys() {
    elWrap.innerHTML = '';
    surveys.forEach(function (s) {
      elWrap.appendChild(buildSurveyCard(s));
    });
  }

  function buildSurveyCard(s) {
    var opts = optionsBySurvey[s.id] || [];
    var mine = myBySurvey[s.id] || null;
    var chosen = (mine && mine.option_ids) || [];
    var closed = s.deadline && new Date(s.deadline).getTime() < Date.now();
    var locked = !s.allow_edit && !!mine;

    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-sec', closed ? 'other' : 'blue');

    var h = '';
    h += '<h2 style="margin-top:0">' + A.esc(s.title) + '</h2>';
    if (s.description) h += '<p class="hint" style="margin-top:-6px">' + A.esc(s.description) + '</p>';

    var meta = [];
    meta.push(s.multi ? (s.max_choices ? '可複選，最多 ' + s.max_choices + ' 個' : '可複選，不限數量') : '單選');
    if (s.deadline) meta.push('截止：' + A.tzParts(s.deadline).date + ' ' + A.tzParts(s.deadline).time);
    meta.push(mine ? '已於 ' + A.tzParts(mine.updated_at).date + ' 送出' : '尚未填寫');
    if (closed) meta.push('已截止');
    else if (locked) meta.push('送出後鎖定');
    h += '<p class="hint" style="margin:0 0 12px">' + A.esc(meta.join('　·　')) + '</p>';

    /* 已送出過 → 明確顯示「您目前選了什麼」，並告訴老師可以回去改。
       使用者特別要求：老師看完統計後要能變更選項，所以這一段不能省。 */
    if (mine) {
      var myLabels = [];
      chosen.forEach(function (id) {
        opts.forEach(function (o) { if (o.id === id) myLabels.push(o.label); });
      });
      h += '<div class="sv-mine">'
        + '<span class="sv-mine-tag">您目前的選擇</span>'
        + '<span class="sv-mine-list">'
        + (myLabels.length ? A.esc(myLabels.join('、')) : '（尚未勾選）')
        + '</span></div>';
      if (!closed && !locked) {
        h += '<p class="hint" style="margin:0 0 12px">'
          + '要調整很簡單：直接在下面重新勾選，再按「修改我的選擇」即可，不影響其他老師。'
          + '</p>';
      }
    }

    h += '<div class="sv-options">';
    opts.forEach(function (o) {
      var checked = chosen.indexOf(o.id) >= 0;
      h += '<label class="sv-opt' + (checked ? ' is-checked' : '') + '">'
        + '<input type="' + (s.multi ? 'checkbox' : 'radio') + '" name="sv-' + s.id + '"'
        + ' value="' + o.id + '"' + (checked ? ' checked' : '')
        + (closed || locked ? ' disabled' : '') + '>'
        + '<span class="sv-opt-body"><span class="sv-opt-label">' + A.esc(o.label) + '</span>'
        + (o.note ? '<span class="sv-opt-note">' + A.esc(o.note) + '</span>' : '')
        + '</span></label>';
    });
    h += '</div>';

    h += '<div class="field" style="margin-top:12px">'
      + '<label for="note-' + s.id + '">備註 <span class="hint">（選填，例如想補充的說明）</span></label>'
      + '<input type="text" id="note-' + s.id + '" maxlength="500"'
      + (closed || locked ? ' disabled' : '')
      + ' value="' + A.esc((mine && mine.note) || '') + '"></div>';

    h += '<div class="field-error" id="err-' + s.id + '" hidden></div>';
    h += '<div class="modal-actions" style="justify-content:flex-start">'
      + '<button class="btn btn-primary" type="button" data-act="save" data-sid="' + s.id + '"'
      + (closed || locked ? ' disabled' : '') + '>'
      + (mine ? '修改我的選擇' : '送出') + '</button>';
    /* 已填過的人要能把整筆作答清掉（實習／測試填錯、或想重新填） */
    if (mine && !locked) {
      h += '<button class="btn btn-danger" type="button" data-act="clear" data-sid="' + s.id + '">'
        + '清除我的作答</button>';
    }
    h += '<span class="hint" id="cnt-' + s.id + '" style="align-self:center"></span>'
      + '</div>';

    h += '<div class="sv-stats" id="stats-' + s.id + '" hidden></div>';
    card.innerHTML = h;

    /* 勾選時即時檢查數量上限 */
    card.querySelectorAll('input[name="sv-' + s.id + '"]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (s.max_choices) {
          var n = card.querySelectorAll('input[name="sv-' + s.id + '"]:checked').length;
          var c = $('cnt-' + s.id);
          c.textContent = n > s.max_choices ? '最多只能選 ' + s.max_choices + ' 個' : '已選 ' + n + ' 個';
          c.style.color = n > s.max_choices ? '#B91C1C' : '';
        }
        card.querySelectorAll('.sv-opt').forEach(function (lbl) {
          var i = lbl.querySelector('input');
          lbl.classList.toggle('is-checked', !!(i && i.checked));
        });
      });
    });

    card.querySelector('[data-act="save"]').addEventListener('click', function () {
      saveResponse(s, card);
    });

    var clearBtn = card.querySelector('[data-act="clear"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () { askClearResponse(s, card); });
    }

    /* 已送出且開放看統計 → 直接載入 */
    if (mine && s.show_stats) loadStats(s.id);
    return card;
  }

  function saveResponse(s, card) {
    var errEl = $('err-' + s.id);
    errEl.hidden = true;
    /* ⚠️ 這裡要自己取一次：`mine` 是 buildSurveyCard 的區域變數，不在這個函式的範圍內。
       在 upsert 之前先抓，才知道這次是「第一次送出」還是「修改」（訊息要分開講）。 */
    var mine = myBySurvey[s.id] || null;
    var ids = [];
    card.querySelectorAll('input[name="sv-' + s.id + '"]:checked').forEach(function (i) { ids.push(i.value); });
    if (!ids.length) { errEl.textContent = '請至少勾選一個選項。'; errEl.hidden = false; return; }
    if (!s.multi && ids.length > 1) { errEl.textContent = '這是單選題。'; errEl.hidden = false; return; }
    if (s.max_choices && ids.length > s.max_choices) {
      errEl.textContent = '最多只能選 ' + s.max_choices + ' 個。'; errEl.hidden = false; return;
    }

    var btn = card.querySelector('[data-act="save"]');
    btn.disabled = true;
    btn.textContent = '送出中…';

    sb.from('survey_responses').upsert({
      survey_id: s.id,
      profile_id: me.profile.id,
      option_ids: ids,
      note: ($('note-' + s.id).value || '').trim() || null
    }, { onConflict: 'survey_id,profile_id' }).then(function (res) {
      btn.disabled = false;
      btn.textContent = mine ? '修改我的選擇' : '送出';
      if (res.error) {
        errEl.textContent = '送出失敗：' + res.error.message;
        errEl.hidden = false;
        return;
      }
      A.toast(mine ? '已更新您的選擇' : '已送出，謝謝您');
      myBySurvey[s.id] = { survey_id: s.id, profile_id: me.profile.id, option_ids: ids, note: null, updated_at: new Date().toISOString() };
      return loadTeacherView().then(function () {
        if (s.show_stats) loadStats(s.id);
        if (me.isAdmin) loadAdminList();
      });
    });
  }

  /* 統計：只回人數，不含姓名（走資料庫函式，不自己在瀏覽器算） */
  function loadStats(surveyId) {
    var box = $('stats-' + surveyId);
    if (!box) return;
    return sb.rpc('survey_stats', { p_survey: surveyId }).then(function (res) {
      if (res.error) return;
      var rows = res.data || [];
      var total = 0;
      rows.forEach(function (r) { total += Number(r.cnt) || 0; });
      var max = 0;
      rows.forEach(function (r) { max = Math.max(max, Number(r.cnt) || 0); });
      var h = '<h3>目前各選項人數 <span class="hint">（不含姓名）</span></h3>';
      rows.forEach(function (r) {
        var n = Number(r.cnt) || 0;
        var pct = max ? Math.round(n / max * 100) : 0;
        h += '<div class="sv-stat-row"><span class="sv-stat-label">' + A.esc(r.label) + '</span>'
          + '<span class="sv-stat-bar"><i style="width:' + pct + '%"></i></span>'
          + '<span class="sv-stat-num">' + n + ' 人</span></div>';
      });
      h += '<p class="hint" style="margin:10px 0 0">共 ' + rows.length + ' 個選項、累計 ' + total
        + ' 人次勾選。看完想調整，直接回上面重新勾選，再按「修改我的選擇」即可。</p>';
      box.innerHTML = h;
      box.hidden = false;
    });
  }

  /* ============================================================
   * 管理員：建立 / 管理 / 匯出
   * ============================================================ */
  function loadAdminList() {
    elAdminError.hidden = true;
    return sb.from('surveys').select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        allSurveys = res.data || [];
        renderAdminList();
      })
      .catch(function (err) {
        elAdminError.hidden = false;
        elAdminError.textContent = '載入失敗：' + ((err && err.message) || String(err));
      });
  }

  function renderAdminList() {
    elAdminList.innerHTML = '';
    if (!allSurveys.length) { elAdminEmpty.hidden = false; return; }
    elAdminEmpty.hidden = true;

    allSurveys.forEach(function (s) {
      var li = document.createElement('li');
      var status = s.status === 'open' ? '開放中' : (s.status === 'closed' ? '已關閉' : '草稿');
      li.innerHTML = '<div class="ev-main"><div class="ev-title">' + A.esc(s.title)
        + ' <span class="hint">（' + status + '）</span></div>'
        + '<div class="ev-meta">' + (s.description ? A.esc(s.description) : '')
        + (s.deadline ? '　截止：' + A.tzParts(s.deadline).date + ' ' + A.tzParts(s.deadline).time : '')
        + '</div></div>'
        + '<div class="ev-actions">'
        + '<button class="btn" data-act="stat" data-sid="' + s.id + '">統計／匯出</button>'
        + '<button class="btn" data-act="toggle" data-sid="' + s.id + '">'
        + (s.status === 'open' ? '關閉' : '開放') + '</button>'
        + '<button class="btn btn-danger" data-act="del" data-sid="' + s.id + '"'
        + ' title="刪除整場調查（含所有人的作答）">刪除這場調查</button>'
        + '</div>';
      li.querySelector('[data-act="stat"]').addEventListener('click', function () { showExport(s); });
      li.querySelector('[data-act="toggle"]').addEventListener('click', function () { toggleSurvey(s); });
      li.querySelector('[data-act="del"]').addEventListener('click', function () { askDelete(s); });
      elAdminList.appendChild(li);
    });
  }

  function toggleSurvey(s) {
    var next = s.status === 'open' ? 'closed' : 'open';
    sb.from('surveys').update({ status: next }).eq('id', s.id).then(function (res) {
      if (res.error) { A.toast('更新失敗：' + res.error.message); return; }
      A.toast(next === 'open' ? '已開放填寫' : '已關閉');
      loadAdminList();
      loadTeacherView().catch(function () {});
    });
  }

  /* ------------------------------------------------------------
     共用的確認視窗
     ⚠️ 本站的 modal 要加 .show 才會顯示（styles.css 的 `.modal.show`）。
        這裡原本寫的是 classList.add('is-open')，那個 class 根本不存在 →
        視窗永遠不會出現，症狀就是「按了刪除完全沒反應」。
        以後新增任何 modal 一律用 'show'。
     ------------------------------------------------------------ */
  function askConfirm(title, text, onOk) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;   /* 用 textContent，換行靠 CSS 的 pre-line */
    var modal = $('confirm');
    var yes = $('c-yes');
    var no = $('c-no');
    function close(ok) {
      modal.classList.remove('show');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      if (ok) onOk();
    }
    function onYes() { close(true); }
    function onNo() { close(false); }
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    modal.classList.add('show');
    /* 刪除無法復原 → 焦點放在「取消」，不要讓人順手按 Enter 就刪掉 */
    setTimeout(function () { no.focus(); }, 60);
  }

  function askDelete(s) {
    askConfirm(
      '確定要刪除這場調查嗎？',
      '「' + s.title + '」會整場刪除，包括：\n'
        + '‧ 底下所有選項\n'
        + '‧ 所有老師的作答紀錄\n\n'
        + '刪除後無法復原，也無法從系統救回。\n\n'
        + '如果只是想停止收件，請改按「關閉」——\n'
        + '資料會完整保留，之後還能重新開放。',
      function () {
        sb.from('surveys').delete().eq('id', s.id).then(function (res) {
          if (res.error) { A.toast('刪除失敗：' + res.error.message); return; }
          A.toast('已刪除');
          if (exportSurvey && exportSurvey.id === s.id) { exportSurvey = null; elExportCard.hidden = true; }
          loadAdminList();
          loadTeacherView().catch(function () {});
        });
      });
  }

  /* 清除自己的作答（整筆刪除，回到「尚未填寫」） */
  function askClearResponse(s, card) {
    askConfirm(
      '確定要清除您的作答嗎？',
      '這會把您在「' + s.title + '」的作答整筆刪除：\n'
        + '‧ 您勾選的選項會被清空，回到「尚未填寫」\n'
        + '‧ 各校人數統計會跟著減少\n'
        + '‧ 其他老師的作答完全不受影響\n\n'
        + '清除後想再填，隨時重新勾選送出即可。',
      function () {
        var btn = card.querySelector('[data-act="save"]');
        if (btn) { btn.disabled = true; btn.textContent = '清除中…'; }
        sb.from('survey_responses')
          .delete()
          .eq('survey_id', s.id)
          .eq('profile_id', me.profile.id)
          .select()
          .then(function (res) {
            if (btn) btn.textContent = '修改我的選擇';
            if (res.error) {
              if (btn) btn.disabled = false;
              A.toast('清除失敗：' + res.error.message);
              return;
            }
            /* RLS 擋掉時不會回錯、只會回 0 筆 → 一定要自己看筆數 */
            if (!res.data || !res.data.length) {
              if (btn) btn.disabled = false;
              A.toast('清除失敗：沒有權限，或資料已經不存在');
              return;
            }
            A.toast('已清除您的作答');
            loadTeacherView().catch(function () {});
          });
      });
  }

  /* 解析「一行一個選項」，支援「標題｜註解」 */
  function parseOptions(text) {
    var out = [];
    (text || '').split('\n').forEach(function (line) {
      var v = line.replace(/\s+$/, '').trim();
      if (!v) return;
      var parts = v.split(/[｜|]/);
      var label = (parts[0] || '').trim();
      var note = parts.length > 1 ? parts.slice(1).join('｜').trim() : null;
      if (label) out.push({ label: label, note: note });
    });
    return out;
  }

  $('ns-multi').addEventListener('change', function () {
    $('wrap-max').hidden = this.value !== 'max';
  });

  $('new-survey-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var errEl = $('ns-error');
    errEl.hidden = true;

    var title = ($('ns-title').value || '').trim();
    var desc = ($('ns-desc').value || '').trim();
    var opts = parseOptions($('ns-options').value);
    if (!title) { errEl.textContent = '請填標題。'; errEl.hidden = false; return; }
    if (opts.length < 2) { errEl.textContent = '至少要有 2 個選項（一行一個）。'; errEl.hidden = false; return; }
    if (opts.length > 50) { errEl.textContent = '選項最多 50 個。'; errEl.hidden = false; return; }

    var mode = $('ns-multi').value;
    var maxChoices = mode === 'max' ? (parseInt($('ns-max').value, 10) || null) : null;
    var dl = ($('ns-deadline').value || '').trim();

    var survey = {
      title: title,
      description: desc || null,
      status: 'open',
      multi: mode !== 'no',
      max_choices: maxChoices,
      show_stats: $('ns-stats').value === 'yes',
      allow_edit: $('ns-edit').value === 'yes',
      deadline: dl ? A.tzToIso(dl + ':00') : null,
      sort_order: 0
    };

    var btn = $('ns-save');
    btn.disabled = true;
    btn.textContent = '建立中…';

    sb.from('surveys').insert(survey).select().single().then(function (res) {
      if (res.error) throw res.error;
      var sid = res.data.id;
      var rows = opts.map(function (o, i) {
        return { survey_id: sid, label: o.label, note: o.note, sort_order: i + 1 };
      });
      return sb.from('survey_options').insert(rows).then(function (r2) {
        if (r2.error) throw r2.error;
        return sid;
      });
    }).then(function (sid) {
      btn.disabled = false;
      btn.textContent = '建立並開放';
      $('new-survey-form').reset();
      $('wrap-max').hidden = true;
      A.toast('已建立並開放填寫（' + opts.length + ' 個選項）');
      loadAdminList();
      return loadTeacherView();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '建立並開放';
      errEl.textContent = '建立失敗：' + ((err && err.message) || String(err));
      errEl.hidden = false;
    });
  });

  $('btn-refresh').addEventListener('click', function () {
    loadAdminList();
    loadTeacherView().catch(function () {});
    A.toast('已重新載入');
  });

  /* 「建立新調查」預設收起來，要用的時候再展開 —— 讓作答頁回歸問卷本質 */
  $('btn-new-toggle').addEventListener('click', function () {
    var wrap = $('new-survey-wrap');
    var willOpen = wrap.hidden;
    wrap.hidden = !willOpen;
    this.textContent = willOpen ? '收起 ▴' : '展開 ▾';
    this.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) { $('ns-title').focus(); }
  });

  /* ---------- 統計與匯出 ---------- */
  function showExport(s) {
    exportSurvey = s;
    elExportCard.hidden = false;
    elExportTitle.textContent = '統計與匯出 — ' + s.title;
    elExportBody.innerHTML = '<div class="skeleton" style="width:50%"></div>';
    elExportCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    Promise.all([
      sb.from('survey_options').select('*').eq('survey_id', s.id)
        .order('sort_order', { ascending: true }).order('label', { ascending: true }),
      sb.rpc('survey_stats', { p_survey: s.id }),
      sb.rpc('survey_export', { p_survey: s.id })
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      var opts = rs[0].data || [];
      var stats = rs[1].error ? [] : (rs[1].data || []);
      var rows = rs[2].error ? [] : (rs[2].data || []);
      renderExport(s, opts, stats, rows);
    }).catch(function (err) {
      elExportBody.innerHTML = '<div class="error-box">載入失敗：'
        + A.esc((err && err.message) || String(err)) + '</div>';
    });
  }

  function renderExport(s, opts, stats, rows) {
    var labelOf = {};
    opts.forEach(function (o) { labelOf[o.id] = o.label; });
    var responded = rows.filter(function (r) { return (r.option_ids || []).length > 0; });
    var totalTeachers = rows.length;

    var h = '';
    h += '<p class="hint" style="margin-top:0">共 ' + totalTeachers + ' 位教師，已填 ' + responded.length
      + ' 位（回收率 ' + (totalTeachers ? Math.round(responded.length / totalTeachers * 100) : 0) + '%）</p>';

    h += '<h3>各選項人數</h3><div class="sv-stats" style="margin-top:6px">';
    var max = 0;
    stats.forEach(function (r) { max = Math.max(max, Number(r.cnt) || 0); });
    stats.forEach(function (r) {
      var n = Number(r.cnt) || 0;
      var pct = max ? Math.round(n / max * 100) : 0;
      h += '<div class="sv-stat-row"><span class="sv-stat-label">' + A.esc(r.label) + '</span>'
        + '<span class="sv-stat-bar"><i style="width:' + pct + '%"></i></span>'
        + '<span class="sv-stat-num">' + n + ' 人</span></div>';
    });
    h += '</div>';

    h += '<h3 style="margin-top:18px">老師的選擇（系辦／系主任參考）</h3>';
    h += '<div class="table-scroll"><table class="sv-table"><thead><tr>'
      + '<th>教師</th><th>選擇的學校／選項</th><th>備註</th><th>更新時間</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var labels = (r.option_ids || []).map(function (id) { return labelOf[id] || '（已刪除選項）'; });
      h += '<tr>'
        + '<td>' + A.esc(r.full_name || '—') + '</td>'
        + '<td>' + (labels.length ? A.esc(labels.join('、')) : '<span class="hint">尚未填寫</span>') + '</td>'
        + '<td>' + A.esc(r.note || '') + '</td>'
        + '<td>' + (r.updated_at ? A.tzParts(r.updated_at).date + ' ' + A.tzParts(r.updated_at).time : '') + '</td>'
        + '</tr>';
    });
    h += '</tbody></table></div>';
    elExportBody.innerHTML = h;
  }

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  $('btn-export-csv').addEventListener('click', function () {
    if (!exportSurvey) { A.toast('請先按「統計／匯出」'); return; }
    var s = exportSurvey;
    Promise.all([
      sb.from('survey_options').select('*').eq('survey_id', s.id)
        .order('sort_order', { ascending: true }).order('label', { ascending: true }),
      sb.rpc('survey_export', { p_survey: s.id }),
      sb.rpc('survey_stats', { p_survey: s.id })
    ]).then(function (rs) {
      var opts = rs[0].data || [];
      var rows = rs[1].data || [];
      var stats = rs[2].data || [];
      var labelOf = {};
      opts.forEach(function (o) { labelOf[o.id] = o.label; });

      var lines = [];
      lines.push([csvCell(s.title)].join(','));
      if (s.description) lines.push([csvCell(s.description)].join(','));
      lines.push('');
      lines.push([csvCell('各選項人數')].join(','));
      lines.push(['選項', '人數'].map(csvCell).join(','));
      stats.forEach(function (r) { lines.push([csvCell(r.label), csvCell(r.cnt)].join(',')); });
      lines.push('');
      lines.push([csvCell('老師的選擇')].join(','));
      lines.push(['教師', '選擇的學校／選項', '備註', '更新時間'].map(csvCell).join(','));
      rows.forEach(function (r) {
        var labels = (r.option_ids || []).map(function (id) { return labelOf[id] || '（已刪除選項）'; });
        lines.push([
          csvCell(r.full_name || ''),
          csvCell(labels.join('、')),
          csvCell(r.note || ''),
          csvCell(r.updated_at ? A.tzParts(r.updated_at).date + ' ' + A.tzParts(r.updated_at).time : '')
        ].join(','));
      });

      /* \ufeff 是 BOM：沒有它 Excel 開中文 CSV 會變亂碼 */
      var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = s.title.replace(/[\\/:*?"<>|]/g, '_') + '_統計.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      A.toast('已匯出 CSV');
    }).catch(function (err) {
      A.toast('匯出失敗：' + ((err && err.message) || String(err)));
    });
  });

  $('btn-export-print').addEventListener('click', function () {
    if (!exportSurvey) { A.toast('請先按「統計／匯出」'); return; }
    window.print();
  });

  /* ============================================================
   * LINE 綁定狀態
   * ============================================================ */
  function refreshLineBind() {
    var elState = $('line-bind-state'), elBtn = $('btn-line-bind');
    if (!elState || !A.lineEnabled()) return Promise.resolve();
    return A.getUser().then(function (user) {
      var has = A.hasLineIdentity(user);
      elState.className = 'line-bind-state ' + (has ? 'is-on' : 'is-off');
      elState.textContent = has ? '已綁定，可用 LINE 一鍵登入' : '尚未綁定（綁定後可用 LINE 一鍵登入）';
      elBtn.hidden = has;
      return has;
    }).catch(function () {
      elState.className = 'line-bind-state is-off';
      elState.textContent = '無法確認';
    });
  }

  $('btn-line-bind').addEventListener('click', function () {
    A.linkLine().catch(function (err) {
      A.toast('綁定失敗：' + ((err && err.message) || String(err)));
    });
  });

  $('btn-line-login').addEventListener('click', function () {
    A.signInWithLine().catch(function (err) {
      var e = $('login-error');
      e.textContent = 'LINE 登入失敗：' + ((err && err.message) || String(err));
      e.hidden = false;
    });
  });

  /* ============================================================
   * 登入表單 / 修改密碼 / 登出
   * ============================================================ */
  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var errEl = $('login-error');
    errEl.hidden = true;
    var btn = $('btn-login');
    btn.disabled = true;
    A.signIn($('email').value.trim(), $('password').value).then(function () {
      btn.disabled = false;
      return loadTeacherView();
    }).then(function () {
      return A.getSession();
    }).then(function (session) {
      if (!session || !session.user) { btn.disabled = false; return; }
      return loadProfile(session.user.id).then(function (p) {
        if (!p) { return A.signOut().then(function () { showLogin('這個帳號沒有對應的教師資料，請洽系辦。'); }); }
        enter(session, p);
      });
    }).catch(function (err) {
      btn.disabled = false;
      errEl.textContent = '登入失敗：' + ((err && err.message) || String(err));
      errEl.hidden = false;
    });
  });

  $('btn-pw').addEventListener('click', function () {
    $('pw-error').hidden = true;
    $('pw-modal').classList.add('show');
  });
  $('pw-cancel').addEventListener('click', function () {
    $('pw-modal').classList.remove('is-open');
  });
  $('pw-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var p1 = $('pw1').value, p2 = $('pw2').value, errEl = $('pw-error');
    errEl.hidden = true;
    if (p1.length < 6) { errEl.textContent = '密碼至少 6 個字元。'; errEl.hidden = false; return; }
    if (p1 !== p2) { errEl.textContent = '兩次輸入的密碼不一樣。'; errEl.hidden = false; return; }
    var btn = $('pw-save');
    btn.disabled = true;
    sb.auth.updateUser({ password: p1 }).then(function (res) {
      btn.disabled = false;
      if (res.error) { errEl.textContent = res.error.message; errEl.hidden = false; return; }
      $('pw-modal').classList.remove('show');
      $('pw-form').reset();
      A.toast('密碼已更新');
    });
  });

  $('btn-logout').addEventListener('click', function () {
    A.signOut().then(function () {
      me = null;
      surveys = []; allSurveys = []; exportSurvey = null;
      elWrap.innerHTML = '';
      elExportCard.hidden = true;
      showLogin();
      A.toast('已登出');
    });
  });

  function showError(err) {
    elMyError.hidden = false;
    if (A.isMissingTable(err)) {
      elMyError.innerHTML = '調查功能的資料表尚未建立。<br>請先在 Supabase 執行 '
        + '<code>supabase/migration_survey.sql</code> 與 <code>seed_survey_deepfarm.sql</code>。';
    } else {
      elMyError.textContent = '載入失敗：' + ((err && err.message) || String(err));
    }
  }
})();
