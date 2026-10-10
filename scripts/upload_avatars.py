#!/usr/bin/env python3
"""把處理好的教師頭像上傳到 Supabase Storage，並寫回 profiles.avatar_url。

⚠️ 執行前必須先跑過 supabase/migration_avatars.sql（桶與欄位才會存在）。

檔名用 profiles.id（UUID），不用 email —— 桶是公開的，
把 email 放在網址裡等於公告老師的信箱。
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ENV = '/home/chungta/.config/ae-dashboard/.env'
AVATARS = '/data/tmp/folder_work/tmp/avatars'
BUCKET = 'avatars'

env = {}
for line in open(ENV):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
URL, SK = env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY']
H = {'apikey': SK, 'Authorization': f'Bearer {SK}'}


def api(path, method='GET', body=None, headers=None, raw=False):
    h = dict(H)
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        if isinstance(body, bytes):
            data = body
        else:
            data = json.dumps(body).encode()
            h['Content-Type'] = 'application/json'
    req = urllib.request.Request(URL + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            return r.status, (payload if raw else
                              (json.loads(payload) if payload else None))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


# ---------- 1. 取教師名單 ----------
st, profs = api('/rest/v1/profiles?select=id,email,full_name,role')
if st != 200 or not isinstance(profs, list):
    print(f'✗ 讀取 profiles 失敗：HTTP {st} {profs}')
    sys.exit(1)
print(f'profiles：{len(profs)} 筆')

by_name = {}
for p in profs:
    if p.get('full_name'):
        by_name[p['full_name'].strip()] = p

# ---------- 2. 逐一上傳 ----------
files = sorted(f for f in os.listdir(AVATARS) if f.lower().endswith('.jpg'))
print(f'待上傳頭像：{len(files)} 張\n')

ok, skipped, failed = [], [], []
for fn in files:
    name = os.path.splitext(fn)[0]
    prof = by_name.get(name)
    if not prof:
        skipped.append((name, 'profiles 裡找不到同名教師'))
        continue

    path = f"{prof['id']}.jpg"
    with open(os.path.join(AVATARS, fn), 'rb') as f:
        blob = f.read()

    # upsert：覆蓋舊檔（x-upsert）
    st, res = api(f'/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}',
                  method='POST', body=blob,
                  headers={'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
    if st not in (200, 201):
        failed.append((name, f'上傳失敗 HTTP {st} {str(res)[:120]}'))
        continue

    public_url = f'{URL}/storage/v1/object/public/{BUCKET}/{path}'
    st2, res2 = api(f"/rest/v1/profiles?id=eq.{prof['id']}",
                    method='PATCH', body={'avatar_url': public_url},
                    headers={'Prefer': 'return=representation'})
    if st2 not in (200, 204):
        failed.append((name, f'寫回 avatar_url 失敗 HTTP {st2} {str(res2)[:120]}'))
        continue

    ok.append((name, prof['email'], len(blob)))
    print(f"  ✓ {name:<6} {len(blob)/1024:5.0f} KB  → {path[:8]}…")

print(f'\n成功 {len(ok)}、略過 {len(skipped)}、失敗 {len(failed)}')
for n, why in skipped:
    print(f'  － {n}: {why}')
for n, why in failed:
    print(f'  ✗ {n}: {why}')

# ---------- 3. 回讀驗證 ----------
st, rows = api('/rest/v1/profiles?select=full_name,email,avatar_url'
               '&avatar_url=not.is.null&order=full_name')
if st == 200 and isinstance(rows, list):
    print(f'\n資料庫中已有頭像：{len(rows)} 筆')
    for r in rows:
        print(f"  {r['full_name']:<6} {r['avatar_url'][-16:]}")
