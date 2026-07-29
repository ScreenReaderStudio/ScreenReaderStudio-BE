import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadPageContent } from './contentLoader.js';

function createPage({ status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    async goto() {
      return {
        status: () => status,
        headers: () => ({ 'content-type': contentType }),
      };
    },
    async waitForNetworkIdle() {},
    async content() {
      return '<main>분석 대상</main>';
    },
  };
}

const networkOptions = {
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
};

describe('loadPageContent 오류 계약', () => {
  it('401과 403 응답을 TARGET_ACCESS_DENIED로 분류한다', async () => {
    for (const status of [401, 403]) {
      await assert.rejects(
        loadPageContent(createPage({ status }), { url: 'https://example.com' }, { networkOptions }),
        (error) => error.code === 'TARGET_ACCESS_DENIED' && error.status === 403
      );
    }
  });

  it('HTML이 아닌 응답을 UNSUPPORTED_CONTENT로 분류한다', async () => {
    await assert.rejects(
      loadPageContent(
        createPage({ contentType: 'application/pdf' }),
        { url: 'https://example.com/document.pdf' },
        { networkOptions }
      ),
      (error) => error.code === 'UNSUPPORTED_CONTENT' && error.status === 415
    );
  });
});
