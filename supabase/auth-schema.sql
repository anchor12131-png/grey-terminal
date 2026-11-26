-- Supabase Auth schema reference for 灰星终端.
-- This file describes a fresh-install schema only. Existing tables need a
-- reviewed data migration; do not run it blindly over the legacy text owner_id.
-- RLS policies are managed separately.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  role text not null default 'player'
    check (role in ('player', 'admin'))
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists characters_owner_status_updated_idx
  on public.characters (owner_id, status, updated_at desc);
