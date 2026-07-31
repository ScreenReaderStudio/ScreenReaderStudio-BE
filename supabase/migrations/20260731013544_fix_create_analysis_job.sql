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
    from public.analysis_jobs as jobs
    where jobs.status = 'queued' and jobs.expires_at > now()
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

revoke all on function public.create_analysis_job(text, text, text, jsonb, text, timestamptz, integer)
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
