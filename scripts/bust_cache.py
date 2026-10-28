#!/usr/bin/env python3
"""把 HTML 裡的 assets 引用加上內容雜湊版本號（快取破壞）。

問題：GitHub Pages 對 assets/*.js、*.css 送 Cache-Control: max-age=600，
使用者改版後十分鐘內還是拿到舊檔 —— 畫面看起來「改了沒用」，
實際上根本沒載到新程式。

做法：把每個資產的 MD5 前 8 碼接成 ?v=xxxx，內容一變網址就變，
瀏覽器自然會重新抓。每次部署前跑一次即可（可重複執行）。
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path('/data/Hermes/folder/dept_calendar')
PAGES = ['index.html', 'records.html', 'survey.html', 'rooms.html', 'admin.html',
         'faculty.html', 'recruit.html']
ASSET_RE = re.compile(r'(assets/[A-Za-z0-9_.\-]+\.(?:js|css))(\?v=[0-9a-f]+)?')


def digest(rel):
    p = ROOT / rel
    if not p.exists():
        return None
    return hashlib.md5(p.read_bytes()).hexdigest()[:8]


changed = []
for page in PAGES:
    p = ROOT / page
    if not p.exists():
        continue
    src = p.read_text(encoding='utf-8')

    def sub(m):
        rel, _old = m.group(1), m.group(2)
        d = digest(rel)
        return f'{rel}?v={d}' if d else m.group(0)

    out = ASSET_RE.sub(sub, src)
    if out != src:
        p.write_text(out, encoding='utf-8')
        changed.append(page)

print(f'已更新 {len(changed)} 頁：' + '、'.join(changed) if changed else '（沒有變更）')
for page in changed:
    for m in ASSET_RE.finditer((ROOT / page).read_text(encoding='utf-8')):
        print(f'  {page}: {m.group(0)}')
