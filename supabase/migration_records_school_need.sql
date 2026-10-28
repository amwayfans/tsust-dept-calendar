-- 公差/招生記錄：新增「對接學校之需求」欄位（選填，預設「無」）
-- 需求來源：使用者 2026-10-28
--   「填表欄位再多增加一項：對接學校之需求（選填，預設值「無」）」
--
-- 設計說明：
--   * NOT NULL + DEFAULT '無'：既有 9 筆記錄自動補「無」，前端不必處理 null
--   * 型別用 text 而非 varchar：與 location/note 一致，長度限制交給前端 maxlength
--   * 不改 RLS：欄位隸屬於既有 teacher_records，讀寫政策不需調整

alter table public.teacher_records
  add column if not exists school_need text not null default '無';

comment on column public.teacher_records.school_need is
  '對接學校之需求（選填，預設「無」）— 招生/公差至他校時，對方提出的需求';
