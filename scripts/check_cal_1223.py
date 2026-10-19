#!/usr/bin/env python3
"""在實際網頁上用 DOM 確認 2026-12-23 的訪視行程已出現。"""
from playwright.sync_api import sync_playwright

URL = 'https://amwayfans.github.io/tsust-dept-calendar/'

with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={'width': 1400, 'height': 1000})
    pg.goto(URL, wait_until='networkidle')
    pg.wait_for_timeout(3500)
    # 往後翻到 2026 年 12 月
    for _ in range(24):
        title = pg.evaluate("() => document.querySelector('.fc-toolbar-title')?.innerText || ''")
        if '2026' in title and ('12' in title or '十二月' in title):
            break
        pg.click('.fc-next-button')
        pg.wait_for_timeout(700)
    print('目前顯示：', pg.evaluate("() => document.querySelector('.fc-toolbar-title')?.innerText"))

    info = pg.evaluate("""() => {
        const td = document.querySelector('td[data-date="2026-12-23"]');
        if (!td) return {found: false};
        return {found: true,
                events: [...td.querySelectorAll('.fc-event')].map(e => e.innerText.trim())};
    }""")
    print('12/23 格內的行程：', info)

    # 點開詳情，看說明欄
    if info.get('found') and info.get('events'):
        pg.click('td[data-date="2026-12-23"] .fc-event')
        pg.wait_for_timeout(1200)
        detail = pg.evaluate("""() => {
            const m = document.getElementById('modal');
            if (!m || !m.classList.contains('show')) return '（詳情視窗未開啟）';
            return m.innerText.replace(/\\n{2,}/g, '\\n').trim();
        }""")
        print('\n=== 詳情視窗 ===')
        print(detail)
    b.close()
