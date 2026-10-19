#!/usr/bin/env python3
"""手機寬度（390x844）檢查：管理 bar、編輯視窗不溢出、按鈕可點。"""
import functools, http.server, json, pathlib, random, re, socketserver, threading

ROOT = pathlib.Path('/data/Hermes/folder/dept_calendar')
PORT = random.randint(20000, 29999)
ROWS = [{'id': 11, 'semester': '115-1', 'room': '機302', 'day': 1, 'period': 3,
         'period_label': '3', 'start_time': '10:10', 'end_time': '11:00',
         'course': '機械製圖', 'teacher': '盧俊彰', 'class_name': '四技機自二甲'}]

FAKE = """
window.__LOGS=[]; window.__ROWS=__ROWS__;
window.supabase={createClient:function(){function chain(t){var st={table:t,op:'select',payload:null};
 var api={select:function(){return api;},insert:function(p){st.op='insert';st.payload=p;return api;},
 update:function(p){st.op='update';st.payload=p;return api;},delete:function(){st.op='delete';return api;},
 eq:function(){return api;},order:function(){return api;},limit:function(){return api;},
 single:function(){return api;},maybeSingle:function(){return api;},
 then:function(cb){ if(st.op!=='select'){window.__LOGS.push(st);return Promise.resolve({data:null,error:null}).then(cb);}
  if(st.table==='room_schedule') return Promise.resolve({data:window.__ROWS,error:null}).then(cb);
  if(st.table==='profiles') return Promise.resolve({data:{id:'u1',full_name:'游忠達',role:'admin'},error:null}).then(cb);
  return Promise.resolve({data:[],error:null}).then(cb);}}; return api;}
 return {from:chain,auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'sr0035@tsust.edu.tw'}}},error:null});},
 onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
 signOut:function(){return Promise.resolve({error:null});}}};}};
"""


class TCP(socketserver.TCPServer):
    allow_reuse_address = True


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def main():
    srv = TCP(('127.0.0.1', PORT), functools.partial(H, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    body = FAKE.replace('__ROWS__', json.dumps(ROWS))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.route(re.compile(r'.*supabase-js.*'),
                 lambda r: r.fulfill(status=200, content_type='application/javascript', body=body))
        pg.goto(f'http://127.0.0.1:{PORT}/rooms.html', wait_until='networkidle')
        pg.wait_for_timeout(2500)
        print('頁面橫向溢出：', pg.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth"))
        print('管理 bar 寬度：', pg.evaluate("() => { const e=document.getElementById('manage-bar'); const r=e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }"))
        print('新增鈕 rect：', pg.evaluate("() => { const r=document.getElementById('btn-add-course').getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]; }"))
        # 開編輯視窗看是否溢出
        pg.evaluate("() => document.querySelector('.rs-course.rs-editable').click()")
        pg.wait_for_timeout(700)
        print('編輯視窗開啟：', pg.evaluate("() => document.getElementById('rs-edit-modal').classList.contains('show')"))
        print('編輯視窗寬度 / 畫面寬：', pg.evaluate("() => { const r=document.querySelector('#rs-edit-modal .modal-box').getBoundingClientRect(); return [Math.round(r.width), document.documentElement.clientWidth]; }"))
        print('視窗內橫向溢出：', pg.evaluate("() => { const b=document.querySelector('#rs-edit-modal .modal-box'); return b.scrollWidth > b.clientWidth; }"))
        # 捲到底：儲存／取消／刪除鈕是否真的點得到（不能被推到畫面外）
        pg.evaluate("() => { const m=document.getElementById('rs-edit-modal'); m.scrollTop = m.scrollHeight; }")
        pg.wait_for_timeout(400)
        print('捲到底後按鈕位置：', pg.evaluate("""() => [...document.querySelectorAll('#rs-edit-modal .modal-actions button')].map(b => {
            const r = b.getBoundingClientRect();
            return b.textContent.trim() + '[' + Math.round(r.top) + ',' + Math.round(r.bottom) + '|vw=' + window.innerHeight + '|看得見=' + (r.top >= 0 && r.bottom <= window.innerHeight) + ']';
        })"""))
        pg.evaluate("() => { const m=document.getElementById('rs-edit-modal'); m.scrollTop = 0; }")
        pg.wait_for_timeout(300)
        pg.screenshot(path='/data/tmp/folder_work/rooms_desktop_modal.png', full_page=False)
        pg.click('#rs-e-cancel'); pg.wait_for_timeout(400)
        pg.screenshot(path='/data/tmp/folder_work/rooms_desktop_list.png', full_page=False)
        b.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
