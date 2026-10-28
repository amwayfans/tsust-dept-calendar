-- 招生負責學校：老師 ←→ 學校（可細到科別）
-- 需求來源：使用者 2026-10-28
--   「新增頁面『招生負責學校』，可以選老師查看招生學校，也可以用學校查詢是哪幾位老師負責。
--     同一間學校有好幾個科的，併成同一間學校查詢。」
--
-- 設計說明：
--   * 一列＝一組（老師, 學校, 科別）；科別可為 NULL（該校未指定科）
--   * 「同一間學校有多個科」不另建學校表：前端用 school 分組即可，
--     避免維護兩張表還要對齊名稱
--   * 讀：登入者即可（與公差/招生記錄一致）；寫：系務人員（can_edit_events）
--   * 老師姓名用 text 而非 FK：名冊異動（離職/新任）時不必先建帳號

create table if not exists public.recruit_schools (
  id            uuid primary key default gen_random_uuid(),
  teacher_name  text not null,
  teacher_emp   text,                          -- 職號（有對到名冊才填）
  school        text not null,
  dept          text,                          -- 科別，NULL＝未分科
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists recruit_schools_school_idx  on public.recruit_schools (school);
create index if not exists recruit_schools_teacher_idx on public.recruit_schools (teacher_name);

comment on table public.recruit_schools is '招生負責學校：一列＝一位老師在一所學校（可細到科）的負責關係';

alter table public.recruit_schools enable row level security;

drop policy if exists recruit_schools_read on public.recruit_schools;
create policy recruit_schools_read on public.recruit_schools
  for select to authenticated using (true);

drop policy if exists recruit_schools_write on public.recruit_schools;
create policy recruit_schools_write on public.recruit_schools
  for all to authenticated
  using (public.can_edit_events())
  with check (public.can_edit_events());
