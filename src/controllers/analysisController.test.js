import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

const previousSupabaseUrl = process.env.SUPABASE_URL;
const previousSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { performAnalysis } = await import('./analysisController.js');

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

function createRequest(body) {
  const request = new EventEmitter();
  request.body = body;

  return request;
}

function createResponse() {
  const response = new EventEmitter();
  response.headersSent = false;
  response.writableEnded = false;
  response.status = (status) => {
    response.statusCode = status;

    return response;
  };
  response.json = (body) => {
    response.body = body;
    response.headersSent = true;
    response.writableEnded = true;

    return response;
  };

  return response;
}

describe('performAnalysis', () => {
  it('내부 네트워크 URL을 브라우저 실행 전에 403으로 차단한다', async () => {
    const request = createRequest({
      url: 'http://127.0.0.1:8080/admin',
      screenReader: 'nvda',
    });
    const response = createResponse();

    await performAnalysis(request, response);

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, {
      code: 'TARGET_SECURITY_BLOCKED',
      message: '보안 정책에 따라 해당 주소를 분석할 수 없습니다.',
    });
  });

  it('URL과 HTML을 동시에 전달하면 400으로 거부한다', async () => {
    const request = createRequest({
      url: 'https://example.com',
      htmlContent: '<main></main>',
      screenReader: 'voiceover',
    });
    const response = createResponse();

    await performAnalysis(request, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'INVALID_REQUEST');
  });
});
