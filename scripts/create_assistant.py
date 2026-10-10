#!/usr/bin/env python3
"""建立系辦助理帳號（顏志明）。

⚠️ 執行前必須先跑過 supabase/migration_records_v2.sql，
   否則 record_assistants 不存在，trigger 會把他建成一般教師。

用法：
    python3 scripts/create_assistant.py            # 建立（已存在則跳過）
    python3 scripts/create_assistant.py --password '自訂密碼'

建立後會把「姓名／信箱／臨時密碼」寫成 CSV，方便交付。
密碼不會出現在畫面上（只寫進 CSV），CSV 請發完就刪。
"""
import argparse
import csv
import json
import secrets
import string
import sys
import urllib.error
import urllib.request

ENV_PATH = '/home/chungta/.config/ae-dashboard/.env'
OUT_CSV = '/mnt/sr0035/folder_tmp/AE Dashboard/教師記錄_助理帳號.csv'

TARGETS = [
    {'email': 'sg0098@tsust.edu.tw', 'name': '顏志明', 'role': 'assistant'},
]


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


def api(path, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if data:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f'{URL}{path}', data=data,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def gen_password(n=12):
    """好唸、好打的臨時密碼（去掉容易混淆的 0/O/1/l/I）。"""
    alphabet = (string.ascii_letters + string.digits)
    alphabet = ''.join(c for c in alphabet if c not in '0O1lI')
    while True:
        pw = ''.join(secrets.choice(alphabet) for _ in range(n))
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw)
                and any(c.isdigit() for c in pw)):
            return pw


def find_user(email):
    st, data = api(f'/auth/v1/admin/users?per_page=200')
    if st != 200 or not isinstance(data, dict):
        return None
    for u in data.get('users', []):
        if (u.get('email') or '').lower() == email.lower():
            return u
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--password', help='自訂密碼（預設隨機產生）')
    args = ap.parse_args()

    # 先確認前置作業完成
    st, _ = api('/rest/v1/record_assistants?select=email&limit=1')
    if st != 200:
        print('✗ record_assistants 不存在 —— 請先跑 migration_records_v2.sql',
              file=sys.stderr)
        return 1

    rows, failed = [], 0
    for t in TARGETS:
        email, name = t['email'], t['name']
        existing = find_user(email)
        if existing:
            print(f'· {name}（{email}）帳號已存在，跳過建立')
        else:
            pw = args.password or gen_password()
            st, res = api('/auth/v1/admin/users', method='POST', body={
                'email': email,
                'password': pw,
                'email_confirm': True,
                'user_metadata': {'full_name': name},
            })
            if st not in (200, 201):
                print(f'✗ {name} 建立失敗：HTTP {st} {res}', file=sys.stderr)
                failed += 1
                continue
            print(f'✓ {name}（{email}）帳號已建立')
            rows.append({'姓名': name, '信箱': email, '角色': '系辦助理',
                         '臨時密碼': pw})

    # 驗證 profiles 是否為助理（trigger 應該已帶入）
    print('\n=== 驗證 profiles ===')
    st, profs = api('/rest/v1/profiles?select=email,full_name,role'
                    '&role=in.(admin,assistant)&order=role')
    if st == 200 and isinstance(profs, list):
        for p in profs:
            flag = '✓' if p.get('full_name') else '✗ 姓名為空'
            print(f'  {flag} {p.get("role"):<10} '
                  f'{p.get("full_name") or "(空)":<8} {p.get("email")}')
    else:
        print(f'  查詢失敗 HTTP {st}')

    if rows:
        with open(OUT_CSV, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=['姓名', '信箱', '角色', '臨時密碼'])
            w.writeheader()
            w.writerows(rows)
        print(f'\n臨時密碼已寫入：{OUT_CSV}')
        print('（請發給本人後刪除這個檔案，內含明碼）')

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
