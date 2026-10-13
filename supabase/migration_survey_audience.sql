-- ============================================================
-- 調查表新增「誰需填寫」（audience）
-- ------------------------------------------------------------
-- 用途：建立調查時可以指定「這張表要誰填」。
--   all       = 全體（老師＋系務人員）
--   teacher   = 僅老師（例：高中職深耕區域調查）
--   assistant = 僅系務人員
--
-- 預設 'all'，所以既有調查行為不變（除非另外指定）。
-- 系辦端的管理／統計畫面一律不受此欄位影響，永遠看得到全部。
--
-- 貼到 Supabase SQL Editor 執行：
--   https://supabase.com/dashboard/project/xhbbgnsnniphsephwsrq/sql/new
-- ============================================================

alter table surveys
  add column if not exists audience text not null default 'all';

-- 只允許三種值（先移除舊 constraint 再重建，可重複執行）
alter table surveys drop constraint if exists surveys_audience_chk;
alter table surveys
  add constraint surveys_audience_chk
  check (audience in ('all', 'teacher', 'assistant'));

comment on column surveys.audience is
  '誰需填寫：all=全體、teacher=僅老師、assistant=僅系務人員';

-- 高中職深耕區域調查：只有老師需填寫，系務人員不用填
update surveys
   set audience = 'teacher'
 where title like '%深耕%';

-- 驗證
select id, title, status, audience, deadline
  from surveys
 order by sort_order, created_at;
