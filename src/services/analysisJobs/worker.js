import { randomUUID } from 'node:crypto';

import { analyzeAccessibility } from '../analysis/index.js';
import { AnalysisCancelledError, AnalysisError } from '../analysis/errors.js';
import {
  JOB_GLOBAL_CONCURRENCY,
  JOB_HEARTBEAT_MS,
  JOB_LEASE_SECONDS,
  JOB_MAX_ATTEMPTS,
  JOB_WORKER_CONCURRENCY,
  JOB_WORKER_POLL_MS,
} from './config.js';
import {
  claimJob,
  cleanupExpiredJobs,
  completeJob,
  failJob,
  heartbeatJob,
  markJobCancelled,
  releaseJob,
  updateJobStage,
} from './repository.js';

class WorkerShutdownError extends Error {}

function delay(ms) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

export function createAnalysisWorker({
  analyze = analyzeAccessibility,
  workerId = `${process.pid}-${randomUUID()}`,
} = {}) {
  let running = false;
  let stopping = false;
  const activeControllers = new Map();
  const activeTasks = new Set();

  async function processJob(job) {
    const controller = new AbortController();
    let heartbeatFailures = 0;
    let heartbeatRunning = false;
    activeControllers.set(job.id, controller);

    const heartbeat = setInterval(async () => {
      if (heartbeatRunning) {
        return;
      }

      heartbeatRunning = true;
      try {
        const current = await heartbeatJob(job.id, workerId, JOB_LEASE_SECONDS);
        heartbeatFailures = 0;

        if (!current || current.cancel_requested) {
          controller.abort(new AnalysisCancelledError());
        }
      } catch (error) {
        heartbeatFailures += 1;
        console.error('분석 작업 heartbeat 오류:', error);

        if (heartbeatFailures >= 2) {
          controller.abort(new Error('작업 lease를 갱신할 수 없습니다.'));
        }
      } finally {
        heartbeatRunning = false;
      }
    }, JOB_HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      const result = await analyze(job.request, {
        signal: controller.signal,
        onProgress: (stage) => updateJobStage(job.id, workerId, stage),
      });
      await completeJob(job.id, workerId, {
        ...result,
        selectedScreenReader: job.screen_reader,
      });
    } catch (error) {
      const finalError = controller.signal.aborted ? controller.signal.reason : error;

      if (finalError instanceof WorkerShutdownError) {
        await releaseJob(job.id, workerId);
      } else if (finalError instanceof AnalysisCancelledError) {
        await markJobCancelled(job.id, workerId);
      } else {
        const analysisError = finalError instanceof AnalysisError ? finalError : null;
        await failJob(job.id, workerId, {
          code: analysisError?.code ?? 'INTERNAL_ERROR',
          message: analysisError?.message ?? '분석 중 서버 오류가 발생했습니다.',
        });
      }
    } finally {
      clearInterval(heartbeat);
      activeControllers.delete(job.id);
    }
  }

  function trackTask(task) {
    activeTasks.add(task);
    task.finally(() => activeTasks.delete(task));
  }

  async function loop() {
    if (running) {
      return;
    }

    running = true;

    while (!stopping) {
      try {
        while (activeTasks.size < JOB_WORKER_CONCURRENCY && !stopping) {
          const job = await claimJob({
            globalConcurrency: JOB_GLOBAL_CONCURRENCY,
            leaseSeconds: JOB_LEASE_SECONDS,
            maxAttempts: JOB_MAX_ATTEMPTS,
            workerId,
          });

          if (!job) {
            break;
          }

          trackTask(processJob(job));
        }
      } catch (error) {
        console.error('분석 작업 worker 오류:', error);
      }

      await delay(JOB_WORKER_POLL_MS);
    }

    running = false;
  }

  async function cleanup() {
    try {
      await cleanupExpiredJobs();
    } catch (error) {
      console.error('분석 작업 정리 오류:', error);
    }
  }

  let cleanupTimer;

  return {
    start() {
      if (running) {
        return;
      }

      stopping = false;
      void cleanup();
      cleanupTimer = setInterval(cleanup, 60 * 60 * 1_000);
      cleanupTimer.unref?.();
      void loop();
    },
    async stop({ graceMs = 25_000 } = {}) {
      stopping = true;
      clearInterval(cleanupTimer);

      if (activeTasks.size === 0) {
        return;
      }

      let timeout;
      await Promise.race([
        Promise.allSettled([...activeTasks]),
        new Promise((resolve) => {
          timeout = setTimeout(resolve, graceMs);
          timeout.unref?.();
        }),
      ]);
      clearTimeout(timeout);

      if (activeTasks.size > 0) {
        for (const controller of activeControllers.values()) {
          controller.abort(new WorkerShutdownError('서버가 종료되고 있습니다.'));
        }
        await Promise.allSettled([...activeTasks]);
      }
    },
  };
}
