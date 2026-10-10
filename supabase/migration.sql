-- ============================================================
-- 系所行事曆 — 資料庫建置
-- 在 Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可以重複執行（idempotent），不會重複建立。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 事件表
-- ------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  description text,
  category    text        not null default 'meeting',
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  all_day     boolean     not null default false,
  location    text,
  visibility  text        not null default 'department',
  created_by  uuid        default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint events_title_len  check (char_length(title) between 1 and 100),
  constraint events_desc_len   check (description is null or char_length(description) <= 1000),
  constraint events_loc_len    check (location is null or char_length(location) <= 100),
  constraint events_category   check (category in ('meeting','course','exam','activity','holiday','other')),
  constraint events_visibility check (visibility in ('department','private')),
  constraint events_time_order check (end_at >= start_at)
);

-- ------------------------------------------------------------
-- 2. 索引（月查詢靠這兩個）
-- ------------------------------------------------------------
create index if not exists events_start_at_idx on public.events (start_at);
create index if not exists events_end_at_idx   on public.events (end_at);

-- ------------------------------------------------------------
-- 3. updated_at 自動更新
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 4. 管理員判斷函式
--    用 JWT 裡的 email 判斷，不需要 SECURITY DEFINER 去讀 auth.users，
--    權限最小、也不會動到 auth schema。
--    ⚠️ 換管理員時改這一行即可。
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'sr0035@tsust.edu.tw';
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------------
-- 5. RLS：匿名可讀（僅 department）、只有管理員可寫
-- ------------------------------------------------------------
alter table public.events enable row level security;

drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select to anon, authenticated
  using (visibility = 'department' or public.is_admin());

drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert on public.events
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete on public.events
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 6. 驗證
-- ------------------------------------------------------------
select 'events 表已建立' as status, count(*) as 目前筆數 from public.events;
