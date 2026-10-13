#!/usr/bin/env python3
"""把 events.description 裡的「出席人員」抽出來，改放到獨立的 attendees 欄位。

用途：說明欄現在把主持人／委員／列席人員／討論議題／來源全部擠在一起，
      閱讀困難。抽出來後，事件詳情可以單獨列出「出席人員」。

安全原則：
  1. 預設 dry-run，只印出「會怎麼改」，不寫入。
  2. 只處理「認得出來」的格式；抽不乾淨的一律跳過（寧可漏，不可改壞）。
  3. 抽出後的說明若會變得過短（< 20 字）也跳過 —— 代表整段都是出席人員，
     這種情形的說明本來就只有出席名單，留著不動比較安全。
  4. 加 --apply 才會真的寫入，且只更新 attendees 與 description 兩個欄位。

用法：
  python3 extract_attendees.py             # 預覽
  python3 extract_attendees.py --apply     # 真的寫入
"""
import argparse
import json
import pathlib
import re
import urllib.error
import urllib.request

ENV = pathlib.Path.home() / '.config/ae-dashboard/.env'
env = dict(l.strip().split('=', 1) for l in ENV.read_text().splitlines()
           if '=' in l and not l.startswith('#'))
URL = env['SUPABASE_URL'].rstrip('/')
KEY = env['SUPABASE_SERVICE_KEY'].strip('"')


def rest(path, method='GET', body=None, prefer=None):
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}',
               'Content-Type': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f'{URL}/rest/v1/{path}', method=method,
                                 headers=headers, data=data)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


# 出席人員的標籤（依長度排序，長的要先比對，否則「出席」會先吃掉「出席人員」）
LABELS = ['列席人員', '出席人員', '與會人員', '參加人員', '主持人', '出席', '列席', '主席', '委員']

# 抽到這裡就停（這些是「說明」的其他段落，不屬於出席人員）
STOPS = ['來源', '討論議題', '討論事項', '聯絡', '開會事由', '提案', '備註', '議題',
         '說明', '附件', '開會通知', '時間', '地點']

# 例外：「停止字」後面接這些字時，其實還在名單裡，不能停。
# 例：「…劉白梅研發長、提案單位」→「提案單位」是出席名單的一部分。
STOP_EXCEPTIONS = {
    '提案': ['單位'],
}

# 標籤後面接的分隔符
COLONS = '：:'


def extract(desc):
    """回傳 (attendees, rest)；認不出來時回傳 (None, desc)。"""
    if not desc:
        return None, desc

    text = desc.replace('\u3000', ' ').replace('\r\n', '\n')
    chunks = []          # 抽出的出席人員片段 (start, end)
    found = []

    for label in LABELS:
        for m in re.finditer(re.escape(label) + f'[{COLONS}]', text):
            if any(s <= m.start() < e for s, e in chunks):
                continue                      # 已被較長的標籤吃掉
            start = m.start()
            # 值的結束：下一個標籤、下一個 STOP 關鍵字、或換行
            end = len(text)
            for other in LABELS + STOPS:
                for m2 in re.finditer(re.escape(other) + f'[{COLONS}]?', text[m.end():]):
                    pos = m.end() + m2.start()
                    # 例外：「提案單位」不是段落，是名單的一部分
                    tail = text[pos + len(other):pos + len(other) + 4]
                    if any(tail.startswith(x) for x in STOP_EXCEPTIONS.get(other, [])):
                        continue
                    # 找下一個標籤/停止字（要有冒號，或本身是 STOP）
                    if other in STOPS:
                        end = min(end, pos)
                    else:
                        if text[pos + len(other):pos + len(other) + 1] not in COLONS:
                            continue
                        end = min(end, pos)
                    break
            # 只有「空行」才算段落結束 —— 單一換行常是 email 排版造成的折行，
            # 名單會被切一半（法規小組會議就是這樣）。
            blank = text.find('\n\n', m.end())
            if blank != -1:
                end = min(end, blank)
            if end <= m.end():
                continue
            chunks.append((start, end))
            # 折行接回去，讓名單讀起來是連續的
            value = re.sub(r'\s*\n\s*', ' ', text[m.end():end]).strip(' 。，、;；')
            value = re.sub(r'\s{2,}', ' ', value)
            if value:
                found.append((label, value))

    if not found:
        return None, desc

    chunks.sort()
    # 從後往前刪，索引才不會跑掉
    rest = desc
    for s, e in sorted(chunks, reverse=True):
        rest = rest[:s] + rest[e:]
    rest = re.sub(r'[ \t]{2,}', ' ', rest)
    rest = re.sub(r'\n{3,}', '\n\n', rest).strip()

    # 太短就放棄（整段都是出席人員 → 不要動它）
    if len(rest) < 20:
        return None, desc

    ORDER = ['主持人', '主席', '出席', '出席人員', '與會人員', '參加人員', '委員', '列席', '列席人員']
    found.sort(key=lambda kv: (ORDER.index(kv[0]) if kv[0] in ORDER else 99))
    attendees = '\n'.join(f'{lab}：{val}' for lab, val in found)
    return attendees, rest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='真的寫入（預設只預覽）')
    args = ap.parse_args()

    # 還沒跑 migration 時沒有 attendees 欄位 → 自動退回不含該欄位
    try:
        rows = rest('events?select=id,title,start_at,category,description,attendees&order=start_at')
    except urllib.error.HTTPError:
        rows = rest('events?select=id,title,start_at,category,description&order=start_at')
        for r in rows:
            r.setdefault('attendees', None)
    rows = rows or []
    print(f'共 {len(rows)} 筆事件\n')

    plan = []
    for r in rows:
        if r.get('attendees'):
            continue                      # 已經有出席人員了
        att, newdesc = extract(r.get('description') or '')
        if not att:
            continue
        plan.append((r, att, newdesc))

    if not plan:
        print('沒有需要處理的事件。')
        return

    print(f'認得出出席人員的有 {len(plan)} 筆：\n')
    for r, att, newdesc in plan:
        print('=' * 70)
        print(f"{r['start_at'][:10]}  {r['title']}")
        print('-' * 70)
        print('【新的「出席人員」欄位】')
        for line in att.split('\n'):
            print('   ', line)
        print()
        print('【說明欄（改後）】')
        for line in newdesc.split('\n'):
            print('   ', line)
        print()

    if not args.apply:
        print('=' * 70)
        print('以上只是預覽，尚未寫入任何資料。')
        print('確認無誤後執行：python3 extract_attendees.py --apply')
        return

    print('=' * 70)
    n_ok = 0
    for r, att, newdesc in plan:
        try:
            rest(f"events?id=eq.{r['id']}", 'PATCH',
                 {'attendees': att, 'description': newdesc}, prefer='return=minimal')
            n_ok += 1
            print(f"  ✓ 已更新 {r['title']}")
        except urllib.error.HTTPError as e:
            print(f"  ✗ {r['title']} → HTTP {e.code} {e.read().decode()[:140]}")
    print(f'\n完成：{n_ok}/{len(plan)} 筆')


if __name__ == '__main__':
    main()
