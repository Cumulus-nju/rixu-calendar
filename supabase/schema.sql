-- 日序 · 多设备同步表
--
-- 在 Supabase 项目的 SQL Editor 里整段执行一次即可。
-- 安全模型：匿名 key 是公开的，真正隔离靠这里的 RLS——
-- 每个登录用户只能读写 auth.uid() 等于自己 user_id 的行。

create table if not exists public.rixu_items (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('event', 'source', 'inbox', 'template', 'series')),
  id         text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted    boolean     not null default false,
  primary key (user_id, kind, id)
);

create index if not exists rixu_items_user_updated_idx
  on public.rixu_items (user_id, updated_at);

-- 已经在用旧版表结构（kind 只允许 event/source/inbox/settings）的项目，
-- 重跑本文件时把约束补上，模板和周期才能同步。
alter table public.rixu_items drop constraint if exists rixu_items_kind_check;
alter table public.rixu_items
  add constraint rixu_items_kind_check
  check (kind in ('event', 'source', 'inbox', 'settings', 'template', 'series'));

alter table public.rixu_items enable row level security;

drop policy if exists "rixu own rows" on public.rixu_items;
create policy "rixu own rows"
  on public.rixu_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 可选：注册后要求邮箱确认（Supabase 默认开启）。
-- 想让登录立刻可用，可在 Authentication → Providers → Email 里关闭 Confirm email。
