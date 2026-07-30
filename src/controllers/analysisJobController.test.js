import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const previousSupabaseUrl = process.env.SUPABASE_URL;
const previousSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { createAnalysisJob, getAnalysisJob } = await import('./analysisJobController.js');

if (previousSupabaseUrl === undefined) {
  delete process.env.SUPABASE_URL;
} else {
  process.env.SUPABASE_URL = previousSupabaseUrl;
}

if (previousSupabaseServiceKey === undefined) {
  delete process.env.SUPABASE_SERVICE_KEY;
} else {
  process.env.SUPABASE_SERVICE_KEY = previousSupabaseServiceKey;
}

function createResponse() {
  return {
    headers: {},
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

describe('analysis jobs API validation', () => {
  it('작업 토큰과 idempotency key가 없으면 DB 접근 전에 거부한다', async () => {
    const request = {
      body: { url: 'https://example.com', screenReader: 'voiceover' },
      get: () => undefined,
    };
    const response = createResponse();

    await createAnalysisJob(request, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'INVALID_REQUEST');
  });

  it('잘못된 작업 ID는 존재 여부를 노출하지 않고 404를 반환한다', async () => {
    const request = {
      params: { jobId: 'not-a-uuid' },
      get: (name) => (name === 'X-Analysis-Job-Token' ? 'a'.repeat(43) : undefined),
    };
    const response = createResponse();

    await getAnalysisJob(request, response);

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, 'JOB_NOT_FOUND');
  });
});
