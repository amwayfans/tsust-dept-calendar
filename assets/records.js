/* ============================================================
 * 公差/招生記錄分頁（records.html）
 *
 * 三個區塊：
 *   A. 我的記錄輸入（登入後）—— 教師寫自己的，管理員／助理可代輸入
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

  /* 我的記錄／全部記錄：預設都收起來，點標題才展開。
     存檔後會自動展開「我的記錄」——老師剛新增完，就是要看那一筆，
     不該讓他再自己點一次。 */
  var accMine = App.accordion($('my-list-card'));
  var accAll = App.accordion($('all-section'));
  var elMyList = $('my-list'), elMyEmpty = $('my-empty'), elMyError = $('my-error');
  var elAllList = $('all-list'), elAllEmpty = $('all-empty'), elAllError = $('all-error');
  var elChartWrap = $('chart-wrap'), elChartEmpty = $('chart-empty'), elChartError = $('chart-error');
  var elYear = $('year-select');
  var f = {
    id: $('f-id'), type: $('f-type'), date: $('f-date'), desc: $('f-desc'),
    loc: $('f-loc'), note: $('f-note'), teacher: $('f-teacher'),
    photo: $('f-photo')
  };

  /* ---------- 狀態 ---------- */
  var me = null;          // { session, profile, admin, manager }
  var roster = [];        // 教師名冊
  var statsRows = [];     // 目前學年度的統計
  var chart = null;
  var allPage = 1, allTotal = 0;
  var pendingDelete = null;

  /* 照片狀態
   * pendingPhoto   ：這次新選的檔案（已壓縮成 JPEG Blob），null = 沒換
   * existingPhoto  ：編輯時原本的照片路徑（沒換就沿用，不重複上傳）
   * removePhoto    ：使用者按了「移除照片」
   */
  var pendingPhoto = null;
  var pendingPhotoName = '';
  var existingPhotoPath = '';
  var removePhoto = false;

  /* ---------- 照片處理 ---------- */

  /** 把選到的圖檔等比縮到最長邊 PHOTO_MAX_PX，轉成 JPEG Blob。
   *  手機照片動輒 4000px、5MB，直接上傳既慢又佔空間。 */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type || '')) {
        reject(new Error('請選擇圖片檔案'));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var maxPx = cfg.PHOTO_MAX_PX || 1600;
          var scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
          var cw = Math.max(1, Math.round(img.naturalWidth * scale));
          var ch = Math.max(1, Math.round(img.naturalHeight * scale));
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          cv.toBlob(function (blob) {
            if (!blob) { reject(new Error('圖片轉換失敗')); return; }
            resolve(blob);
          }, 'image/jpeg', cfg.PHOTO_QUALITY || 0.82);
        } catch (e) { reject(e); }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('這個檔案不是有效的圖片'));
      };
      img.src = url;
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function showPhotoPreview(src) {
    var wrap = $('photo-preview-wrap');
    if (!wrap) return;
    if (!src) {
      wrap.hidden = true;
      $('photo-preview').removeAttribute('src');
      return;
    }
    $('photo-preview').src = src;
    wrap.hidden = false;
  }

  /** 上傳照片到 Storage。路徑 {teacher_id}/{uuid}.jpg
   *  —— 這個路徑規則同時是 Storage RLS 的判斷依據。 */
  function uploadPhoto(teacherId, blob, originalName) {
    var path = teacherId + '/' + uuid() + '.jpg';
    return sb.storage.from(cfg.PHOTO_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        return { path: path, name: originalName || '' };
      });
  }

  /** 刪除 Storage 上的照片。失敗不擋流程（記錄本身才是重點）。 */
  function deletePhoto(path) {
    if (!path) return Promise.resolve(false);
    return sb.storage.from(cfg.PHOTO_BUCKET).remove([path])
      .then(function () { return true; })
      .catch(function () { return false; });
  }

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
  var oauthIntent = null;   // 'login' / 'link' / null —— 剛剛那次 OAuth 的目的

  /* LINE 登入還沒開通（provider 未設定）→ 把整組 LINE 介面收起來，
     不要留一顆按了會失敗的按鈕給老師。 */
  if (!A.lineEnabled()) A.hideLineUi();

  loadRoster().then(function () {
    return loadYears();
  }).then(function () {
    return A.getSession();
  }).then(function (session) {
    elBooting.hidden = true;
    /* 剛剛是不是從 LINE 回來的？讀完就清掉，重整不會再問一次 */
    oauthIntent = A.takeOauthIntent();
    var oerr = A.oauthReturnError();

    if (session && session.user) {
      return loadProfile(session.user.id).then(function (profile) {
        if (profile) { enter(session, profile); }
        else {
          return A.signOut().then(function () { showLogin('這個帳號沒有對應的教師資料，請洽系辦。'); });
        }
      });
    }
    /* 沒有 session：若是從 LINE 登入回來的，要講清楚「還沒綁定」，
       而不是只丟一句通用的登入失敗 —— 老師會以為是自己按錯。 */
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
    return sb.from('teacher_roster').select('email,full_name,category,title,sort_order,claimed_by')
      .order('sort_order')
      .then(function (res) {
        if (res.error) throw res.error;
        roster = res.data || [];
      });
  }

  /* 統計列一律依「教師名冊的 sort_order」排，而不是資料庫函式回傳的「次數多寡」。
     名冊是順序的單一來源：下拉選單、圖表、CSV 三處都照它排，
     才不會出現「下拉選單照名冊排、圖表照次數排」兩套順序。
     對應用 claimed_by（名冊 → profiles.id，UUID 對 UUID，最穩），
     真的沒綁定時才退回用姓名比對。 */
  function sortStatsByRoster() {
    var pos = {};
    roster.forEach(function (r, i) {
      if (r.claimed_by) pos[r.claimed_by] = i;
      if (r.full_name) pos['n:' + r.full_name] = i;
    });
    statsRows.sort(function (a, b) {
      var ia = pos[a.teacher_id] != null ? pos[a.teacher_id] : pos['n:' + a.teacher_name];
      var ib = pos[b.teacher_id] != null ? pos[b.teacher_id] : pos['n:' + b.teacher_name];
      if (ia == null) ia = Number.MAX_SAFE_INTEGER;   // 名冊查不到的排最後，不讓它插隊
      if (ib == null) ib = Number.MAX_SAFE_INTEGER;
      return ia - ib;
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
    /* 沒登入（或 session 失效）→ 頁首身分籤與選單個人操作一併收起來 */
    $('who-chip').hidden = true;
    $('menu-user').hidden = true;
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
    return sb.from('profiles').select('id,email,full_name,role,avatar_url').eq('id', uid)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || null;
      });
  }

  /* ---------- 進入已登入狀態 ---------- */
  function enter(session, profile) {
    me = {
      session: session,
      profile: profile,
      admin: A.isAdmin(session),             // 行事曆管理員（只有一位）
      manager: A.isRecordManager(profile)    // 可代輸入教師記錄（管理員或助理）
    };

    elLogin.hidden = true;
    elMy.hidden = false;
    elAll.hidden = false;

    /* 頁首的身分籤、以及收在漢堡選單裡的個人操作（修改密碼／登出），
       都只在登入後出現。未登入時整組不佔位。 */
    $('who-chip').hidden = false;
    $('menu-user').hidden = false;

    $('who').textContent = profile.full_name || profile.email || '（未命名）';
    var roleEl = $('who-role');
    roleEl.hidden = false;
    roleEl.textContent = A.roleLabel(profile);

    /* 圓形頭像：沒有照片的人（例如系辦助理不在系網師資名單裡）自動用姓名首字 */
    $('who-avatar').innerHTML =
      /* 這顆頭像現在放在頁首的身分籤裡 → 用跟 index.html 一致的 md 尺寸
         （48px 的 lg 會比同列的漢堡鈕還高，把頁首撐高） */
      A.avatarHtml(profile.full_name || profile.email, profile.avatar_url, 'avatar-md');

    refreshLineBind();

    /* 姓名不在名冊中 → 不能寫入 */
    var onRoster = !!(profile.full_name && profile.full_name.trim());
    if (!onRoster) {
      elForm.querySelectorAll('input,select,textarea,button').forEach(function (n) { n.disabled = true; });
      var warn = $('e-form');
      warn.hidden = false;
      warn.textContent = '您的帳號不在教師名冊中，無法新增記錄。請洽系辦（分機 2102）。';
    }

    /* 管理員與助理都顯示「代輸入」的教師選單 */
    if (me.manager && onRoster) {
      $('wrap-teacher').hidden = false;
      f.teacher.innerHTML = '<option value="">— 選擇教師 —</option>' +
        roster.map(function (r) {
          return '<option value="' + esc(r.email) + '">' + esc(r.full_name) +
                 (r.title ? '（' + esc(r.title) + '）' : '') + '</option>';
        }).join('');
    }

    f.date.value = today();
    f.date.max = today();
    loadAvatars().then(function () {
      loadMyRecords();
      loadAllRecords();
    });
  }

  $('btn-logout').addEventListener('click', function () {
    A.signOut().then(function () {
      me = null;
      $('record-form').reset();
      resetForm();
      elMy.hidden = true; elAll.hidden = true;
      /* 頁首身分籤與選單裡的個人操作也要一起收起來 */
      $('who-chip').hidden = true;
      $('menu-user').hidden = true;
      showLogin();
      A.toast('已登出');
    });
  });

  /* ---------- LINE 登入／綁定 ---------- */
  /* 為什麼要綁定：LINE 不會給我們老師的學校信箱，
     純用 LINE 登入的話系統認不出他是哪位老師。
     所以「先用帳密登入一次 → 綁定 LINE → 之後一鍵登入」。 */
  function refreshLineBind() {
    var elState = $('line-bind-state'), elBtn = $('btn-line-bind');
    if (!elState || !A.lineEnabled()) return Promise.resolve();
    return A.getUser().then(function (user) {
      var on = A.hasLineIdentity(user);
      elState.textContent = on ? '已綁定 ✓' : '尚未綁定';
      elState.className = 'line-bind-state ' + (on ? 'is-on' : 'is-off');
      elBtn.hidden = on;
      /* 剛剛是去綁定回來的 → 給一句回饋，否則使用者不知道到底成功了沒 */
      if (oauthIntent === 'link' && on) A.toast('LINE 綁定完成，之後可以一鍵登入', 'ok');
    }).catch(function () {
      elState.textContent = '無法取得綁定狀態';
      elState.className = 'line-bind-state is-off';
      elBtn.hidden = true;
    });
  }

  $('btn-line-bind').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    A.linkLine().catch(function (err) {
      btn.disabled = false;
      var code = (err && err.code) || '';
      var msg = (err && err.message) || '請稍後再試';
      /* 後台還沒開 Manual Linking 時，給一句人話，不要讓老師看到英文錯誤 */
      if (code === 'manual_linking_disabled') {
        msg = '系統尚未開啟「LINE 帳號綁定」功能，請洽系辦（分機 2102）。';
      }
      A.toast('綁定失敗：' + msg, 'error');
    });
  });

  $('btn-line-login').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    A.signInWithLine().catch(function (err) {
      btn.disabled = false;
      var e = $('login-error');
      e.textContent = 'LINE 登入無法啟動：' + ((err && err.message) || '請稍後再試');
      e.hidden = false;
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
      sortStatsByRoster();      // 依名冊順序排，圖表與 CSV 都用這個順序
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

    /* 橫式長條圖：老師姓名放左邊，不會像直式那樣被截掉、也不必讓圖表橫向捲動。
       高度隨人數長，讓頁面自然往下捲 —— 19 位老師約 700px。
       每列 34px：兩個堆疊區段還看得清楚，卡片又不會長到失控。 */
    var rowH = 34;
    var h = Math.max(180, labels.length * rowH + 76);

    elChartWrap.innerHTML =
      '<div class="chart-inner" style="position:relative;height:' + h + 'px">' +
      '<canvas id="chart"></canvas></div>';

    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart($('chart').getContext('2d'), {
      type: 'bar',
      /* indexAxis: 'y' 就是把直式長條轉成橫式的開關 */
      data: {
        labels: labels,
        datasets: [
          { label: '招生', data: enroll, backgroundColor: TYPE_COLOR.enrollment, stack: 's' },
          { label: '公差', data: duty, backgroundColor: TYPE_COLOR.duty, stack: 's' }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          /* 轉橫式之後兩軸的角色對調：
             x＝數值軸（次數），y＝類別軸（老師姓名）。
             姓名軸要 autoSkip:false，19 位老師才會每一位都列出來、不被跳過。 */
          x: {
            stacked: true, beginAtZero: true,
            ticks: { precision: 0, stepSize: 1 },
            title: { display: true, text: '次數' }
          },
          y: {
            stacked: true,
            ticks: { autoSkip: false, font: { size: 12 } },
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return items[0].label; },
              /* 橫式之後數值在 parsed.x（不是 parsed.y）——這裡漏改的話
                 tooltip 會永遠顯示 0 次。 */
              label: function (c) { return c.dataset.label + '：' + c.parsed.x + ' 次'; },
              footer: function (items) {
                var t = items.reduce(function (s, i) { return s + (i.parsed.x || 0); }, 0);
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
    if (me && me.manager) f.teacher.value = '';

    /* 照片狀態一起清掉，否則編輯完的照片會殘留到下一筆 */
    pendingPhoto = null;
    pendingPhotoName = '';
    existingPhotoPath = '';
    removePhoto = false;
    if (f.photo) f.photo.value = '';
    showPhotoPreview('');
    $('e-photo').hidden = true;

    $('form-title').textContent = me && me.manager ? '新增記錄（可代輸入）' : '新增記錄';
    $('btn-save').textContent = '新增';
    $('btn-cancel').hidden = true;
    $('e-desc').hidden = true;
    $('e-form').hidden = true;
  }

  $('btn-cancel').addEventListener('click', resetForm);

  /* ---------- 照片：選檔 → 壓縮 → 預覽 ---------- */
  f.photo.addEventListener('change', function () {
    var file = f.photo.files && f.photo.files[0];
    var errEl = $('e-photo');
    errEl.hidden = true;
    if (!file) return;

    var maxBytes = (cfg.PHOTO_MAX_MB || 5) * 1024 * 1024;
    /* 原始檔超過上限 3 倍就先擋掉，不必浪費時間壓縮 */
    if (file.size > maxBytes * 3) {
      errEl.textContent = '照片太大了（超過 ' + (cfg.PHOTO_MAX_MB || 5) +
                          'MB 的 3 倍），請換一張。';
      errEl.hidden = false;
      f.photo.value = '';
      return;
    }

    compressImage(file).then(function (blob) {
      if (blob.size > maxBytes) {
        errEl.textContent = '壓縮後仍超過 ' + (cfg.PHOTO_MAX_MB || 5) + 'MB，請換一張。';
        errEl.hidden = false;
        f.photo.value = '';
        return;
      }
      pendingPhoto = blob;
      pendingPhotoName = file.name || ('photo-' + Date.now() + '.jpg');
      removePhoto = false;
      showPhotoPreview(URL.createObjectURL(blob));
    }).catch(function (err) {
      errEl.textContent = (err && err.message) || '照片處理失敗';
      errEl.hidden = false;
      f.photo.value = '';
    });
  });

  $('btn-photo-clear').addEventListener('click', function () {
    pendingPhoto = null;
    pendingPhotoName = '';
    f.photo.value = '';
    /* 編輯時按移除 → 標記要刪掉 Storage 上的舊照片 */
    if (existingPhotoPath) removePhoto = true;
    showPhotoPreview('');
    $('e-photo').hidden = true;
  });

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
    if (me.manager && f.teacher.value) {
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
    var btn = $('btn-save');
    var id = f.id.value;
    var oldPath = existingPhotoPath;
    btn.disabled = true;
    $('e-photo').hidden = true;

    /* 先處理照片，再寫記錄 —— 記錄的 photo_path 才知道要指向哪裡 */
    var sendPhotoName = false;
    var photoStep;
    if (pendingPhoto) {
      sendPhotoName = true;
      photoStep = uploadPhoto(teacherId, pendingPhoto, pendingPhotoName)
        .then(function (up) { return { path: up.path, name: up.name }; });
    } else if (removePhoto && oldPath) {
      sendPhotoName = true;
      photoStep = deletePhoto(oldPath).then(function () { return { path: null, name: null }; });
    } else {
      /* 沒動照片：沿用原本的路徑，不重複上傳 */
      photoStep = Promise.resolve({ path: oldPath || null, name: null });
    }

    return photoStep.then(function (photo) {
      var payload = {
        teacher_id: teacherId,
        record_type: f.type.value,
        record_date: f.date.value,
        description: f.desc.value.trim(),
        location: f.loc.value.trim() || null,
        note: f.note.value.trim() || null,
        entered_by_admin: enteredByAdmin,
        photo_path: photo.path
        /* teacher_name / academic_year 由資料庫 trigger 決定，這裡不送 */
      };
      if (sendPhotoName) payload.photo_name = photo.name;

      var q = id
        ? sb.from('teacher_records').update(payload).eq('id', id)
        : sb.from('teacher_records').insert(payload);

      return q.select().then(function (res) {
        btn.disabled = false;
        if (res.error) {
          /* 記錄沒寫成，剛上傳的照片要清掉，避免留下沒人指向的孤兒檔案 */
          if (pendingPhoto && photo.path) deletePhoto(photo.path);
          var msg = res.error.message || String(res.error);
          if (/不在教師名冊/.test(msg)) msg = '您的帳號不在教師名冊中，無法新增記錄。';
          if (/未來/.test(msg)) msg = '不可填寫未來的日期。';
          A.toast('儲存失敗：' + msg, 'error');
          return;
        }
        A.toast(id ? '已更新' : '已新增', 'ok');
        resetForm();
        if (accMine) accMine.open();      // 新增完直接看到自己的記錄
        loadMyRecords();
        loadAllRecords();
        loadYears();
      });
    }).catch(function (err) {
      btn.disabled = false;
      var m = (err && err.message) || String(err);
      $('e-photo').textContent = '照片上傳失敗：' + m + '（記錄尚未儲存）';
      $('e-photo').hidden = false;
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
      /* 簽章失敗不該讓整個列表消失 —— 照片留白，記錄照常顯示 */
      return A.signedUrls(cfg.PHOTO_BUCKET,
                          rows.map(function (r) { return r.photo_path; }))
        .catch(function () { return {}; })
        .then(function (map) {
          elMyList.innerHTML = rows.map(function (r) { return recordLi(r, true, map); }).join('');
          bindActions(elMyList);
        });
    });
  }

  /* ---------- 教師頭像對照表（姓名 → 網址） ---------- */
  var avatarByName = {};

  /**
   * 載入所有教師的頭像網址。
   * 頭像只是裝飾，載入失敗不該擋住記錄列表 —— 所以錯誤一律吞掉，
   * 讓 recordLi 走「姓名首字」的替代路徑。
   */
  function loadAvatars() {
    return sb.from('profiles').select('full_name,avatar_url')
      .not('avatar_url', 'is', null)
      .then(function (res) {
        if (res.error) return;
        (res.data || []).forEach(function (p) {
          if (p.full_name && p.avatar_url) {
            avatarByName[p.full_name.trim()] = p.avatar_url;
          }
        });
      })
      .catch(function () { /* 忽略 */ });
  }

  function recordLi(r, showActions, photoUrls) {
    var color = TYPE_COLOR[r.record_type] || '#64748B';
    var canEdit = me && (me.manager || r.teacher_id === me.session.user.id);
    var acts = (showActions && canEdit)
      ? '<div class="ev-actions">' +
          '<button class="btn" data-act="edit" data-id="' + esc(r.id) + '">編輯</button>' +
          '<button class="btn btn-danger" data-act="del" data-id="' + esc(r.id) + '">刪除</button>' +
        '</div>'
      : '';
    /* data-type 給 CSS 上色用（招生＝藍、公差＝金），
       讓每一列不用逐字讀也知道是哪一類 */
    return '<li data-type="' + esc(r.record_type) + '">' +
      '<span class="ev-dot" style="background:' + color + '"></span>' +
      A.avatarHtml(r.teacher_name, avatarByName[(r.teacher_name || '').trim()], 'avatar-sm') +
      '<div class="ev-main">' +
        '<strong>' + esc(r.description) + '</strong>' +
        '<small>' +
          esc(TYPE_LABEL[r.record_type] || r.record_type) + '｜' +
          esc(r.record_date) + '｜' + esc(r.teacher_name) +
          '｜' + esc(r.academic_year) + ' 學年度' +
          (r.location ? '｜' + esc(r.location) : '') +
          (r.note ? '｜' + esc(r.note) : '') +
          (r.entered_by_admin ? ' <span class="tag-admin">由管理員代輸入</span>' : '') +
        '</small>' + photoHtml(r, photoUrls) +
      '</div>' + acts + '</li>';
  }

  /** 記錄照片的縮圖（私有桶，需簽章網址才看得到） */
  function photoHtml(r, photoUrls) {
    if (!r.photo_path) return '';
    var url = (photoUrls || {})[r.photo_path];
    if (!url) return '<span class="ev-photo-loading">照片載入中…</span>';
    return '<a class="ev-photo-link" href="' + esc(url) + '" target="_blank" rel="noopener">' +
             '<img class="ev-photo" src="' + esc(url) + '" alt="記錄照片" loading="lazy">' +
           '</a>';
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

      /* 既有照片：只做預覽，pendingPhoto 保持 null —— 沒換檔就沿用舊的，不重複上傳 */
      pendingPhoto = null;
      pendingPhotoName = '';
      removePhoto = false;
      existingPhotoPath = r.photo_path || '';
      if (f.photo) f.photo.value = '';
      if (existingPhotoPath) {
        A.signedUrls(cfg.PHOTO_BUCKET, [existingPhotoPath])
          .then(function (map) { showPhotoPreview(map[existingPhotoPath] || ''); })
          .catch(function () { showPhotoPreview(''); });
      } else {
        showPhotoPreview('');
      }

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
    /* 先取回照片路徑，記錄刪掉後才不會留下沒人指向的孤兒檔案 */
    sb.from('teacher_records').delete().eq('id', id).select('photo_path')
      .then(function (res) {
        btn.disabled = false;
        $('confirm').classList.remove('show');
        pendingDelete = null;
        if (res.error) { A.toast('刪除失敗：' + res.error.message, 'error'); return; }
        (res.data || []).forEach(function (r) { deletePhoto(r.photo_path); });
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
        $('all-count').textContent = '共 ' + allTotal + ' 筆';

        var pages = Math.max(1, Math.ceil(allTotal / PAGE_SIZE));
        $('pager').hidden = allTotal <= PAGE_SIZE;
        $('pg-info').textContent = '第 ' + allPage + ' / ' + pages + ' 頁';
        $('pg-prev').disabled = allPage <= 1;
        $('pg-next').disabled = allPage >= pages;

        /* 簽章失敗不該讓整個列表消失 —— 照片留白，記錄照常顯示 */
        return A.signedUrls(cfg.PHOTO_BUCKET,
                            rows.map(function (r) { return r.photo_path; }))
          .catch(function () { return {}; })
          .then(function (map) {
            elAllList.innerHTML = rows.map(function (r) { return recordLi(r, false, map); }).join('');
          });
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
