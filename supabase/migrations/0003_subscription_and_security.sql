-- Pequenos Contos: complementos e endurecimento do schema inicial.
-- Execute DEPOIS de 0001_initial_schema.sql e 0002_session_functions.sql.

-- Assinatura, período de teste e ciclo de vida.
alter table public.subscribers
  drop constraint if exists subscribers_status_check;
alter table public.subscribers
  add constraint subscribers_status_check
  check (status in ('trial','active','inactive','expired','suspended','cancelled'));

alter table public.subscribers
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists admin_notes text;

create index if not exists subscribers_status_expiry_idx
  on public.subscribers(status, expires_at);
create index if not exists subscribers_auth_user_idx
  on public.subscribers(auth_user_id);

-- Histórico imutável de alterações de assinatura e auditoria administrativa.
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  event_type text not null check (event_type in
    ('created','trial_started','activated','renewed','expired','cancelled','suspended','reactivated','plan_changed')),
  old_plan public.subscription_plan,
  new_plan public.subscription_plan,
  old_status text,
  new_status text,
  starts_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscription_events_subscriber_date_idx
  on public.subscription_events(subscriber_id, created_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs(created_at desc);

-- Função central de acesso: conteúdo pago só aparece com assinatura válida.
create or replace function public.has_valid_subscription()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscribers s
    where s.auth_user_id = auth.uid()
      and s.status in ('trial','active')
      and s.expires_at > now()
  );
$$;
revoke all on function public.has_valid_subscription() from public, anon;
grant execute on function public.has_valid_subscription() to authenticated, service_role;

-- A política de leitura de histórias e páginas usa a mesma regra.
drop policy if exists "published or admin stories" on public.stories;
create policy "published stories for entitled users"
on public.stories for select to authenticated
using (
  public.is_admin()
  or (status = 'published' and (is_free or public.has_valid_subscription()))
);

drop policy if exists "pages visible with story" on public.story_pages;
create policy "pages for entitled published stories"
on public.story_pages for select to authenticated
using (
  exists (
    select 1 from public.stories s
    where s.id = story_id
      and s.status = 'published'
      and (public.is_admin() or s.is_free or public.has_valid_subscription())
  )
);

drop policy if exists "questions visible with story" on public.story_questions;
create policy "questions for entitled published stories"
on public.story_questions for select to authenticated
using (
  exists (
    select 1 from public.stories s
    where s.id = story_id
      and s.status = 'published'
      and (public.is_admin() or s.is_free or public.has_valid_subscription())
  )
);

-- Evita que o cliente escolha um perfil de outra família ao gravar progresso.
drop policy if exists "own reads" on public.reads;
create policy "own reads" on public.reads for all to authenticated
using (public.owns_profile(profile_id) or public.is_admin())
with check (public.owns_profile(profile_id) or public.is_admin());

drop policy if exists "own favorites" on public.favorites;
create policy "own favorites" on public.favorites for all to authenticated
using (public.owns_profile(profile_id) or public.is_admin())
with check (public.owns_profile(profile_id) or public.is_admin());

drop policy if exists "own streaks" on public.reading_streaks;
create policy "own streaks" on public.reading_streaks for all to authenticated
using (public.owns_profile(profile_id) or public.is_admin())
with check (public.owns_profile(profile_id) or public.is_admin());

-- Histórico/auditoria: somente administradores consultam; gravação por service role.
alter table public.subscription_events enable row level security;
alter table public.admin_audit_logs enable row level security;
drop policy if exists "admin read subscription events" on public.subscription_events;
create policy "admin read subscription events" on public.subscription_events
for select to authenticated using (public.is_admin());
drop policy if exists "admin read audit logs" on public.admin_audit_logs;
create policy "admin read audit logs" on public.admin_audit_logs
for select to authenticated using (public.is_admin());

-- Atualiza updated_at automaticamente nas tabelas mutáveis.
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscribers_set_updated_at on public.subscribers;
create trigger subscribers_set_updated_at before update on public.subscribers
for each row execute function public.set_updated_at();

drop trigger if exists stories_set_updated_at on public.stories;
create trigger stories_set_updated_at before update on public.stories
for each row execute function public.set_updated_at();

drop trigger if exists reads_set_updated_at on public.reads;
create trigger reads_set_updated_at before update on public.reads
for each row execute function public.set_updated_at();

drop trigger if exists reading_streaks_set_updated_at on public.reading_streaks;
create trigger reading_streaks_set_updated_at before update on public.reading_streaks
for each row execute function public.set_updated_at();

-- Índices úteis para biblioteca, filtros e histórico de leitura.
create index if not exists stories_status_age_idx on public.stories(status, age_range);
create index if not exists stories_category_idx on public.stories(category_id);
create index if not exists story_pages_story_order_idx on public.story_pages(story_id, sort_order);
create index if not exists child_profiles_user_idx on public.child_profiles(user_id);
create index if not exists reads_profile_updated_idx on public.reads(profile_id, updated_at desc);
create index if not exists favorites_story_idx on public.favorites(story_id);

-- IMPORTANTE:
-- 1) Nunca coloque a chave service_role no navegador.
-- 2) A criação do primeiro admin é manual, após criar a conta em Authentication:
--    insert into public.user_roles(user_id, role)
--    values ('UUID_DO_USUARIO_AUTH', 'admin')
--    on conflict (user_id) do update set role = excluded.role;
-- 3) O primeiro admin também deve ser provisionado com uma conta Auth confiável.
