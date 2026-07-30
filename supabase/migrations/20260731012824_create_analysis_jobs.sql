create extension if not exists pgcrypto;

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text not null default 'queued'
    check (
      stage in (
        'queued',
        'launching_browser',
        'loading_page',
        'analyzing_accessibility',
        'preparing_result'
      )
    ),
  request jsonb not null,
  screen_reader text not null check (screen_reader in ('voiceover', 'nvda')),
  input_hash text not null,
  idempotency_key_hash text not null unique,
  access_token_hash text not null,
  result jsonb,
  error_code text,
  error_message text,
  cancel_requested boolean not null default false,
  attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists analysis_jobs_claim_idx
  on public.analysis_jobs (status, created_at);
create index if not exists analysis_jobs_expiry_idx
  on public.analysis_jobs (expires_at);

alter table public.analysis_jobs enable row level security;

create or replace function public.create_analysis_job(
  p_idempotency_key_hash text,
  p_access_token_hash text,
  p_input_hash text,
  p_request jsonb,
  p_screen_reader text,
  p_expires_at timestamptz,
  p_max_queued integer
)
returns table(id uuid, status text, conflict boolean, queue_full boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_job public.analysis_jobs%rowtype;
  created_job public.analysis_jobs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('analysis_jobs_queue'));

  select * into existing_job
  from public.analysis_jobs
  where idempotency_key_hash = p_idempotency_key_hash;

  if found then
    return query select
      existing_job.id,
      existing_job.status,
      existing_job.input_hash <> p_input_hash
        or existing_job.access_token_hash <> p_access_token_hash,
      false;
    return;
  end if;

  if (
    select count(*)
    from public.analysis_jobs
    where status = 'queued' and expires_at > now()
  ) >= p_max_queued then
    return query select null::uuid, null::text, false, true;
    return;
  end if;

  insert into public.analysis_jobs (
    request,
    screen_reader,
    input_hash,
    idempotency_key_hash,
    access_token_hash,
    expires_at
  )
  values (
    p_request,
    p_screen_reader,
    p_input_hash,
    p_idempotency_key_hash,
    p_access_token_hash,
    p_expires_at
  )
  returning * into created_job;

  return query select created_job.id, created_job.status, false, false;
end;
$$;

create or replace function public.claim_analysis_job(
  p_worker_id text,
  p_lease_seconds integer,
  p_global_concurrency integer,
  p_max_attempts integer
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('analysis_jobs_claim'));

  update public.analysis_jobs
  set
    status = case when attempt_count >= p_max_attempts then 'failed' else 'queued' end,
    error_code = case when attempt_count >= p_max_attempts then 'INTERNAL_ERROR' else null end,
    error_message = case
      when attempt_count >= p_max_attempts then '작업 실행이 반복해서 중단되었습니다.'
      else null
    end,
    completed_at = case when attempt_count >= p_max_attempts then now() else null end,
    lease_owner = null,
    lease_expires_at = null,
    stage = 'queued'
  where status = 'running' and lease_expires_at < now();

  if (
    select count(*)
    from public.analysis_jobs
    where status = 'running' and lease_expires_at >= now()
  ) >= p_global_concurrency then
    return;
  end if;

  select id into selected_id
  from public.analysis_jobs
  where status = 'queued'
    and expires_at > now()
    and not cancel_requested
    and attempt_count < p_max_attempts
  order by created_at
  for update skip locked
  limit 1;

  if selected_id is null then
    return;
  end if;

  return query
  update public.analysis_jobs
  set
    status = 'running',
    stage = 'launching_browser',
    started_at = coalesce(started_at, now()),
    attempt_count = attempt_count + 1,
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = selected_id
  returning *;
end;
$$;

create or replace function public.cancel_analysis_job(
  p_job_id uuid,
  p_access_token_hash text,
  p_expires_at timestamptz
)
returns setof public.analysis_jobs
language sql
security definer
set search_path = public
as $$
  update public.analysis_jobs
  set
    cancel_requested = true,
    status = case when status = 'queued' then 'cancelled' else status end,
    completed_at = case when status = 'queued' then now() else completed_at end,
    expires_at = case when status = 'queued' then p_expires_at else expires_at end
  where id = p_job_id
    and access_token_hash = p_access_token_hash
  returning *;
$$;

alter table public.analyses
  add column if not exists source_job_id uuid references public.analysis_jobs(id) on delete set null;

create unique index if not exists analyses_user_source_job_idx
  on public.analyses (user_id, source_job_id)
  where source_job_id is not null;

revoke all on function public.create_analysis_job(text, text, text, jsonb, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.claim_analysis_job(text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.cancel_analysis_job(uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.create_analysis_job(
  text,
  text,
  text,
  jsonb,
  text,
  timestamptz,
  integer
) to service_role;
grant execute on function public.claim_analysis_job(text, integer, integer, integer)
  to service_role;
grant execute on function public.cancel_analysis_job(uuid, text, timestamptz)
  to service_role;
