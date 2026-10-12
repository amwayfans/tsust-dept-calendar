#!/usr/bin/env python3
"""從真正的頁面產生暫時測試頁（預設 index.html → _probe.html）。

為什麼要用產生而不是手寫一份：
手寫的測試頁會跟真正的頁面愈差愈多，測到的就不是真正上線的那份。
這裡只做一件事 —— 在 config.js 之前插一段假造登入 session 的 script，
其餘 HTML 完全照抄。測完就把 _probe*.html 刪掉，不會進版控。

用法：
  python3 scripts/make_probe.py                            # index.html → _probe.html
  python3 scripts/make_probe.py records.html               # records.html → _probe_records.html
  python3 scripts/make_probe.py <來源.html> <輸出.html>     # 指定檔名（比對舊版用）

注意：假 client 只攔「登入狀態」與 profiles，其餘查詢照樣打到真正的
Supabase（唯讀）。所以 roster、統計圖、年份下拉都是真資料，版面才準。
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent   # 本檔在 scripts/ 底下，往上一層才是專案根目錄

if len(sys.argv) > 1:
    src_path = pathlib.Path(sys.argv[1])
    if not src_path.is_absolute():
        src_path = root / src_path
    # 只給來源檔名時，輸出檔名自動由來源推導（records.html → _probe_records.html）
    default_out = root / ("_probe.html" if src_path.name == "index.html"
                          else "_probe_" + src_path.stem + ".html")
else:
    src_path = root / "index.html"
    default_out = root / "_probe.html"

out_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else default_out
if not out_path.is_absolute():
    out_path = root / out_path

src = src_path.read_text(encoding="utf-8")

STUB = """<script>
/* ==== 測試用：假造一個已登入的管理員 session（被測程式碼一行都沒改） ==== */
(function () {
  var realCreate = window.supabase.createClient.bind(window.supabase);
  window.__OPS = [];            /* 攔截寫入動作，不真的寫進資料庫 */
  var FAKE_USER = {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'sr0035@tsust.edu.tw'
  };
  window.supabase.createClient = function (url, key) {
    var real = realCreate(url, key);
    /* 通用查詢鏈：真的 client 有的鏈式方法這裡都要有。
       少一個（例如 .not）就會讓整條啟動鏈失敗、畫面掉回登入頁，
       而那種失敗看起來很像「功能壞了」，其實是測試頁自己的問題。 */
    function chain(res) {
      var o = {};
      ['select', 'eq', 'neq', 'not', 'is', 'in', 'order', 'limit', 'range',
       'gte', 'lte', 'gt', 'lt', 'ilike', 'like', 'or', 'filter', 'match',
       'contains', 'containedBy', 'overlaps', 'textSearch'
      ].forEach(function (m) { o[m] = function () { return o; }; });
      o.maybeSingle = function () {
        return Promise.resolve({ data: (res.data && res.data[0]) || null, error: res.error });
      };
      o.single = o.maybeSingle;
      /* 讓 chain 可以 await / .then()（真的 builder 也是 thenable） */
      o.then = function (ok, bad) { return Promise.resolve(res).then(ok, bad); };
      return o;
    }
    /* 教師名冊：teacher_roster 有 RLS，匿名／假 session 讀不到，
       所以這裡放一份「順序與真實名冊一致」的清單，版面才會準。 */
    var ROSTER = ['楊至誠','龔榮源','張智淵','陳邦家','張旭銘','楊大明','鍾新輝',
                  '張智傑','陳嘉偉','蕭士彥','吳建憲','龔啓良','曾俊龍','盧俊彰',
                  '林哲愷','連永昇','陳坤禾','田偉忠','曹國樑'
                 ].map(function (n, i) {
                   return { email: null, full_name: n, category: '專任', title: null,
                            sort_order: i + 1, claimed_by: null };
                 });
    return {
      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: { user: FAKE_USER } } });
        },
        /* common.js 的 getUser() 會用到（進入管理員／助理模式時） */
        getUser: function () {
          return Promise.resolve({ data: { user: FAKE_USER }, error: null });
        },
        signOut: function () { return Promise.resolve({}); },
        /* 下面這幾個只有「使用者真的去按」才會被呼叫；
           給回成功但什麼都不做的版本，避免假的 client 一按就 TypeError。 */
        signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
        signInWithOAuth: function () { return Promise.resolve({ data: {}, error: null }); },
        linkIdentity: function () { return Promise.resolve({ data: {}, error: null }); },
        updateUser: function () { return Promise.resolve({ data: {}, error: null }); }
      },
      from: function (t) {
        if (t === 'profiles')
          return chain({ data: [{ id: FAKE_USER.id, email: FAKE_USER.email,
                                  full_name: '游忠達', avatar_url: null, role: 'admin',
                                  line_user_id: 'U0000000000000000000000000000000' }],
                         error: null });
        if (t === 'teacher_roster') return chain({ data: ROSTER, error: null });
        /* 教師記錄／助理表：假 session 沒有真的 JWT，RLS 一定擋。
           給空陣列讓版面乾淨，不要讓查詢失敗把啟動鏈打斷。 */
        if (t === 'teacher_records' || t === 'record_assistants')
          return chain({ data: [], error: null });
        if (t === 'events') {
          var q = real.from.apply(real, arguments);
          function wrap(op) {
            return function (payload) {
              var rec = { op: op, payload: payload, id: null };
              window.__OPS.push(rec);
              var b = {
                eq: function (col, val) { rec.id = val; return b; },
                select: function () {
                  return Promise.resolve({ data: [payload || { id: rec.id }], error: null });
                }
              };
              return b;
            };
          }
          q.insert = wrap('insert');
          q.update = wrap('update');
          q.delete = wrap('delete');
          return q;
        }
        return real.from.apply(real, arguments);
      },
      /* rpc 一律放行給真的 client（統計、年份下拉都靠它，而且都是唯讀），
         漏了這條的話啟動鏈會在 loadYears() 就失敗、直接掉去登入畫面。 */
      rpc: function () { return real.rpc.apply(real, arguments); },
      storage: real.storage
    };
  };
})();
</script>
"""

needle = '<script src="assets/config.js"></script>'
if needle not in src:
    sys.exit("找不到注入點：config.js 的 script 標籤")
out = src.replace(needle, STUB + needle, 1)
# 標題一律換掉，方便一眼看出這是測試頁（各頁標題不同，用正則比對）
out = re.sub(r"<title>.*?</title>", "<title>PROBE（暫時測試頁）</title>", out, count=1, flags=re.S)

out_path.write_text(out, encoding="utf-8")
print("來源：%s" % src_path.name)
print("已產生 %s（%d bytes）" % (out_path.name, len(out)))
print("注入點正確：", needle in out)
