-- ============================================================
-- 教師記錄 v2 — 助理權限 + 當日照片
-- 在 Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可重複執行（idempotent）。
--
-- 這次只動「教師記錄」相關的東西：
--   1. profiles.role 新增 'assistant'
--   2. 新增 is_record_manager()（管理員 或 助理）
--   3. teacher_records 加照片欄位
--   4. RLS / trigger 改用 is_record_manager()
--   5. 新增助理名單表 record_assistants
--   6. Storage 建立私有照片桶 record-photos
--
-- ⚠️ events（行事曆）完全不動，仍只有 is_admin() 能寫。
-- ⚠️ 這個資料庫是共用的（LINE 機器人 + 行事曆），
--    所有新函式都帶明確前綴，避免撞名。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 助理名單表（先建，後面的函式會用到）
--    這張表同時決定「誰是助理」與「助理的姓名從哪來」。
--    姓名不讓使用者自己打，確保記錄上的名字永遠一致。
-- ------------------------------------------------------------
create table if not exists public.record_assistants (
  email      text primary key,          -- 一律存小寫
  full_name  text not null,
  note       text,
  created_at timestamptz not null default now()
);

insert into public.record_assistants (email, full_name, note) values
  ('sr0035@tsust.edu.tw', '游忠達', '系助理（同時為管理員）'),
  ('sg0098@tsust.edu.tw', '顏志明', '系助理')
on conflict (email) do update
  set full_name = excluded.full_name,
      note      = excluded.note;

alter table public.record_assistants enable row level security;

drop policy if exists assistants_read on public.record_assistants;
create policy assistants_read on public.record_assistants
  for select to authenticated using (true);


-- ------------------------------------------------------------
-- 2. profiles.role 允許 'assistant'
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('teacher', 'admin', 'assistant'));


-- ------------------------------------------------------------
-- 3. 記錄管理者判斷：管理員 或 助理
--    助理只能管「教師記錄」，不能動行事曆 —— events 仍用 is_admin()。
--    用 security definer 讀 profiles，因為 RLS 會在讀表前先問這個函式，
--    不這樣寫會遞迴。
-- ------------------------------------------------------------
create or replace function public.is_record_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (
           select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'assistant'
         );
$$;

grant execute on function public.is_record_manager() to anon, authenticated;


-- ------------------------------------------------------------
-- 4. teacher_records 加照片欄位
--    photo_path：Storage 內的路徑（格式 {teacher_id}/{uuid}.jpg）
--    photo_name：原始檔名，方便人眼對照
-- ------------------------------------------------------------
alter table public.teacher_records
  add column if not exists photo_path text;
alter table public.teacher_records
  add column if not exists photo_name text;


-- ------------------------------------------------------------
-- 5. 寫入前的伺服器端把關（改用 is_record_manager）
--    姓名 / 學年度一律由資料庫決定，不接受前端傳來的值。
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

  -- 代輸入標記只有記錄管理者（管理員／助理）能設，其他人一律強制清掉
  if not public.is_record_manager() then
    new.entered_by_admin := false;
    new.entered_by := null;
  elsif new.entered_by is null then
    new.entered_by := auth.uid();
  end if;

  return new;
end $$;


-- ------------------------------------------------------------
-- 6. RLS：記錄的增 / 改 / 刪改用 is_record_manager()
--    教師本人仍可管理自己的記錄（原本就有的行為，不變）。
-- ------------------------------------------------------------
drop policy if exists records_insert on public.teacher_records;
create policy records_insert on public.teacher_records
  for insert to authenticated
  with check (teacher_id = auth.uid() or public.is_record_manager());

drop policy if exists records_update on public.teacher_records;
create policy records_update on public.teacher_records
  for update to authenticated
  using (teacher_id = auth.uid() or public.is_record_manager())
  with check (teacher_id = auth.uid() or public.is_record_manager());

drop policy if exists records_delete on public.teacher_records;
create policy records_delete on public.teacher_records
  for delete to authenticated
  using (teacher_id = auth.uid() or public.is_record_manager());

-- profiles：只有管理員能改別人的；助理只能改自己
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());


-- ------------------------------------------------------------
-- 7. 新帳號建立時，自動建 profiles
--    姓名來源：教師名冊 → 助理名單 → 留空
--    角色來源：管理員 → 助理 → 教師
-- ------------------------------------------------------------
create or replace function public.records_on_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  select full_name into v_name
    from public.teacher_roster
   where email = lower(new.email);

  if v_name is null then
    select full_name into v_name
      from public.record_assistants
     where email = lower(new.email);
  end if;

  v_role := case
    when lower(new.email) = 'sr0035@tsust.edu.tw' then 'admin'
    when exists (select 1 from public.record_assistants a
                  where a.email = lower(new.email)) then 'assistant'
    else 'teacher'
  end;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, lower(new.email), v_name, v_role)
  on conflict (id) do nothing;

  if v_name is not null then
    update public.teacher_roster
       set claimed_by = new.id
     where email = lower(new.email)
       and claimed_by is null;
  end if;

  return new;
end $$;

-- 已存在的帳號補正（例如管理員的姓名，或先建好的助理帳號）
update public.profiles p
   set full_name = coalesce(a.full_name, p.full_name),
       role      = 'assistant'
  from public.record_assistants a
 where lower(p.email) = a.email
   and a.email <> 'sr0035@tsust.edu.tw';

update public.profiles p
   set full_name = coalesce(a.full_name, p.full_name)
  from public.record_assistants a
 where lower(p.email) = a.email
   and a.email = 'sr0035@tsust.edu.tw';


-- ------------------------------------------------------------
-- 8. Storage：私有照片桶
--    路徑規則 {teacher_id}/{uuid}.{ext}
--     → 教師只能上傳到自己資料夾，記錄管理者可上傳到任何資料夾
--     → 讀取：登入者皆可（與記錄明細的權限一致）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'record-photos', 'record-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

drop policy if exists record_photos_read on storage.objects;
create policy record_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'record-photos');

drop policy if exists record_photos_insert on storage.objects;
create policy record_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'record-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_record_manager()
    )
  );

drop policy if exists record_photos_delete on storage.objects;
create policy record_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'record-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_record_manager()
    )
  );


-- ------------------------------------------------------------
-- 9. 驗收
-- ------------------------------------------------------------
select 'record_assistants' as 資料表, count(*) as 筆數 from public.record_assistants
union all
select 'profiles',         count(*) from public.profiles
union all
select 'teacher_records',  count(*) from public.teacher_records;

-- 應該看到 游忠達 / 顏志明 兩位，且角色分別是 admin / assistant
select p.full_name as 姓名, p.email as 信箱, p.role as 角色
  from public.profiles p
 where p.role in ('admin', 'assistant')
 order by p.role, p.full_name;

-- 照片桶應該存在且 public = false
select id as 桶名稱, public as 是否公開, file_size_limit as 大小上限
  from storage.buckets
 where id = 'record-photos';

-- 新的照片欄位應該存在
select column_name as 欄位, data_type as 型別
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'teacher_records'
   and column_name in ('photo_path', 'photo_name');
