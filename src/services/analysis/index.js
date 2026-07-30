import puppeteer from 'puppeteer';

import { loadPageContent, injectHighlighterScript } from './contentLoader.js';
import { analyzePage } from './pageAnalyzer.js';
import {
  ANALYSIS_TIMEOUT_MS,
  BROWSER_CLOSE_TIMEOUT_MS,
  BROWSER_LAUNCH_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  PAGE_OPERATION_TIMEOUT_MS,
} from './config.js';
import { AnalysisCancelledError, AnalysisError, AnalysisTimeoutError } from './errors.js';
import { assertPublicHttpUrl, installNetworkPolicy } from './networkPolicy.js';

const SAFE_BROWSER_ENV_KEYS = [
  'DBUS_SESSION_BUS_ADDRESS',
  'FONTCONFIG_PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LD_LIBRARY_PATH',
  'PATH',
  'TZ',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
];
let hasWarnedAboutDisabledSandbox = false;

function createBrowserEnvironment(environment = process.env) {
  return Object.fromEntries(
    SAFE_BROWSER_ENV_KEYS.filter((key) => environment[key] !== undefined).map((key) => [
      key,
      environment[key],
    ])
  );
}

export function createBrowserLaunchOptions(environment = process.env) {
  const args = [
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-sync',
    '--no-default-browser-check',
    '--no-first-run',
  ];

  if (environment.PUPPETEER_DISABLE_SANDBOX === 'true') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return {
    headless: true,
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    args,
    env: createBrowserEnvironment(environment),
  };
}

function createAnalysisSignal(externalSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new AnalysisTimeoutError());
  }, ANALYSIS_TIMEOUT_MS);
  timeoutId.unref?.();

  const handleExternalAbort = () => {
    controller.abort(
      externalSignal.reason instanceof Error ? externalSignal.reason : new AnalysisCancelledError()
    );
  };

  if (externalSignal?.aborted) {
    handleExternalAbort();
  } else {
    externalSignal?.addEventListener('abort', handleExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', handleExternalAbort);
    },
  };
}

async function closeResource(resource, name) {
  if (!resource) {
    return;
  }

  let timeoutId;

  try {
    const closeResult = await Promise.race([
      Promise.resolve(resource.close()).then(() => 'closed'),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), BROWSER_CLOSE_TIMEOUT_MS);
        timeoutId.unref?.();
      }),
    ]);

    if (closeResult === 'timeout') {
      console.error(`${name} 종료 제한 시간을 초과했습니다.`);
      resource.process?.()?.kill('SIGKILL');
    }
  } catch (error) {
    console.error(`${name} 종료 중 오류 발생:`, error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runWithSignal(operation, signal) {
  if (signal.aborted) {
    throw signal.reason;
  }

  let handleAbort;
  const aborted = new Promise((_, reject) => {
    handleAbort = () => reject(signal.reason);
    signal.addEventListener('abort', handleAbort, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', handleAbort);
  }
}

export const analyzeAccessibility = async (
  { url, htmlContent, screenReader },
  {
    signal: externalSignal,
    browserLauncher = puppeteer,
    loadContent = loadPageContent,
    analyze = analyzePage,
    networkOptions,
    onProgress = async () => {},
  } = {}
) => {
  let browser;
  let browserContext;
  let page;
  let networkPolicy;
  let browserClosePromise;
  const { signal, dispose } = createAnalysisSignal(externalSignal);

  const closeBrowser = () => {
    if (!browser) {
      return Promise.resolve();
    }

    browserClosePromise ??= closeResource(browser, '브라우저');

    return browserClosePromise;
  };
  const handleAbort = () => void closeBrowser();

  signal.addEventListener('abort', handleAbort, { once: true });

  try {
    if (url) {
      await assertPublicHttpUrl(url, networkOptions);
    }

    if (signal.aborted) {
      throw signal.reason;
    }

    if (process.env.PUPPETEER_DISABLE_SANDBOX === 'true' && !hasWarnedAboutDisabledSandbox) {
      console.warn(
        '경고: Chromium sandbox가 비활성화되었습니다. 격리된 컨테이너와 egress 정책이 필요합니다.'
      );
      hasWarnedAboutDisabledSandbox = true;
    }

    await onProgress('launching_browser');
    const browserLaunch = browserLauncher.launch(createBrowserLaunchOptions());
    browserLaunch
      .then((launchedBrowser) => {
        if (signal.aborted && launchedBrowser !== browser) {
          void closeResource(launchedBrowser, '브라우저');
        }
      })
      .catch(() => {});
    browser = await runWithSignal(browserLaunch, signal);
    browserContext = await browser.createBrowserContext();
    await browserContext.clearPermissionOverrides();

    page = await browserContext.newPage();
    page.setDefaultTimeout(PAGE_OPERATION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(globalThis, 'open', {
        configurable: false,
        value: () => null,
        writable: false,
      });
    });
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });
    page.on('popup', (popup) => {
      void popup.close();
    });

    networkPolicy = await installNetworkPolicy(page, networkOptions);
    await onProgress('loading_page');
    const rawContent = await runWithSignal(
      loadContent(page, { url, htmlContent }, { signal, networkPolicy, networkOptions }),
      signal
    );
    await onProgress('analyzing_accessibility');
    const { screenReaderScript, accessibilityAnalysis } = await runWithSignal(
      analyze(page, screenReader),
      signal
    );
    await onProgress('preparing_result');
    const pageContentWithHighlighter = injectHighlighterScript(rawContent);

    return {
      accessibilityAnalysis,
      screenReaderScript,
      pageContent: pageContentWithHighlighter,
    };
  } catch (error) {
    const finalError = signal.aborted && signal.reason instanceof Error ? signal.reason : error;

    if (
      !(finalError instanceof AnalysisCancelledError) &&
      !(finalError instanceof AnalysisError && finalError.status < 500)
    ) {
      console.error('접근성 분석 중 오류 발생:', error);
    }

    if (finalError instanceof AnalysisError) {
      throw finalError;
    }

    throw new AnalysisError('분석 중 서버 오류가 발생했습니다.', {
      code: 'INTERNAL_ERROR',
      status: 500,
      cause: finalError,
    });
  } finally {
    signal.removeEventListener('abort', handleAbort);
    dispose();
    networkPolicy?.dispose();

    if (browserClosePromise) {
      await browserClosePromise;
    } else {
      await closeResource(page, '페이지');
      await closeResource(browserContext, '브라우저 컨텍스트');
      await closeBrowser();
    }
  }
};
