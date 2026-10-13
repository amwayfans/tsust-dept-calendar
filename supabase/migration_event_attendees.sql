-- ============================================================
-- 事件新增「出席人員」（attendees）
-- ------------------------------------------------------------
-- 用途：把出席名單從「說明」裡獨立出來，方便閱讀。
--   說明 → 保留事由、討論議題、來源等敘述
--   出席人員 → 主持人／委員／列席人員等名單
--
-- 可為空（選填）。既有事件的說明不會被自動改動 ——
-- 要搬移舊資料請執行 supabase/extract_attendees.py（預設只預覽）。
--
-- 貼到 Supabase SQL Editor 執行：
--   https://supabase.com/dashboard/project/xhbbgnsnniphsephwsrq/sql/new
-- ============================================================

alter table events
  add column if not exists attendees text;

comment on column events.attendees is
  '出席人員（主持人／委員／列席人員…），與說明分開存放，方便閱讀';

-- 驗證
select id, title, start_at::date as 日期,
       left(coalesce(attendees, ''), 40) as 出席人員,
       (description is not null) as 有說明
  from events
 order by start_at desc
 limit 10;
