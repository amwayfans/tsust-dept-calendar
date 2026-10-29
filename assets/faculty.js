/* ============================================================
 * 教師通訊錄 — 邏輯
 *   專任（teacher_contacts 檢視表）＋ 兼任（adjunct_teacher_contacts 檢視表）
 *
 * 安全原則：
 *   1. 未登入「完全不抓資料」——先確認登入，登入後才發請求。
 *   2. 版面 fail-closed：HTML 先 hidden，確認登入後才 hidden = false。
 *   3. 通訊錄只讀 teacher_contacts／adjunct_teacher_contacts（不含身分證／生日）。
 *   4. 個資（身分證、生日）另讀 v_teacher_pii —— RLS 只放行 admin／assistant，
 *      一般老師即使打開這個分頁也抓回 0 筆，前端只是「多一個分頁」而非權限來源。
 *      前端另外預設遮蔽（S120****22），要看完整得自己勾「顯示完整」。
 * ============================================================ */
(function () {
  'use strict';

  var A = window.App;
  var SB = A.sb;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    rows: [],          // 正規化後的通訊錄
    kind: 'all',       // all | full | adj | pii
    q: '',
    me: null,
    staff: false,      // admin／assistant
    pii: {},           // 職號 → { id_number, birth_date, note }
    reveal: false      // 是否顯示完整身分證
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

  /** 頭像：從 profiles 取（只有有帳號的老師有）
   *  配對用「兩種鍵」：
   *    1) 完整 email —— 名片上的信箱就是他的登入信箱時可用
   *    2) `#職號` —— profile 的 email 若不是職號（如 yuan@、csmoo@），
   *       以及**名片上根本沒有信箱**的老師（如陳邦家），只有職號配得到
   *  兩者取聯集才不會漏人（實測單用 email 或單用職號都只配到 16/19）。 */
  function fetchAvatars() {
    return SB.from('profiles').select('email,avatar_url').then(function (r) {
      if (r.error) return {};          // 取不到就算了，不影響通訊錄
      var m = {};
      (r.data || []).forEach(function (p) {
        if (!p.email || !p.avatar_url) return;
        var e = p.email.toLowerCase();
        m[e] = p.avatar_url;
        var local = e.split('@')[0];             // t20049@tsust.edu.tw → t20049
        if (local) m['#' + local] = p.avatar_url;
      });
      return m;
    }).catch(function () { return {}; });
  }

  /** 個資：v_teacher_pii（RLS 只放行 admin／assistant；老師會拿回 0 筆）
   *  取不到（例如資料表還沒建）就回空物件，不讓整個頁面壞掉。 */
  function fetchPii() {
    return SB.from('v_teacher_pii').select('emp_no,id_number,birth_date,note').then(function (r) {
      if (r.error) {
        console.warn('[faculty] 個資讀取失敗：' + (r.error.message || r.error));
        return {};
      }
      var m = {};
      (r.data || []).forEach(function (x) {
        m[x.emp_no] = x;
      });
      return m;
    }).catch(function () { return {}; });
  }

  /* ---------- 排序：先職級、再姓名筆畫 ---------- */
  /* 使用者指示（2026-10-15）：先依職級（教授→副教授→助理教授→講師）排，
     同職級再按姓名筆畫 —— 採「教育部《國字標準字體筆順學習網》」
     逐字查得的筆畫數（98 字全查過；93 字與 Unihan 相同，
     陳 11／淵 11 與 Unihan 不同，已採教育部值；啓樑羣 3 個異體字
     教育部未收錄，沿用 Unihan）。
     新增教師時若姓名出現表裡沒有的字，會 console.warn 並排到最後 ——
     看到警告就重跑 scripts/gen_faculty_strokes.py 重生這張表。 */
  var STROKE = { '中':4, '仁':4, '俊':9, '保':9, '偉':11, '傑':12, '光':6, '全':6, '勝':12, '博':12, '吳':7, '周':8, '哲':10, '啓':11, '嘉':14, '國':11, '坤':8, '堂':11, '士':3, '大':3, '宋':7, '宏':7, '家':10, '峻':10, '崴':12, '川':3, '建':9, '張':11, '彥':9, '彰':14, '德':15, '忠':8, '怡':8, '愷':13, '慶':15, '憲':16, '承':8, '捷':11, '新':13, '方':4, '旭':6, '昇':8, '明':8, '景':12, '智':12, '曹':11, '曾':12, '木':4, '朱':6, '李':7, '村':7, '東':8, '松':8, '林':8, '梁':11, '楊':13, '榮':14, '樑':15, '正':5, '永':5, '泓':8, '淵':11, '源':13, '王':4, '玲':9, '田':5, '盧':16, '禾':5, '羣':13, '義':13, '翔':12, '耀':20, '至':6, '良':7, '華':12, '蕭':16, '薛':17, '誠':13, '謙':17, '謝':17, '輝':15, '迪':9, '連':11, '邦':7, '郭':11, '銘':14, '鍾':17, '鐘':20, '長':8, '陳':11, '隆':12, '雄':12, '雯':12, '震':15, '鶴':21, '黃':12, '龍':16, '龔':22 };

  var TITLE_RANK = { '教授': 1, '副教授': 2, '助理教授': 3, '講師': 4 };

  function titleRank(t) {
    return TITLE_RANK[t] || 9;      // 兼任／未標職稱者排最後
  }

  function strokeKey(name) {
    var k = '';
    for (var i = 0; i < name.length; i++) {
      var s = STROKE[name[i]];
      if (s === undefined) {
        console.warn('[faculty] 姓名筆畫表缺字：' + name[i] + '（' + name + '）');
        s = 999;
      }
      k += ('000' + s).slice(-3);
    }
    return k;
  }

  function cmpRows(a, b) {
    var ra = titleRank(a.badge), rb = titleRank(b.badge);
    if (ra !== rb) return ra - rb;
    var ka = strokeKey(a.name), kb = strokeKey(b.name);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.name.localeCompare(b.name);
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
      if (state.kind !== 'all' && state.kind !== 'pii' && r.kind !== state.kind) return false;
      return matches(r, q);
    });
  }

  /* ---------- 個資表（僅系辦） ---------- */
  function maskId(v) {
    v = (v || '').trim();
    if (!v) return '—';
    return v.length >= 6 ? v.slice(0, 4) + '****' + v.slice(-2) : '****';
  }

  function piiCell(v) {
    return v ? A.esc(v) : '<span class="fac-muted">—</span>';
  }

  function renderPii(rows) {
    var body = $('fac-body');
    var pii = state.pii || {};
    var withPii = rows.filter(function (r) { return pii[r.emp]; });
    if (!rows.length) {
      body.innerHTML = '<div class="card"><p class="fac-none">目前沒有資料。</p></div>';
      $('fac-count').textContent = '';
      return;
    }
    if (!withPii.length) {
      body.innerHTML = '<div class="card"><p class="fac-none">查無個資資料（或您沒有檢視權限）。</p></div>';
      $('fac-count').textContent = '';
      return;
    }
    var trs = withPii.map(function (r) {
      var p = pii[r.emp] || {};
      var idTxt = state.reveal ? (p.id_number || '—') : maskId(p.id_number);
      var note = p.note ? '<div class="fac-muted" style="font-size:12px">' + A.esc(p.note) + '</div>' : '';
      return '<tr>' +
        '<td class="fac-nowrap">' + A.esc(r.emp || '') + '</td>' +
        '<td class="fac-nowrap">' + A.esc(r.name || '') + '</td>' +
        '<td class="fac-nowrap">' + A.esc(r.badge || '') + '</td>' +
        '<td class="fac-nowrap">' + (r.mobile ? A.esc(r.mobile) : '<span class="fac-muted">—</span>') + '</td>' +
        '<td class="fac-nowrap">' + A.esc(idTxt) + note + '</td>' +
        '<td class="fac-nowrap">' + piiCell(p.birth_date) + '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML = '<div class="card">' +
      '<h3 class="fac-group">教師個資（僅系辦人員）</h3>' +
      '<div class="fac-table-wrap"><table class="fac-table">' +
      '<thead><tr><th>職號</th><th>姓名</th><th>職級</th><th>手機</th><th>身分證字號</th><th>出生年月日</th></tr></thead>' +
      '<tbody>' + trs + '</tbody></table></div>' +
      '<p class="hint">身分證預設遮蔽，勾選上方「顯示完整」才會展開；' +
      '本表由資料庫權限（RLS）控管，只有 admin／assistant 讀得到。</p>' +
      '</div>';
    $('fac-count').textContent = '個資 ' + withPii.length + ' 筆' +
      (rows.length > withPii.length ? '（另 ' + (rows.length - withPii.length) + ' 位未建個資）' : '');
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
    // 先用名片信箱配，配不到再用職號配（陳邦家等名片沒信箱的老師靠這條）
    var av = avatars[(r.email || '').toLowerCase()] ||
             avatars['#' + (r.emp || '').toLowerCase()] || '';
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

    if (state.kind === 'pii') { renderPii(rows); return; }

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
        state.staff = !!((state.me && (state.me.role === 'admin' || state.me.role === 'assistant')) ||
                         A.isAdmin(session));
        // 系辦人員才顯示「個資」分頁（權限本體在資料庫，這裡只是不要讓人白點）
        if ($('fac-mode-pii')) $('fac-mode-pii').hidden = !state.staff;
        if ($('fac-pii-bar')) $('fac-pii-bar').hidden = !state.staff;
        // 登入確認後才開始抓資料
        return Promise.all([fetchFull(), fetchAdj(), fetchAvatars(), state.staff ? fetchPii() : Promise.resolve({})]);
      })
      .then(function (res) {
        state.rows = res[0].concat(res[1]);
        state.rows.sort(cmpRows);   // 先職級、再姓名筆畫
        state.avatars = res[2] || {};
        state.pii = res[3] || {};
        var nFull = state.rows.filter(function (r) { return r.kind === 'full'; }).length;
        var nAdj = state.rows.filter(function (r) { return r.kind === 'adj'; }).length;
        $('fac-hint').textContent = '專任 ' + nFull + ' 位、兼任 ' + nAdj + ' 位' +
          '　·　資料來源：系辦名冊（115-1）';
        // 分頁鈕顯示數量
        Array.prototype.forEach.call(document.querySelectorAll('.fac-mode'), function (b) {
          var k = b.getAttribute('data-kind');
          if (k === 'pii') {
            b.textContent = '個資（系辦）' + (state.staff ? '（' + Object.keys(state.pii).length + '）' : '');
            return;
          }
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

  // 「顯示完整身分證字號」開關：預設關閉（遮蔽），勾了才展開
  var revealBox = $('fac-pii-reveal');
  if (revealBox) {
    revealBox.addEventListener('change', function () {
      state.reveal = !!this.checked;
      if (state.kind === 'pii') render();
    });
  }

  boot();
})();
