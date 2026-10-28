-- 事件的新增／修改／刪除：開放給系務人員（admin + assistant）
-- 需求來源：使用者 2026-10-28「顏志明、莊美雲 也要可以新增、修改、刪除事件」
--
-- 為什麼不直接放寬 is_admin()：
--   is_admin() 目前寫死「登入信箱 = sr0035@tsust.edu.tw」，而且被 12 張表共用
--   （teacher_private、surveys、mail_contacts、external_contacts…）。
--   把 is_admin() 放寬等於讓助理同時取得教師私密資料與問卷管理權，超出本次需求。
--   → 另建一支只給 events 用的 can_edit_events()。
--
-- is_assistant() 的定義是 profiles.role in ('admin','assistant')，目前對應：
--   sr0035@ 游忠達(admin)、sg0098@ 顏志明(assistant)、sr0030@ 莊美雲(assistant)

create or replace function public.can_edit_events()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_admin() or public.is_assistant();
$$;

comment on function public.can_edit_events() is
  '誰可以新增/修改/刪除 events：系辦管理員（is_admin）或系務人員（profiles.role in admin/assistant）';

drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert on public.events
  for insert to authenticated
  with check (public.can_edit_events());

drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events
  for update to authenticated
  using (public.can_edit_events())
  with check (public.can_edit_events());

drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete on public.events
  for delete to authenticated
  using (public.can_edit_events());
