#!/usr/bin/env python3
"""把教師記錄照片從 Supabase Storage 同步一份到 Google Drive。

為什麼要同步
------------
網站是靜態的（GitHub Pages），照片存在 Supabase Storage 的私有桶，
要登入才看得到。系上同仁習慣用 Google Drive，所以排程再放一份到
G:\\folder_tmp\\AE Dashboard\\教師記錄照片\\，兩邊都有，也順便當備份。

同步方式
--------
1. 列出 Storage 裡的所有照片
2. 對照 teacher_records 取得教師姓名／日期／事由
3. 排成「學年度/教師姓名/日期_事由_編號.jpg」
4. 只下載「Drive 上還沒有」的檔案，避免每次重抓
5. 透過 rclone 上傳（remote sr0035:）

設計原則
--------
- **只新增、不刪除**：Drive 那份是備份，跟著刪就失去意義了。
- **單張失敗不中斷整批**：一張有問題不該讓其他照片都同步不了。
- **不輸出任何金鑰**。
- 重複執行安全（idempotent）。
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime

ENV_PATH = '/home/chungta/.config/ae-dashboard/.env'
BUCKET = 'record-photos'
RCLONE_REMOTE = 'sr0035:folder_tmp/AE Dashboard/教師記錄照片'
TMP_DIR = '/data/tmp/folder_work/tmp/photo_sync'

# 檔名不能出現的字元（Windows 也不允許）
BAD_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')


def load_env(path=ENV_PATH):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
URL = ENV['SUPABASE_URL']
KEY = ENV['SUPABASE_SERVICE_KEY']


def api(path, method='GET', body=None, raw=False, timeout=60):
    data = None
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f'{URL}{path}', data=data,
                                 headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if raw else json.load(r)


def list_objects():
    """列出桶內所有物件（分頁抓完）。"""
    out, offset = [], 0
    while True:
        batch = api(f'/storage/v1/object/list/{BUCKET}', method='POST',
                    body={'prefix': '', 'limit': 1000, 'offset': offset})
        if not batch:
            break
        out.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    # 只留檔案（資料夾的 id 是 null）
    return [o for o in out if o.get('id')]


def fetch_records():
    """取回記錄，用 photo_path 當索引。"""
    rows = api('/rest/v1/teacher_records?select=id,teacher_name,record_date,'
               'description,academic_year,photo_path&photo_path=not.is.null')
    return {r['photo_path']: r for r in rows if r.get('photo_path')}


def safe(s, n=20):
    s = BAD_CHARS.sub('', str(s or '')).strip().replace(' ', '')
    return s[:n] or '未命名'


def target_rel(obj_path, rec):
    """照片在 Drive 上的相對路徑。"""
    if rec:
        year = rec.get('academic_year') or 0
        teacher = safe(rec.get('teacher_name'), 10)
        date = rec.get('record_date') or '0000-00-00'
        desc = safe(rec.get('description'), 20)
        rid = str(rec.get('id') or '')[:8]
        return f'{year}學年度/{teacher}/{date}_{desc}_{rid}.jpg'
    # 找不到對應記錄 → 收在 _未對應，不丟掉
    return f'_未對應/{obj_path.replace("/", "_")}'


def remote_listing():
    """Drive 上已有的相對路徑集合。"""
    try:
        r = subprocess.run(['rclone', 'lsf', '--recursive', RCLONE_REMOTE],
                           capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        print('✗ 找不到 rclone，請先安裝', file=sys.stderr)
        return None
    if r.returncode != 0:
        err = (r.stderr or '').strip()
        # 目錄還不存在不算錯，第一次同步就是這種情況
        if 'not found' in err.lower() or 'directory not found' in err.lower():
            return set()
        print(f'✗ rclone lsf 失敗：{err}', file=sys.stderr)
        return None
    return {ln.strip() for ln in r.stdout.splitlines() if ln.strip()}


def download(obj_path, dest):
    data = api(f'/storage/v1/object/{BUCKET}/{obj_path}', raw=True)
    with open(dest, 'wb') as f:
        f.write(data)
    return len(data)


def upload(local, rel):
    r = subprocess.run(['rclone', 'copyto', local, f'{RCLONE_REMOTE}/{rel}',
                        '--no-traverse'],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or '').strip()[:200])


def main():
    os.makedirs(TMP_DIR, exist_ok=True)
    started = datetime.now()

    objs = list_objects()
    print(f'Storage 照片：{len(objs)} 張')
    if not objs:
        print('沒有照片需要同步。')
        return 0

    recs = fetch_records()
    have = remote_listing()
    if have is None:
        return 1
    print(f'Drive 已有：{len(have)} 張')

    todo = []
    for o in objs:
        p = o['name']
        rel = target_rel(p, recs.get(p))
        if rel not in have:
            todo.append((p, rel))

    print(f'待同步：{len(todo)} 張')
    if not todo:
        print('Drive 已是最新，無需同步。')
        return 0

    ok = fail = 0
    total_bytes = 0
    for p, rel in todo:
        local = os.path.join(TMP_DIR, os.path.basename(rel))
        try:
            n = download(p, local)
            upload(local, rel)
            total_bytes += n
            ok += 1
            print(f'  ✓ {rel}（{n // 1024} KB）')
        except urllib.error.HTTPError as e:
            fail += 1
            print(f'  ✗ {rel}：HTTP {e.code}', file=sys.stderr)
        except Exception as e:
            fail += 1
            print(f'  ✗ {rel}：{type(e).__name__} {e}', file=sys.stderr)
        finally:
            if os.path.exists(local):
                os.remove(local)

    secs = (datetime.now() - started).total_seconds()
    print(f'\n完成：成功 {ok}、失敗 {fail}、共 {total_bytes / 1048576:.1f} MB、'
          f'{secs:.1f} 秒')
    return 0 if fail == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
