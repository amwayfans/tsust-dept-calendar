-- ============================================================
-- 教師名冊 — 範例檔
--
-- ⚠️ 真正含 19 位老師信箱的名冊檔（seed_roster.sql）刻意不進版控，
--    因為這個 repo 是公開的。實際檔案請跟系辦索取，或在
--    G:\folder_tmp\AE Dashboard\資料庫\ 底下取得。
--
-- 用法：把下面的格式改成實際名單，存成 seed_roster.sql 後執行。
--      可重複執行（on conflict 會更新既有資料）。
--
-- 姓名一律以這張表為準，老師無法自行輸入或修改，
-- 這樣統計時同一個人不會因為打字差異被算成兩個人。
-- ============================================================

insert into public.teacher_roster (email, full_name, category, title, sort_order)
values
  ('teacher01@example.edu.tw', '王小明', '專任教師', '副教授',   1),
  ('teacher02@example.edu.tw', '陳大文', '專任教師', '助理教授', 2)
on conflict (email) do update
  set full_name  = excluded.full_name,
      category   = excluded.category,
      title      = excluded.title,
      sort_order = excluded.sort_order;

-- 查看目前名冊
select full_name as 姓名, email as 信箱, category as 類別, title as 職稱
  from public.teacher_roster
 order by sort_order;

-- 移除某位老師
-- delete from public.teacher_roster where email = 'teacher01@example.edu.tw';
