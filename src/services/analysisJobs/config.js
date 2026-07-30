function readPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const JOB_POLL_AFTER_MS = readPositiveInteger('ANALYSIS_JOB_POLL_AFTER_MS', 2_000);
export const JOB_WORKER_POLL_MS = readPositiveInteger('ANALYSIS_JOB_WORKER_POLL_MS', 1_000);
export const JOB_LEASE_SECONDS = readPositiveInteger('ANALYSIS_JOB_LEASE_SECONDS', 30);
export const JOB_HEARTBEAT_MS = readPositiveInteger('ANALYSIS_JOB_HEARTBEAT_MS', 10_000);
export const JOB_RETENTION_HOURS = readPositiveInteger('ANALYSIS_JOB_RETENTION_HOURS', 24);
export const JOB_MAX_QUEUED = readPositiveInteger('ANALYSIS_JOB_MAX_QUEUED', 50);
export const JOB_MAX_ATTEMPTS = readPositiveInteger('ANALYSIS_JOB_MAX_ATTEMPTS', 2);
export const JOB_GLOBAL_CONCURRENCY = readPositiveInteger('ANALYSIS_JOB_GLOBAL_CONCURRENCY', 1);
export const JOB_WORKER_CONCURRENCY = readPositiveInteger('ANALYSIS_JOB_WORKER_CONCURRENCY', 1);
