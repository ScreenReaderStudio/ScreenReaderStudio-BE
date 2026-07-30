import { createHash } from 'node:crypto';

import { supabase } from '../supabaseClient.js';
import { JOB_MAX_QUEUED, JOB_RETENTION_HOURS } from './config.js';

export function hashSecret(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashAnalysisInput(request) {
  return hashSecret(
    JSON.stringify({
      htmlContent: request.htmlContent ?? null,
      screenReader: request.screenReader,
      url: request.url ?? null,
    })
  );
}

export async function createJob({ request, accessToken, idempotencyKey }) {
  const expiresAt = new Date(Date.now() + JOB_RETENTION_HOURS * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabase.rpc('create_analysis_job', {
    p_access_token_hash: hashSecret(accessToken),
    p_expires_at: expiresAt,
    p_idempotency_key_hash: hashSecret(idempotencyKey),
    p_input_hash: hashAnalysisInput(request),
    p_max_queued: JOB_MAX_QUEUED,
    p_request: request,
    p_screen_reader: request.screenReader,
  });

  if (error) {
    throw new Error('분석 작업 생성에 실패했습니다.', { cause: error });
  }

  return data?.[0];
}

export async function getJob(jobId, accessToken) {
  const { data, error } = await supabase
    .from('analysis_jobs')
    .select(
      'id,status,stage,result,screen_reader,error_code,error_message,created_at,started_at,completed_at,expires_at,cancel_requested'
    )
    .eq('id', jobId)
    .eq('access_token_hash', hashSecret(accessToken))
    .maybeSingle();

  if (error) {
    throw new Error('분석 작업 조회에 실패했습니다.', { cause: error });
  }

  return data;
}

export async function cancelJob(jobId, accessToken) {
  const expiresAt = new Date(Date.now() + JOB_RETENTION_HOURS * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabase.rpc('cancel_analysis_job', {
    p_access_token_hash: hashSecret(accessToken),
    p_expires_at: expiresAt,
    p_job_id: jobId,
  });

  if (error) {
    throw new Error('분석 작업 취소에 실패했습니다.', { cause: error });
  }

  return data?.[0] ?? null;
}

export async function claimJob({ workerId, leaseSeconds, globalConcurrency, maxAttempts }) {
  const { data, error } = await supabase.rpc('claim_analysis_job', {
    p_global_concurrency: globalConcurrency,
    p_lease_seconds: leaseSeconds,
    p_max_attempts: maxAttempts,
    p_worker_id: workerId,
  });

  if (error) {
    throw new Error('분석 작업 claim에 실패했습니다.', { cause: error });
  }

  return data?.[0] ?? null;
}

export async function heartbeatJob(jobId, workerId, leaseSeconds) {
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1_000).toISOString();
  const { data, error } = await supabase
    .from('analysis_jobs')
    .update({ lease_expires_at: leaseExpiresAt })
    .eq('id', jobId)
    .eq('lease_owner', workerId)
    .eq('status', 'running')
    .select('cancel_requested')
    .maybeSingle();

  if (error) {
    throw new Error('분석 작업 heartbeat에 실패했습니다.', { cause: error });
  }

  return data;
}

export async function releaseJob(jobId, workerId) {
  const { error } = await supabase
    .from('analysis_jobs')
    .update({
      lease_expires_at: null,
      lease_owner: null,
      stage: 'queued',
      status: 'queued',
    })
    .eq('id', jobId)
    .eq('lease_owner', workerId)
    .eq('status', 'running');

  if (error) {
    throw new Error('분석 작업 lease 해제에 실패했습니다.', { cause: error });
  }
}

export async function updateJobStage(jobId, workerId, stage) {
  const { error } = await supabase
    .from('analysis_jobs')
    .update({ stage })
    .eq('id', jobId)
    .eq('lease_owner', workerId)
    .eq('status', 'running');

  if (error) {
    throw new Error('분석 작업 단계 저장에 실패했습니다.', { cause: error });
  }
}

async function finishJob(jobId, workerId, values) {
  const expiresAt = new Date(Date.now() + JOB_RETENTION_HOURS * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabase
    .from('analysis_jobs')
    .update({
      ...values,
      completed_at: new Date().toISOString(),
      expires_at: expiresAt,
      lease_expires_at: null,
      lease_owner: null,
    })
    .eq('id', jobId)
    .eq('lease_owner', workerId)
    .eq('status', 'running')
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error('분석 작업 완료 상태 저장에 실패했습니다.', { cause: error });
  }

  return Boolean(data);
}

export function completeJob(jobId, workerId, result) {
  return finishJob(jobId, workerId, {
    error_code: null,
    error_message: null,
    result,
    status: 'succeeded',
  });
}

export function failJob(jobId, workerId, { code, message }) {
  return finishJob(jobId, workerId, {
    error_code: code,
    error_message: message,
    result: null,
    status: 'failed',
  });
}

export function markJobCancelled(jobId, workerId) {
  return finishJob(jobId, workerId, {
    error_code: null,
    error_message: null,
    result: null,
    status: 'cancelled',
  });
}

export async function cleanupExpiredJobs() {
  const { error } = await supabase
    .from('analysis_jobs')
    .delete()
    .lt('expires_at', new Date().toISOString());

  if (error) {
    throw new Error('만료된 분석 작업 정리에 실패했습니다.', { cause: error });
  }
}
