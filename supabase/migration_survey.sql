-- ============================================================
-- 系所線上調查（意向調查）— 資料庫建置
-- 在 Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可以重複執行（idempotent），不會重複建立。
--
-- ⚠️ 這個資料庫是跟 LINE 機器人共用的（同一個 Supabase 專案）。
--    本檔只新增三張表 + 兩個函式，不碰 events / members / classes / profiles。
--
-- 用途：
--   1. 高中職深耕區域調查（老師勾選想深耕的學校）
--   2. 系上臨時需求調查（隨時新增一個問題，讓老師線上表達意向）
--
-- 設計（115/10/12 使用者裁定）：
--   ‧ 可複選、不限數量
--   ‧ 不設名額上限，只做統計
--   ‧ 老師送出後可看即時統計，但**只看得到人數、看不到姓名**
--   ‧ 只有系辦／系主任看得到姓名（survey_export 有 is_admin 把關）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 調查主表
-- ------------------------------------------------------------
create table if not exists public.surveys (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  description text,
  status      text        not null default 'open',   -- open / closed / draft
  multi       boolean     not null default true,     -- 是否可複選
  max_choices integer,                               -- null = 不限
  show_stats  boolean     not null default true,     -- 老師送出後可否看人數
  allow_edit  boolean     not null default true,     -- 送出後可否修改
  deadline    timestamptz,                           -- null = 不限時間
  sort_order  integer     not null default 0,
  created_by  uuid        default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint surveys_title_len check (char_length(title) between 1 and 100),
  constraint surveys_desc_len  check (description is null or char_length(description) <= 1000),
  constraint surveys_status    check (status in ('open', 'closed', 'draft')),
  constraint surveys_max       check (max_choices is null or max_choices between 1 and 50)
);

-- ------------------------------------------------------------
-- 2. 調查選項（一所學校 = 一個選項）
-- ------------------------------------------------------------
create table if not exists public.survey_options (
  id         uuid primary key default gen_random_uuid(),
  survey_id  uuid    not null references public.surveys(id) on delete cascade,
  label      text    not null,
  note       text,                                   -- 例：目前分配（教師姓名，由系辦填寫）
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),

  constraint survey_options_label_len check (char_length(label) between 1 and 120),
  constraint survey_options_note_len  check (note is null or char_length(note) <= 300)
);

create index if not exists survey_options_survey_idx
  on public.survey_options (survey_id, sort_order);

-- ------------------------------------------------------------
-- 3. 老師的作答（一位老師一份）
--    option_ids 存勾選的選項 id 陣列；複選不限數量，所以用陣列最單純。
-- ------------------------------------------------------------
create table if not exists public.survey_responses (
  id         uuid primary key default gen_random_uuid(),
  survey_id  uuid not null references public.surveys(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  option_ids uuid[] not null default '{}',
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint survey_responses_uniq     unique (survey_id, profile_id),
  constraint survey_responses_note_len check (note is null or char_length(note) <= 500)
);

create index if not exists survey_responses_survey_idx
  on public.survey_responses (survey_id);

-- ------------------------------------------------------------
-- 4. updated_at 自動更新
--    函式名稱帶 survey_ 前綴：這個資料庫跟 LINE 機器人共用，
--    避免以後別的模組用同名通用函式互相覆蓋（沿用 events 的做法）。
-- ------------------------------------------------------------
create or replace function public.survey_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists surveys_touch_updated_at on public.surveys;
create trigger surveys_touch_updated_at
  before update on public.surveys
  for each row execute function public.survey_set_updated_at();

drop trigger if exists survey_responses_touch_updated_at on public.survey_responses;
create trigger survey_responses_touch_updated_at
  before update on public.survey_responses
  for each row execute function public.survey_set_updated_at();

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------
alter table public.surveys          enable row level security;
alter table public.survey_options   enable row level security;
alter table public.survey_responses enable row level security;

-- 5-1 調查：登入者看得到非草稿的調查；只有管理員能改
drop policy if exists surveys_read on public.surveys;
create policy surveys_read on public.surveys
  for select to anon, authenticated
  using (status <> 'draft' or public.is_admin());

drop policy if exists surveys_admin_write on public.surveys;
create policy surveys_admin_write on public.surveys
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5-2 選項：登入者看得到啟用中的選項；只有管理員能改
drop policy if exists survey_options_read on public.survey_options;
create policy survey_options_read on public.survey_options
  for select to anon, authenticated
  using (active or public.is_admin());

drop policy if exists survey_options_admin_write on public.survey_options;
create policy survey_options_admin_write on public.survey_options
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5-3 作答：老師只看得到自己的；管理員看得到全部
drop policy if exists survey_responses_read on public.survey_responses;
create policy survey_responses_read on public.survey_responses
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- 只能新增自己的、而且調查必須是開放中且未過截止
drop policy if exists survey_responses_insert on public.survey_responses;
create policy survey_responses_insert on public.survey_responses
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.surveys s
       where s.id = survey_id
         and s.status = 'open'
         and (s.deadline is null or s.deadline > now())
    )
  );

drop policy if exists survey_responses_update on public.survey_responses;
create policy survey_responses_update on public.survey_responses
  for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists survey_responses_delete on public.survey_responses;
create policy survey_responses_delete on public.survey_responses
  for delete to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------
-- 6. 統計函式（只回人數、不回姓名）
--    用 security definer 繞過 RLS 才能數到別人的作答，
--    但**只回傳 label + 人數**，不會洩漏誰選了什麼。
-- ------------------------------------------------------------
create or replace function public.survey_stats(p_survey uuid)
returns table (option_id uuid, label text, note text, sort_order integer, cnt bigint)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.label,
         o.note,
         o.sort_order,
         (select count(*) from public.survey_responses r
           where r.survey_id = o.survey_id
             and o.id = any(r.option_ids)) as cnt
    from public.survey_options o
   where o.survey_id = p_survey
     and o.active
   order by o.sort_order, o.label;
$$;

grant execute on function public.survey_stats(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 7. 匯出函式（含姓名）—— 只有管理員拿得到
--    回傳「全部教師」左接作答，所以沒填的人也會列出來（看回收率用）。
-- ------------------------------------------------------------
create or replace function public.survey_export(p_survey uuid)
returns table (
  profile_id uuid,
  full_name  text,
  email      text,
  option_ids uuid[],
  note       text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.full_name,
         p.email,
         coalesce(r.option_ids, '{}'::uuid[]),
         r.note,
         r.updated_at
    from public.profiles p
    left join public.survey_responses r
           on r.profile_id = p.id and r.survey_id = p_survey
   where p.role = 'teacher'
     and public.is_admin()          -- ⚠️ 非管理員一律回空集合
   order by p.full_name;
$$;

grant execute on function public.survey_export(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. 驗證
-- ------------------------------------------------------------
select 'surveys'          as 資料表, count(*) as 筆數 from public.surveys
union all
select 'survey_options',  count(*) from public.survey_options
union all
select 'survey_responses', count(*) from public.survey_responses;
