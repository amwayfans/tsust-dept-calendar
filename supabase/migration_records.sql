-- ============================================================
-- 教師記錄分頁 — 資料庫建置
-- 在 Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可重複執行（idempotent）。
--
-- ⚠️ 這個資料庫是共用的（LINE 機器人 + 行事曆）。
--    本檔只新增 profiles / teacher_roster / teacher_records 三張表，
--    並重用既有的 public.is_admin()，不重新定義它。
--    所有新函式都帶 records_ / 表名前綴，避免撞名。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 學年度換算
--    台灣學年度：8/1 ~ 次年 7/31
--    115 學年度 = 2026/08/01 ~ 2027/07/31
--    例：2026/10 → 115｜2027/03 → 115｜2026/05 → 114
-- ------------------------------------------------------------
create or replace function public.get_academic_year(d date)
returns int
language sql
immutable
as $$
  select (extract(year from d)::int - 1911)
       - case when extract(month from d) < 8 then 1 else 0 end;
$$;

-- ------------------------------------------------------------
-- 1. 教師名冊（系辦預先建立，用來鎖住姓名）
--    姓名一律以這張表為準，不讓老師自己打字，
--    確保統計時同一個人的名字永遠一致。
-- ------------------------------------------------------------
create table if not exists public.teacher_roster (
  email      text primary key,          -- 一律存小寫
  full_name  text not null,
  category   text,
  title      text,
  sort_order int  not null default 0,
  claimed_by uuid,                      -- 已被哪個 auth 帳號認領
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. profiles：一位使用者一列，id 對應 auth.users.id
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'teacher' check (role in ('teacher','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ------------------------------------------------------------
-- 3. teacher_records：招生 / 公差記錄
-- ------------------------------------------------------------
create table if not exists public.teacher_records (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.profiles(id) on delete cascade,
  teacher_name     text not null,
  record_type      text not null check (record_type in ('enrollment','duty')),
  record_date      date not null,
  academic_year    int  not null,
  description      text not null check (char_length(description) between 1 and 200),
  location         text check (location is null or char_length(location) <= 100),
  note             text check (note is null or char_length(note) <= 200),
  entered_by_admin boolean not null default false,
  entered_by       uuid,                 -- 代輸入的管理員
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists teacher_records_date_idx  on public.teacher_records (record_date);
create index if not exists teacher_records_teach_idx on public.teacher_records (teacher_id);
create index if not exists teacher_records_type_idx  on public.teacher_records (record_type);
create index if not exists teacher_records_year_idx  on public.teacher_records (academic_year);

-- ------------------------------------------------------------
-- 4. updated_at 自動更新（函式名稱帶表名前綴，避免撞名）
-- ------------------------------------------------------------
create or replace function public.records_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.records_set_updated_at();

drop trigger if exists teacher_records_touch_updated_at on public.teacher_records;
create trigger teacher_records_touch_updated_at
  before update on public.teacher_records
  for each row execute function public.records_set_updated_at();

-- ------------------------------------------------------------
-- 5. 寫入前的伺服器端把關
--    這一段是關鍵：teacher_name / academic_year 一律由資料庫決定，
--    不接受前端傳來的值。否則老師可以冒用別人的名字寫記錄。
-- ------------------------------------------------------------
create or replace function public.records_before_write()
returns trigger
language plpgsql
as $$
declare
  v_name text;
begin
  -- 姓名一律查 profiles，不信任前端
  select p.full_name into v_name
    from public.profiles p
   where p.id = new.teacher_id;

  if v_name is null or btrim(v_name) = '' then
    raise exception '此帳號不在教師名冊中，無法建立記錄';
  end if;
  new.teacher_name := v_name;

  -- 學年度一律由日期推算
  new.academic_year := public.get_academic_year(new.record_date);

  -- 不可填未來日期
  if new.record_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception '不可填寫未來的日期';
  end if;

  -- 代輸入標記只有管理員能設，其他人一律強制清掉
  if not public.is_admin() then
    new.entered_by_admin := false;
    new.entered_by := null;
  elsif new.entered_by is null then
    new.entered_by := auth.uid();
  end if;

  return new;
end $$;

drop trigger if exists teacher_records_before_write on public.teacher_records;
create trigger teacher_records_before_write
  before insert or update on public.teacher_records
  for each row execute function public.records_before_write();

-- ------------------------------------------------------------
-- 6. 新帳號建立時，自動建立 profiles 並從名冊帶入姓名
-- ------------------------------------------------------------
create or replace function public.records_on_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name
    from public.teacher_roster
   where email = lower(new.email);

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    v_name,                                    -- 名冊沒有就留空，之後寫入會被擋
    case when lower(new.email) = 'sr0035@tsust.edu.tw' then 'admin' else 'teacher' end
  )
  on conflict (id) do nothing;

  if v_name is not null then
    update public.teacher_roster
       set claimed_by = new.id
     where email = lower(new.email)
       and claimed_by is null;
  end if;

  return new;
end $$;

drop trigger if exists records_on_auth_user_created on auth.users;
create trigger records_on_auth_user_created
  after insert on auth.users
  for each row execute function public.records_on_new_user();

-- 已經存在的帳號（例如管理員）補建 profiles
insert into public.profiles (id, email, full_name, role)
select u.id,
       lower(u.email),
       (select r.full_name from public.teacher_roster r where r.email = lower(u.email)),
       case when lower(u.email) = 'sr0035@tsust.edu.tw' then 'admin' else 'teacher' end
  from auth.users u
 where u.email is not null
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------
alter table public.teacher_roster  enable row level security;
alter table public.profiles        enable row level security;
alter table public.teacher_records enable row level security;

-- 名冊：登入者才能讀（前端要顯示姓名對照）
drop policy if exists roster_read on public.teacher_roster;
create policy roster_read on public.teacher_roster
  for select to authenticated using (true);

-- profiles：登入者才能讀；只能改自己的
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 記錄：只有登入者能讀（訪客只看得到統計，見第 8 段）
drop policy if exists records_read on public.teacher_records;
create policy records_read on public.teacher_records
  for select to authenticated using (true);

drop policy if exists records_insert on public.teacher_records;
create policy records_insert on public.teacher_records
  for insert to authenticated
  with check (teacher_id = auth.uid() or public.is_admin());

drop policy if exists records_update on public.teacher_records;
create policy records_update on public.teacher_records
  for update to authenticated
  using (teacher_id = auth.uid() or public.is_admin())
  with check (teacher_id = auth.uid() or public.is_admin());

drop policy if exists records_delete on public.teacher_records;
create policy records_delete on public.teacher_records
  for delete to authenticated
  using (teacher_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------
-- 8. 訪客看的統計：只給「聚合後的次數」，不給任何一筆明細
--    用 security definer 讀 teacher_records，但只回傳加總結果，
--    所以不會洩漏事由、地點等內容。
-- ------------------------------------------------------------
create or replace function public.record_stats(p_year int)
returns table (
  teacher_id       uuid,
  teacher_name     text,
  enrollment_count int,
  duty_count       int,
  total_count      int
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         r.full_name,
         coalesce(sum(case when t.record_type = 'enrollment' then 1 else 0 end), 0)::int,
         coalesce(sum(case when t.record_type = 'duty'       then 1 else 0 end), 0)::int,
         count(t.id)::int
    from public.profiles r
    left join public.teacher_records t
           on t.teacher_id = r.id
          and t.academic_year = p_year
   where r.role = 'teacher'
   group by r.id, r.full_name
   order by count(t.id) desc, r.full_name;
$$;

grant execute on function public.record_stats(int) to anon, authenticated;

-- 可用學年度清單（給下拉選單用）
create or replace function public.record_years()
returns table (academic_year int, record_count int)
language sql
stable
security definer
set search_path = public
as $$
  select t.academic_year, count(*)::int
    from public.teacher_records t
   group by t.academic_year
   order by t.academic_year desc;
$$;

grant execute on function public.record_years() to anon, authenticated;

-- ------------------------------------------------------------
-- 9. 驗收
-- ------------------------------------------------------------
select 'teacher_roster'  as 資料表, count(*) as 筆數 from public.teacher_roster
union all
select 'profiles',        count(*) from public.profiles
union all
select 'teacher_records', count(*) from public.teacher_records;

select public.get_academic_year('2026-10-10'::date) as 應為115,
       public.get_academic_year('2027-03-01'::date) as 應為115,
       public.get_academic_year('2026-05-01'::date) as 應為114;
