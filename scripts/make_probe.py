#!/usr/bin/env python3
"""從真正的 index.html 產生暫時測試頁 _probe.html。

為什麼要用產生而不是手寫一份：
手寫的測試頁會跟 index.html 愈差愈多，測到的就不是真正上線的那份。
這裡只做一件事 —— 在 config.js 之前插一段假造登入 session 的 script，
其餘 HTML 完全照抄。測完就把 _probe.html 刪掉，不會進版控。
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent
src = (root / "index.html").read_text(encoding="utf-8")

STUB = """<script>
/* ==== 測試用：假造一個已登入的管理員 session（被測程式碼一行都沒改） ==== */
(function () {
  var realCreate = window.supabase.createClient.bind(window.supabase);
  window.__OPS = [];            /* 攔截寫入動作，不真的寫進資料庫 */
  window.supabase.createClient = function (url, key) {
    var real = realCreate(url, key);
    function chain(res) {
      var o = { select: function(){return o;}, eq: function(){return o;},
                maybeSingle: function(){ return Promise.resolve(res); } };
      return o;
    }
    return {
      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: { user: {
            id: '00000000-0000-0000-0000-000000000000',
            email: 'sr0035@tsust.edu.tw' } } } });
        },
        signOut: function () { return Promise.resolve({}); }
      },
      from: function (t) {
        if (t === 'profiles')
          return chain({ data: { full_name: '游忠達', avatar_url: null, role: 'admin' },
                         error: null });
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
out = out.replace("<title>系所行事曆</title>", "<title>PROBE（暫時測試頁）</title>", 1)

(root / "_probe.html").write_text(out, encoding="utf-8")
print("已產生 _probe.html（%d bytes）" % len(out))
print("注入點正確：", needle in out)
