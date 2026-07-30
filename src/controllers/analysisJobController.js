import { JOB_POLL_AFTER_MS } from '../services/analysisJobs/config.js';
import { cancelJob, createJob, getJob } from '../services/analysisJobs/repository.js';

const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getCredentials(req) {
  return {
    accessToken: req.get('X-Analysis-Job-Token') ?? '',
    idempotencyKey: req.get('Idempotency-Key') ?? '',
  };
}

function validateRequest(body) {
  const { url, htmlContent, screenReader } = body ?? {};

  if (Boolean(url) === Boolean(htmlContent)) {
    return false;
  }

  return ['voiceover', 'nvda'].includes(screenReader);
}

function sendInternalError(res, error) {
  console.error('분석 작업 API 오류:', error);
  return res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: '서버 내부 오류가 발생했습니다.',
  });
}

function serializeJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    expiresAt: job.expires_at,
    pollAfterMs: JOB_POLL_AFTER_MS,
    ...(job.status === 'failed'
      ? {
          error: {
            code: job.error_code ?? 'INTERNAL_ERROR',
            message: job.error_message ?? '분석 중 서버 오류가 발생했습니다.',
          },
        }
      : {}),
  };
}

async function findAuthorizedJob(req, res) {
  const { accessToken } = getCredentials(req);

  if (!UUID_PATTERN.test(req.params.jobId) || !SECRET_PATTERN.test(accessToken)) {
    res.status(404).json({ code: 'JOB_NOT_FOUND', message: '분석 작업을 찾을 수 없습니다.' });
    return null;
  }

  const job = await getJob(req.params.jobId, accessToken);

  if (!job) {
    res.status(404).json({ code: 'JOB_NOT_FOUND', message: '분석 작업을 찾을 수 없습니다.' });
    return null;
  }

  if (new Date(job.expires_at).getTime() <= Date.now()) {
    res
      .status(410)
      .json({ code: 'JOB_EXPIRED', message: '분석 작업의 보관 기간이 만료되었습니다.' });
    return null;
  }

  return job;
}

export async function createAnalysisJob(req, res) {
  try {
    const { accessToken, idempotencyKey } = getCredentials(req);

    if (
      !validateRequest(req.body) ||
      !SECRET_PATTERN.test(accessToken) ||
      !SECRET_PATTERN.test(idempotencyKey)
    ) {
      return res.status(400).json({
        code: 'INVALID_REQUEST',
        message: '분석 요청 또는 작업 인증 정보가 올바르지 않습니다.',
      });
    }

    const job = await createJob({ request: req.body, accessToken, idempotencyKey });

    if (job?.conflict) {
      return res.status(409).json({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '같은 요청 키가 다른 분석 요청에 사용되었습니다.',
      });
    }

    if (job?.queue_full) {
      res.set('Retry-After', '10');
      return res.status(429).json({
        code: 'RATE_LIMITED',
        message: '현재 분석 대기열이 가득 찼습니다. 잠시 후 다시 시도해주세요.',
      });
    }

    return res.status(202).json({
      jobId: job.id,
      status: job.status,
      pollAfterMs: JOB_POLL_AFTER_MS,
    });
  } catch (error) {
    return sendInternalError(res, error);
  }
}

export async function getAnalysisJob(req, res) {
  try {
    const job = await findAuthorizedJob(req, res);
    return job ? res.status(200).json(serializeJob(job)) : undefined;
  } catch (error) {
    return sendInternalError(res, error);
  }
}

export async function getAnalysisJobResult(req, res) {
  try {
    const job = await findAuthorizedJob(req, res);

    if (!job) {
      return;
    }

    if (job.status !== 'succeeded') {
      return res.status(409).json({
        code: 'JOB_NOT_READY',
        message: '분석 결과가 아직 준비되지 않았습니다.',
      });
    }

    return res.status(200).json(job.result);
  } catch (error) {
    return sendInternalError(res, error);
  }
}

export async function cancelAnalysisJob(req, res) {
  try {
    const job = await findAuthorizedJob(req, res);

    if (!job) {
      return;
    }

    const cancelledJob = await cancelJob(req.params.jobId, getCredentials(req).accessToken);
    return res.status(202).json(serializeJob(cancelledJob ?? job));
  } catch (error) {
    return sendInternalError(res, error);
  }
}
