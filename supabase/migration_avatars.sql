-- ============================================================
-- 教師頭像：Storage 桶 + profiles.avatar_url
-- 可重複執行（idempotent）。不影響行事曆與教師記錄的既有權限。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 頭像桶
--    public = true：照片本來就在系網公開頁面上，
--    且檔名用不可猜的 UUID，不會增加曝光。
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ------------------------------------------------------------
-- 2. 讀取政策：任何人可讀（公開桶，頭像本來就要顯示給大家看）
-- ------------------------------------------------------------
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

-- ------------------------------------------------------------
-- 3. 寫入政策：只有管理員能上傳／覆蓋／刪除
--    前端不提供上傳介面，一律由系辦以腳本維護。
-- ------------------------------------------------------------
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_admin());

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

-- ------------------------------------------------------------
-- 4. profiles 增加頭像欄位
-- ------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  '教師頭像的公開網址；空值時前端顯示姓名首字的圓形替代圖。';

-- ------------------------------------------------------------
-- 5. 驗收
-- ------------------------------------------------------------
select '頭像桶' as 項目,
       id as 值,
       case when public then '公開讀取' else '需登入' end as 說明
  from storage.buckets where id = 'avatars'
union all
select '頭像欄位',
       column_name,
       data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'profiles'
   and column_name = 'avatar_url'
union all
select '已有頭像的教師',
       count(*)::text,
       '人'
  from public.profiles
 where avatar_url is not null and avatar_url <> '';
