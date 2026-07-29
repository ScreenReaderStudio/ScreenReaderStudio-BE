import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { AnalysisCancelledError } from './errors.js';
import { analyzeAccessibility, createBrowserLaunchOptions } from './index.js';

class FakePage extends EventEmitter {
  constructor() {
    super();
    this.closeCount = 0;
  }

  setDefaultTimeout(value) {
    this.defaultTimeout = value;
  }

  setDefaultNavigationTimeout(value) {
    this.navigationTimeout = value;
  }

  async evaluateOnNewDocument() {}

  async setBypassServiceWorker(value) {
    this.bypassServiceWorker = value;
  }

  async setRequestInterception(value) {
    this.requestInterception = value;
  }

  async close() {
    this.closeCount += 1;
  }
}

function createBrowserFixture() {
  const page = new FakePage();
  const context = {
    closeCount: 0,
    async clearPermissionOverrides() {
      this.permissionsCleared = true;
    },
    async newPage() {
      return page;
    },
    async close() {
      this.closeCount += 1;
    },
  };
  const browser = {
    closeCount: 0,
    async createBrowserContext() {
      return context;
    },
    async close() {
      this.closeCount += 1;
    },
  };
  const launcher = {
    async launch(options) {
      launcher.options = options;
      return browser;
    },
  };

  return { browser, context, launcher, page };
}

describe('createBrowserLaunchOptions', () => {
  it('브라우저 자식 프로세스에 애플리케이션 비밀값을 전달하지 않는다', () => {
    const options = createBrowserLaunchOptions({
      HOME: '/tmp/browser-home',
      PATH: '/usr/bin',
      JWT_SECRET: 'jwt-secret',
      SUPABASE_SERVICE_KEY: 'service-secret',
    });

    assert.deepEqual(options.env, {
      HOME: '/tmp/browser-home',
      PATH: '/usr/bin',
    });
    assert.equal(options.args.includes('--no-sandbox'), false);
  });

  it('명시적으로 설정한 환경에서만 Chromium sandbox를 비활성화한다', () => {
    const options = createBrowserLaunchOptions({
      PUPPETEER_DISABLE_SANDBOX: 'true',
    });

    assert.equal(options.args.includes('--no-sandbox'), true);
    assert.equal(options.args.includes('--disable-setuid-sandbox'), true);
  });
});

describe('analyzeAccessibility', () => {
  it('격리된 BrowserContext에서 분석하고 모든 브라우저 자원을 정리한다', async () => {
    const fixture = createBrowserFixture();
    const result = await analyzeAccessibility(
      {
        htmlContent: '<main><h1>제목</h1></main>',
        screenReader: 'nvda',
      },
      {
        browserLauncher: fixture.launcher,
        loadContent: async () => '<html><head></head><body><h1>제목</h1></body></html>',
        analyze: async () => ({
          screenReaderScript: [{ text: '제목, 제목 레벨 1', selector: 'h1' }],
          accessibilityAnalysis: { violations: [] },
        }),
      }
    );

    assert.equal(fixture.context.permissionsCleared, true);
    assert.equal(fixture.page.bypassServiceWorker, true);
    assert.equal(fixture.page.requestInterception, true);
    assert.equal(fixture.page.closeCount, 1);
    assert.equal(fixture.context.closeCount, 1);
    assert.equal(fixture.browser.closeCount, 1);
    assert.equal(result.screenReaderScript.length, 1);
    assert.match(result.pageContent, /window\.addEventListener/);
  });

  it('클라이언트 취소 시 진행 중인 분석과 브라우저를 종료한다', async () => {
    const fixture = createBrowserFixture();
    const abortController = new AbortController();
    const analysisPromise = analyzeAccessibility(
      {
        htmlContent: '<main></main>',
        screenReader: 'voiceover',
      },
      {
        signal: abortController.signal,
        browserLauncher: fixture.launcher,
        loadContent: async () => '<html><head></head><body></body></html>',
        analyze: async () => new Promise(() => {}),
      }
    );

    await new Promise((resolve) => setImmediate(resolve));
    abortController.abort(new AnalysisCancelledError());

    await assert.rejects(analysisPromise, AnalysisCancelledError);
    assert.ok(fixture.browser.closeCount >= 1);
  });
});
