#!/usr/bin/env python3
"""把解析好的教室課表匯入 Supabase（走 REST + service_role，不受 RLS 限制）。

用法：
    python3 import_room_schedule.py                     # 匯入 115-1（先清該學期再寫入）
    python3 import_room_schedule.py --dry-run           # 只檢查，不寫入
    python3 import_room_schedule.py --semester 115-1

設計：
  * 以「學期」為單位覆蓋：先刪掉該學期舊資料再整批寫入，
    重複執行結果一致（匯入到一半失敗也不會留下半套資料）。
  * service_role key 只從 ~/.config/ae-dashboard/.env 讀，不進對話、不寫進程式。
"""
import argparse
import json
import pathlib
import sys
import urllib.parse
import urllib.request

ENV = pathlib.Path.home() / '.config/ae-dashboard/.env'
DEFAULT_JSON = pathlib.Path('/data/tmp/folder_work/out/115-1課表_解析.json')
BATCH = 200
COLS = ['semester', 'room', 'day', 'period', 'period_label',
        'start_time', 'end_time', 'course', 'teacher', 'class_name']


def load_env():
    env = {}
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def req(url, key, method='GET', body=None, headers=None, prefer=None):
    h = {'apikey': key, 'Authorization': f'Bearer {key}',
         'Content-Type': 'application/json'}
    if prefer:
        h['Prefer'] = prefer
    if headers:
        h.update(headers)
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=120) as resp:
        raw = resp.read().decode()
        return resp.status, (json.loads(raw) if raw.strip() else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=str(DEFAULT_JSON))
    ap.add_argument('--semester', default='')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    env = load_env()
    url = env['SUPABASE_URL'].rstrip('/')
    key = env.get('SUPABASE_SERVICE_KEY') or env.get('SUPABASE_SERVICE_ROLE_KEY')
    if not key:
        sys.exit('✗ .env 裡找不到 service_role key')

    rows = json.loads(pathlib.Path(a.json).read_text(encoding='utf-8'))
    sem = a.semester or (rows[0].get('semester') if rows else '')
    rows = [r for r in rows if r.get('semester') == sem]
    for r in rows:
        r.pop('raw', None)
    payload = [{k: r.get(k) for k in COLS} for r in rows]

    print(f'學期：{sem}')
    print(f'待匯入：{len(payload)} 筆　教室 {len({r["room"] for r in payload})} 間　'
          f'老師 {len({r["teacher"] for r in payload if r["teacher"]})} 位')
    missing = [r for r in payload if not r.get('course') or not r.get('room')]
    if missing:
        sys.exit(f'✗ 有 {len(missing)} 筆缺課程或教室，中止')
    if a.dry_run:
        print('（dry-run，未寫入）')
        print('範例：', json.dumps(payload[0], ensure_ascii=False))
        return

    q = urllib.parse.quote(sem)
    st, _ = req(f'{url}/rest/v1/room_schedule?semester=eq.{q}', key, method='DELETE')
    print(f'清除舊資料：HTTP {st}')

    done = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        st, _ = req(f'{url}/rest/v1/room_schedule', key, method='POST', body=chunk,
                    prefer='return=minimal')
        done += len(chunk)
        print(f'  寫入 {done}/{len(payload)}　HTTP {st}')

    # 驗收：回讀筆數
    st, data = req(f'{url}/rest/v1/room_schedule?semester=eq.{q}&select=id', key,
                   headers={'Prefer': 'count=exact', 'Range': '0-0'})
    print(f'\n資料庫實際筆數：{st}')
    st2, rows2 = req(f'{url}/rest/v1/room_schedule?semester=eq.{q}&select=room,day,period,course,teacher', key)
    print(f'回讀 {len(rows2)} 筆')
    rooms = sorted({r['room'] for r in rows2})
    print(f'教室（{len(rooms)}）：' + '、'.join(rooms))
    ok = len(rows2) == len(payload)
    print(('✓ 匯入成功，筆數一致' if ok else f'✗ 筆數不符（來源 {len(payload)}）'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
