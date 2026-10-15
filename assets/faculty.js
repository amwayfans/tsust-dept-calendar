/* ============================================================
 * 教師通訊錄 — 邏輯
 *   專任（teacher_contacts 檢視表）＋ 兼任（adjunct_teacher_contacts 檢視表）
 *
 * 安全原則：
 *   1. 未登入「完全不抓資料」——先確認登入，登入後才發請求。
 *   2. 版面 fail-closed：HTML 先 hidden，確認登入後才 hidden = false。
 *   3. 只讀檢視表（不含身分證／生日）。
 * ============================================================ */
(function () {
  'use strict';

  var A = window.App;
  var SB = A.sb;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    rows: [],          // 正規化後的通訊錄
    kind: 'all',       // all | full | adj
    q: '',
    me: null
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
    A.syncHeaderAuth(session, profile);
  }

  /* ---------- 資料 ---------- */
  /** 專任：teacher_contacts（英文欄名） */
  function fetchFull() {
    return SB.from('teacher_contacts')
      .select('emp_no,full_name,category,title_cn,name_en,title_en,office_line,email,mobile')
      .order('emp_no', { ascending: true })
      .then(function (r) {
        if (r.error) throw r.error;
        return (r.data || []).map(function (x) {
          return {
            kind: 'full',
            emp: x.emp_no || '',
            name: x.full_name || '',
            badge: x.title_cn || x.category || '專任',
            nameEn: x.name_en || '',
            titleEn: x.title_en || '',
            office: x.office_line || '',
            email: x.email || '',
            mobile: x.mobile || '',
            unit: '機械與自動化工程系',
            semester: ''
          };
        });
      });
  }

  /** 兼任：adjunct_teacher_contacts（中文欄名） */
  function fetchAdj() {
    return SB.from('adjunct_teacher_contacts')
      .select('職號,姓名,Email,學期,單位,排序')
      .order('排序', { ascending: true })
      .then(function (r) {
        if (r.error) throw r.error;
        return (r.data || []).map(function (x) {
          return {
            kind: 'adj',
            emp: x['職號'] || '',
            name: x['姓名'] || '',
            badge: '兼任',
            nameEn: '',
            titleEn: '',
            office: '',
            email: x['Email'] || '',
            mobile: '',
            unit: x['單位'] || '',
            semester: x['學期'] || ''
          };
        });
      });
  }

  /** 頭像：從 profiles 取（只有有帳號的老師有） */
  function fetchAvatars() {
    return SB.from('profiles').select('email,avatar_url').then(function (r) {
      if (r.error) return {};          // 取不到就算了，不影響通訊錄
      var m = {};
      (r.data || []).forEach(function (p) { if (p.email) m[p.email.toLowerCase()] = p.avatar_url; });
      return m;
    }).catch(function () { return {}; });
  }

  /* ---------- 顯示 ---------- */
  function matches(row, q) {
    if (!q) return true;
    var hay = [row.name, row.nameEn, row.emp, row.badge, row.titleEn, row.unit,
               row.email, row.office].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return state.rows.filter(function (r) {
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      return matches(r, q);
    });
  }

  function contactLines(r) {
    var out = [];
    if (r.office) {
      out.push('<div class="fac-line"><span class="fac-k">電話</span>' +
               '<a href="tel:' + A.esc(r.office.replace(/[^0-9+#]/g, '')) + '">' +
               A.esc(r.office) + '</a></div>');
    }
    if (r.mobile) {
      out.push('<div class="fac-line"><span class="fac-k">手機</span>' +
               '<a href="tel:' + A.esc(r.mobile.replace(/[^0-9+#]/g, '')) + '">' +
               A.esc(r.mobile) + '</a></div>');
    }
    if (r.email) {
      out.push('<div class="fac-line"><span class="fac-k">信箱</span>' +
               '<a href="mailto:' + A.esc(r.email) + '">' + A.esc(r.email) + '</a></div>');
    }
    if (!out.length) {
      out.push('<div class="fac-line fac-muted">' +
               '<span class="fac-k">聯絡</span>請洽系辦 07-607-7022 分機 2102</div>');
    }
    return out.join('');
  }

  function card(r, avatars) {
    var av = avatars[(r.email || '').toLowerCase()] || '';
    var sub = [r.nameEn, r.titleEn].filter(Boolean).join('　·　');
    var meta = [];
    if (r.unit && r.kind === 'adj') meta.push(r.unit);
    if (r.semester) meta.push(r.semester);
    if (r.emp) meta.push(r.emp);

    return '<div class="card fac-card">' +
             '<div class="fac-top">' +
               '<span class="fac-avatar">' + A.avatarHtml(r.name, av, 'avatar-sm') + '</span>' +
               '<span class="fac-head">' +
                 '<span class="fac-name">' + A.esc(r.name) + '</span>' +
                 '<span class="fac-badge fac-badge-' + r.kind + '">' + A.esc(r.badge) + '</span>' +
                 (sub ? '<span class="fac-sub">' + A.esc(sub) + '</span>' : '') +
               '</span>' +
             '</div>' +
             (meta.length ? '<div class="fac-meta">' + A.esc(meta.join('　·　')) + '</div>' : '') +
             '<div class="fac-contacts">' + contactLines(r) + '</div>' +
           '</div>';
  }

  function group(title, rows, avatars) {
    if (!rows.length) return '';
    return '<h3 class="fac-group">' + A.esc(title) + '（' + rows.length + '）</h3>' +
           '<div class="fac-grid">' + rows.map(function (r) {
             return card(r, avatars);
           }).join('') + '</div>';
  }

  function render() {
    var rows = filtered();
    var avatars = state.avatars || {};
    var body = $('fac-body');

    if (!rows.length) {
      body.innerHTML = '<div class="card"><p class="fac-none">' +
        (state.q ? '找不到符合「' + A.esc(state.q) + '」的老師。' : '目前沒有資料。') +
        '</p></div>';
      $('fac-count').textContent = '';
      return;
    }

    var html = '';
    if (state.kind === 'all') {
      html += group('專任教師', rows.filter(function (r) { return r.kind === 'full'; }), avatars);
      html += group('兼任教師', rows.filter(function (r) { return r.kind === 'adj'; }), avatars);
    } else if (state.kind === 'full') {
      html += group('專任教師', rows, avatars);
    } else {
      html += group('兼任教師', rows, avatars);
    }
    body.innerHTML = html;
    $('fac-count').textContent = '顯示 ' + rows.length + ' 位';
  }

  /* ---------- 進入 ---------- */
  function enter(session) {
    elLogin.hidden = true;
    elApp.hidden = false;
    return SB.from('profiles').select('*').eq('email', session.user.email).maybeSingle()
      .then(function (r) {
        state.me = (r.data) || null;
        setWho(session, state.me);
        // 登入確認後才開始抓資料
        return Promise.all([fetchFull(), fetchAdj(), fetchAvatars()]);
      })
      .then(function (res) {
        state.rows = res[0].concat(res[1]);
        state.avatars = res[2] || {};
        var nFull = state.rows.filter(function (r) { return r.kind === 'full'; }).length;
        var nAdj = state.rows.filter(function (r) { return r.kind === 'adj'; }).length;
        $('fac-hint').textContent = '專任 ' + nFull + ' 位、兼任 ' + nAdj + ' 位' +
          '　·　資料來源：系辦名冊（115-1）';
        // 分頁鈕顯示數量
        Array.prototype.forEach.call(document.querySelectorAll('.fac-mode'), function (b) {
          var k = b.getAttribute('data-kind');
          var n = k === 'all' ? state.rows.length : state.rows.filter(function (r) {
            return r.kind === k;
          }).length;
          var label = { all: '全部', full: '專任教師', adj: '兼任教師' }[k];
          b.textContent = label + '（' + n + '）';
        });
        render();
      });
  }

  function boot() {
    A.getSession().then(function (session) {
      if (!session) { showLogin(); return; }
      return enter(session).catch(function (e) {
        if (A.isMissingTable(e)) {
          showLogin('通訊錄資料表尚未建立，請洽系辦。');
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

  document.querySelector('.fac-modes').addEventListener('click', function (ev) {
    var b = ev.target.closest('.fac-mode');
    if (!b) return;
    state.kind = b.getAttribute('data-kind');
    Array.prototype.forEach.call(document.querySelectorAll('.fac-mode'), function (x) {
      x.classList.toggle('is-active', x === b);
    });
    render();
  });

  $('fac-q').addEventListener('input', function () {
    state.q = this.value;
    render();
  });

  boot();
})();
