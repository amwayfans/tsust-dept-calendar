-- ══════════════════════════════════════════════════════════════
--  教室課表查詢功能 — 建表與權限
--  台鋼科技大學 機械與自動化工程系 ｜ 2026-10-13
--
--  使用方式：整份複製貼到 Supabase SQL Editor 執行
--  https://supabase.com/dashboard/project/xhbbgnsnniphsephwsrq/sql/new
--
--  設計重點：
--   1. 教室「隨學期增減」→ 教室清單不寫死，由資料本身決定，
--      並且用 semester 欄位區分學期，新學期直接匯入新資料即可。
--   2. 權限依使用者裁定「登入後才看得到」：
--        讀取 → 只給 authenticated（未登入完全讀不到）
--        寫入 → 只給系辦（admin／assistant，沿用現有 is_record_manager()）
--      匯入資料時走 service_role，不受 RLS 限制。
-- ══════════════════════════════════════════════════════════════

create table if not exists public.room_schedule (
  id          bigserial primary key,
  semester    text      not null,               -- 例：'115-1'
  room        text      not null,               -- 教室，例：'化104'（隨學期增減，不寫死）
  day         smallint  not null check (day between 1 and 7),    -- 1=一 … 7=日
  period      smallint  not null check (period between 1 and 20), -- 節次序號（1~10 為日間，13~17 對應 A~E 夜間課）
  period_label text     not null,               -- 顯示用節次，例：'1'…'10'、'A'~'E'（夜間課）
  start_time  text,                             -- 例：'08:10'（週間與週末時段不同，故逐筆存）
  end_time    text,
  course      text      not null,
  teacher     text,
  class_name  text,                             -- 通識／院課程沒有班級，允許空值
  created_at  timestamptz not null default now()
);

comment on table public.room_schedule is
  '教室課表：教室 × 星期 × 節次 → 課程／授課老師／班級。資料來源為教務系統匯出的教室課表 PDF，由解析程式匯入。節次含進修部夜間課 A~E。';

-- 查詢用的索引
create index if not exists room_schedule_sem_room_idx
  on public.room_schedule (semester, room, day, period);
create index if not exists room_schedule_sem_teacher_idx
  on public.room_schedule (semester, teacher);

-- 防重複（course／teacher 可為空，用 coalesce 才能正確比對）
create unique index if not exists room_schedule_uniq_idx
  on public.room_schedule (semester, room, day, period,
                           coalesce(course, ''), coalesce(teacher, ''));

-- ── 權限 ────────────────────────────────────────────────────
alter table public.room_schedule enable row level security;

-- 讀取：只有登入者看得到（未登入連一筆都讀不到）
drop policy if exists room_schedule_read on public.room_schedule;
create policy room_schedule_read on public.room_schedule
  for select to authenticated
  using (true);

-- 寫入：只給系辦（admin／assistant）。前端不會用到，
--       純粹是萬一有人想從前端寫入時的保險。
drop policy if exists room_schedule_write on public.room_schedule;
create policy room_schedule_write on public.room_schedule
  for all to authenticated
  using (public.is_record_manager())
  with check (public.is_record_manager());

-- ── 驗證（執行後應該看到 0 筆與 policy 兩筆）─────────────────
-- select count(*) from public.room_schedule;
-- select policyname, cmd, roles::text from pg_policies
--   where tablename = 'room_schedule';
