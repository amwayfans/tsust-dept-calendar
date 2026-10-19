#!/usr/bin/env python3
"""教室課表：權限與編輯功能的端對端驗證（假 supabase 客戶端）。

用法：python3 test_rooms_admin.py teacher|admin
"""
import functools, http.server, pathlib, re, socketserver, sys, threading

ROOT = pathlib.Path('/data/Hermes/folder/dept_calendar')
ROLE = sys.argv[1] if len(sys.argv) > 1 else 'admin'
import random
PORT = random.randint(20000, 29999)
LOGS = []

ROWS = [
    {'id': 11, 'semester': '115-1', 'room': '機302', 'day': 1, 'period': 3,
     'period_label': '3', 'start_time': '10:10', 'end_time': '11:00',
     'course': '機械製圖', 'teacher': '盧俊彰', 'class_name': '四技機自二甲'},
    {'id': 12, 'semester': '115-1', 'room': '機302', 'day': 2, 'period': 4,
     'period_label': '4', 'start_time': '11:10', 'end_time': '12:00',
     'course': '材料力學', 'teacher': '陳嘉偉', 'class_name': '四技機自二乙'},
]

FAKE = """
window.__LOGS = [];
window.__ROWS = __ROWS__;
window.supabase = { createClient: function () {
  function chain(table) {
    var st = {table: table, op: 'select', payload: null};
    var api = {
      select: function () { return api; },
      insert: function (p) { st.op = 'insert'; st.payload = p; return api; },
      update: function (p) { st.op = 'update'; st.payload = p; return api; },
      delete: function () { st.op = 'delete'; return api; },
      eq: function () { return api; }, order: function () { return api; },
      limit: function () { return api; }, single: function () { return api; },
      maybeSingle: function () { return api; },
      then: function (cb) {
        if (st.op !== 'select') {
          window.__LOGS.push({op: st.op, table: st.table, payload: st.payload});
          return Promise.resolve({data: null, error: null}).then(cb);
        }
        if (st.table === 'room_schedule') return Promise.resolve({data: window.__ROWS, error: null}).then(cb);
        if (st.table === 'profiles') return Promise.resolve({data: {id: 'u1', full_name: __NAME__, role: __ROLE__, email: 'x@tsust.edu.tw'}, error: null}).then(cb);
        return Promise.resolve({data: [], error: null}).then(cb);
      }
    };
    return api;
  }
  return { from: chain, auth: {
    getSession: function () { return Promise.resolve({data: {session: {user: {id: 'u1', email: __EMAIL__}}}, error: null}); },
    onAuthStateChange: function () { return {data: {subscription: {unsubscribe: function () {}}}}; },
    signOut: function () { return Promise.resolve({error: null}); } } };
}};
"""


class TCP(socketserver.TCPServer):
    allow_reuse_address = True


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def main():
    h = functools.partial(H, directory=str(ROOT))
    srv = TCP(('127.0.0.1', PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    import json
    body = (FAKE.replace('__ROWS__', json.dumps(ROWS))
                .replace('__NAME__', repr('盧俊彰'))
                .replace('__ROLE__', repr(ROLE))
                .replace('__EMAIL__', repr('lu@tsust.edu.tw')))

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 1000})
        pg.route(re.compile(r'.*supabase-js.*'),
                 lambda route: route.fulfill(status=200, content_type='application/javascript', body=body))
        pg.goto(f'http://127.0.0.1:{PORT}/rooms.html', wait_until='networkidle')
        pg.wait_for_timeout(2500)

        print(f'=== 角色：{ROLE} ===')
        print('① 管理 bar 顯示：', pg.evaluate("() => !document.getElementById('manage-bar').hidden"))
        print('② 課程格可編輯：', pg.evaluate("() => document.querySelectorAll('.rs-course.rs-editable').length"))
        print('③ 我的課表老師下拉顯示：', pg.evaluate("() => !document.getElementById('mine-picker').hidden"))
        print('④ 新增鈕「看得見」：',
              pg.evaluate("() => { const e = document.getElementById('btn-add-course'); return !!(e.offsetParent && e.getBoundingClientRect().width > 0); }"))
        b.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
