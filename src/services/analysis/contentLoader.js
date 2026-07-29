import { MAX_HTML_LENGTH, NAVIGATION_TIMEOUT_MS, NETWORK_IDLE_TIMEOUT_MS } from './config.js';
import {
  AnalysisCancelledError,
  AnalysisError,
  AnalysisTimeoutError,
  InvalidAnalysisTargetError,
  TargetAccessDeniedError,
  TargetUnreachableError,
  UnsupportedContentError,
} from './errors.js';
import { assertPublicHttpUrl } from './networkPolicy.js';

const highlighterScript = `
  const highlightStyle = '3px solid #FF0000';
  let highlightedElement = null;

  window.addEventListener('message', (event) => {
    const { type, selector } = event.data;

    if (type === 'highlight') {
      if (highlightedElement) {
        highlightedElement.style.outline = '';
      }
      if (selector) {
        const newElement = document.querySelector(selector);

        if (newElement) {
          highlightedElement = newElement;
          highlightedElement.style.outline = highlightStyle;
          highlightedElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
      }
    }
  });
`;

export function injectHighlighterScript(htmlContent) {
  const headRegex = /(<\/head>)/i;
  const bodyRegex = /(<body)/i;

  if (headRegex.test(htmlContent)) {
    return htmlContent.replace(headRegex, `<script>${highlighterScript}</script>$1`);
  }

  if (bodyRegex.test(htmlContent)) {
    return htmlContent.replace(bodyRegex, `<script>${highlighterScript}</script>$1`);
  }

  return `<script>${highlighterScript}</script>${htmlContent}`;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new AnalysisCancelledError();
}

async function waitForBriefNetworkIdle(page, signal) {
  try {
    await page.waitForNetworkIdle({
      idleTime: 500,
      timeout: NETWORK_IDLE_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    throwIfAborted(signal);

    if (error?.name !== 'TimeoutError') {
      throw error;
    }
  }
}

function mapNavigationError(error, signal) {
  if (signal?.aborted) {
    return signal.reason instanceof Error ? signal.reason : new AnalysisCancelledError();
  }

  if (error?.name === 'TimeoutError') {
    return new AnalysisTimeoutError('분석 대상 페이지를 불러오는 시간이 초과되었습니다.', {
      cause: error,
    });
  }

  if (error instanceof AnalysisError) {
    return error;
  }

  return new TargetUnreachableError('분석 대상 페이지를 불러올 수 없습니다.', { cause: error });
}

function throwIfRequestWasBlocked(networkPolicy) {
  const blockedRequestError = networkPolicy?.getBlockedRequestError();

  if (blockedRequestError) {
    throw blockedRequestError;
  }
}

function validateNavigationResponse(response) {
  if (!response) {
    return;
  }

  const status = response.status();

  if (status === 401 || status === 403) {
    throw new TargetAccessDeniedError();
  }

  const contentType = response.headers()['content-type']?.toLowerCase();

  if (
    contentType &&
    !contentType.includes('text/html') &&
    !contentType.includes('application/xhtml+xml')
  ) {
    throw new UnsupportedContentError();
  }
}

export async function loadPageContent(
  page,
  { url, htmlContent },
  { signal, networkPolicy, networkOptions } = {}
) {
  if (url) {
    const parsedUrl = await assertPublicHttpUrl(url, networkOptions);

    try {
      const response = await page.goto(parsedUrl.href, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
        signal,
      });
      validateNavigationResponse(response);
      await waitForBriefNetworkIdle(page, signal);
      throwIfRequestWasBlocked(networkPolicy);
    } catch (error) {
      throw networkPolicy?.getBlockedRequestError() ?? mapNavigationError(error, signal);
    }

    return page.content();
  }

  if (htmlContent) {
    if (typeof htmlContent !== 'string' || htmlContent.length > MAX_HTML_LENGTH) {
      throw new InvalidAnalysisTargetError('유효하지 않은 HTML 콘텐츠가 제공됐습니다.', {
        code: 'INVALID_HTML',
      });
    }

    try {
      await page.setContent(htmlContent, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
        signal,
      });
      await waitForBriefNetworkIdle(page, signal);
      throwIfRequestWasBlocked(networkPolicy);
    } catch (error) {
      throw networkPolicy?.getBlockedRequestError() ?? mapNavigationError(error, signal);
    }

    return page.content();
  }

  throw new InvalidAnalysisTargetError('URL 또는 HTML 콘텐츠 중 하나는 반드시 제공되어야 합니다.');
}
