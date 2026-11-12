-- Fit Check schema. Run once in the Supabase SQL editor, then set your owner email at the bottom.

-- Every user document: profile, insights, closet/<item_id>, inspo/<id>, outfits/<id>.
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  path       text        not null check (char_length(path) between 1 and 120),
  data       jsonb       not null check (pg_column_size(data) < 400000),   -- photos are ~100 KB data URLs
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);
alter table public.docs enable row level security;
drop policy if exists "own docs" on public.docs;
create policy "own docs" on public.docs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Who may read all feedback. No policies: only reachable through is_owner().
create table if not exists public.owners (email text primary key);
alter table public.owners enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owners where lower(email) = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Feedback: anyone signed in writes their own; only owners read.
create table if not exists public.feedback (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  email      text,
  body       text        not null check (char_length(body) between 1 and 2000),
  rating     int         check (rating between 1 and 5),
  view       text        check (char_length(view) <= 20),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "write own feedback" on public.feedback;
create policy "write own feedback" on public.feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "owners read feedback" on public.feedback;
create policy "owners read feedback" on public.feedback for select to authenticated using (public.is_owner());

-- Per-user daily AI call counter. No policies: only the server function (service role) touches it.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  calls   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.bump_ai_usage(p_user uuid, p_cap int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.ai_usage (user_id, day, calls) values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into n;
  return n <= p_cap;
end $$;
revoke all on function public.bump_ai_usage(uuid, int) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid, int) to service_role;

-- Replace with the email you sign in with, then run:
-- insert into public.owners (email) values ('you@example.com');
