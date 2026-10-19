#!/usr/bin/env python3
"""教室課表管理功能：完整流程驗證（假 supabase）。"""
import functools, http.server, json, pathlib, re, socketserver, threading

ROOT = pathlib.Path('/data/Hermes/folder/dept_calendar')
import random
PORT = random.randint(20000, 29999)
ROWS = [
    {'id': 11, 'semester': '115-1', 'room': '機302', 'day': 1, 'period': 3,
     'period_label': '3', 'start_time': '10:10', 'end_time': '11:00',
     'course': '機械製圖', 'teacher': '盧俊彰', 'class_name': '四技機自二甲'},
    {'id': 12, 'semester': '115-1', 'room': '機302', 'day': 2, 'period': 4,
     'period_label': '4', 'start_time': '11:10', 'end_time': '12:00',
     'course': '材料力學', 'teacher': '陳嘉偉', 'class_name': '四技機自二乙'},
]

FAKE = """
window.__LOGS = []; window.__ROWS = __ROWS__;
window.supabase = { createClient: function () {
  function chain(table) {
    var st = {table: table, op: 'select', payload: null};
    var api = {
      select: function () { return api; }, insert: function (p) { st.op='insert'; st.payload=p; return api; },
      update: function (p) { st.op='update'; st.payload=p; return api; }, delete: function () { st.op='delete'; return api; },
      eq: function () { return api; }, order: function () { return api; }, limit: function () { return api; },
      single: function () { return api; }, maybeSingle: function () { return api; },
      then: function (cb) {
        if (st.op !== 'select') { window.__LOGS.push({op: st.op, table: st.table, payload: st.payload});
          return Promise.resolve({data: null, error: null}).then(cb); }
        if (st.table === 'room_schedule') return Promise.resolve({data: window.__ROWS, error: null}).then(cb);
        if (st.table === 'profiles') return Promise.resolve({data: {id:'u1', full_name:'游忠達', role:'admin', email:'sr0035@tsust.edu.tw'}, error: null}).then(cb);
        return Promise.resolve({data: [], error: null}).then(cb);
      } };
    return api;
  }
  return { from: chain, auth: {
    getSession: function () { return Promise.resolve({data:{session:{user:{id:'u1', email:'sr0035@tsust.edu.tw'}}}, error:null}); },
    onAuthStateChange: function () { return {data:{subscription:{unsubscribe:function(){}}}}; },
    signOut: function () { return Promise.resolve({error:null}); } } };
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
    body = FAKE.replace('__ROWS__', json.dumps(ROWS))

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 1000})
        pg.route(re.compile(r'.*supabase-js.*'),
                 lambda r: r.fulfill(status=200, content_type='application/javascript', body=body))
        pg.goto(f'http://127.0.0.1:{PORT}/rooms.html', wait_until='networkidle')
        pg.wait_for_timeout(2500)

        # ① 點課程 → 編輯視窗（檢查帶入值）
        pg.click('.rs-course.rs-editable')
        pg.wait_for_timeout(600)
        print('① 編輯視窗開啟：', pg.evaluate("() => document.getElementById('rs-edit-modal').classList.contains('show')"))
        print('   帶入：教室 =', pg.input_value('#rs-e-room'), '｜課程 =', pg.input_value('#rs-e-course'),
              '｜老師 =', pg.input_value('#rs-e-teacher'), '｜星期 =', pg.input_value('#rs-e-day'),
              '｜節次 =', pg.input_value('#rs-e-period'), '｜刪除鈕顯示 =', pg.evaluate("() => !document.getElementById('rs-e-delete').hidden"))

        # ② 改教室（調課情境）→ 儲存
        pg.fill('#rs-e-room', '機305')
        pg.click('#rs-e-save')
        pg.wait_for_timeout(900)
        log = pg.evaluate("() => window.__LOGS.slice(-1)[0]")
        print('② 儲存 payload：', json.dumps({k: (log or {}).get('payload', {}).get(k) for k in
              ('room', 'day', 'period', 'course', 'teacher', 'semester')}, ensure_ascii=False))
        print('   動作 =', (log or {}).get('op'), '｜視窗已關 =', not pg.evaluate("() => document.getElementById('rs-edit-modal').classList.contains('show')"))

        # ③ 新增
        pg.click('#btn-add-course')
        pg.wait_for_timeout(500)
        print('③ 新增視窗：標題 =', pg.text_content('#rs-e-title'), '｜刪除鈕顯示 =', pg.evaluate("() => !document.getElementById('rs-e-delete').hidden"))
        pg.fill('#rs-e-room', '機401')
        pg.fill('#rs-e-course', '測試課程')
        pg.fill('#rs-e-teacher', '盧俊彰')
        pg.click('#rs-e-save')
        pg.wait_for_timeout(900)
        log = pg.evaluate("() => window.__LOGS.slice(-1)[0]")
        print('   新增 payload op =', (log or {}).get('op'), '｜教室 =', (log or {}).get('payload', {}).get('room'),
              '｜課程 =', (log or {}).get('payload', {}).get('course'))

        # ④ 必填檢核
        pg.click('#btn-add-course'); pg.wait_for_timeout(400)
        pg.fill('#rs-e-course', '')
        pg.click('#rs-e-save'); pg.wait_for_timeout(300)
        print('④ 空白課程 → 錯誤訊息：', pg.text_content('#rs-e-error'), '｜視窗仍開 =',
              pg.evaluate("() => document.getElementById('rs-edit-modal').classList.contains('show')"))

        # ⑤ 刪除（要有二次確認）
        pg.click('#rs-e-cancel'); pg.wait_for_timeout(300)
        pg.click('.rs-course.rs-editable'); pg.wait_for_timeout(500)
        pg.click('#rs-e-delete'); pg.wait_for_timeout(400)
        print('⑤ 刪除確認視窗：', pg.evaluate("() => document.getElementById('rs-del-modal').classList.contains('show')"))
        print('   確認文字：', (pg.text_content('#rs-del-text') or '').replace('\n', ' / '))
        pg.click('#rs-del-ok'); pg.wait_for_timeout(900)
        log = pg.evaluate("() => window.__LOGS.slice(-1)[0]")
        print('   刪除 op =', (log or {}).get('op'), '｜table =', (log or {}).get('table'))

        # ⑥ 我的課表：管理員可選老師
        pg.click('.rs-mode[data-mode="mine"]'); pg.wait_for_timeout(700)
        print('⑥ 老師下拉選項：', pg.evaluate("() => [...document.querySelectorAll('#mine-teacher option')].map(o=>o.value)"))
        print('   預設選到：', pg.input_value('#mine-teacher'), '｜標題 =', pg.text_content('#mine-title'))
        pg.select_option('#mine-teacher', '陳嘉偉'); pg.wait_for_timeout(500)
        print('   切到陳嘉偉 → 標題 =', pg.text_content('#mine-title'),
              '｜列出課程 =', pg.evaluate("() => (document.getElementById('mine-body').innerText||'').replace(/\\n+/g,' / ').trim()"))
        b.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
