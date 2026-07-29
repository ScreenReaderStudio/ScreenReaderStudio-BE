import { lookup as dnsLookup } from 'dns/promises';

import ipaddr from 'ipaddr.js';

import {
  InvalidAnalysisTargetError,
  TargetSecurityBlockedError,
  TargetUnreachableError,
} from './errors.js';

const MAX_URL_LENGTH = 2048;
const NETWORK_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_LOCAL_PROTOCOLS = new Set(['about:', 'blob:', 'data:']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.internal', '.local', '.localhost', '.home.arpa'];

function normalizeHostname(hostname) {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function isBlockedHostname(hostname) {
  return (
    hostname === 'localhost' ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

export function isPublicIpAddress(address) {
  if (!ipaddr.isValid(address)) {
    return false;
  }

  let parsedAddress = ipaddr.parse(address);

  if (parsedAddress.kind() === 'ipv6' && parsedAddress.isIPv4MappedAddress()) {
    parsedAddress = parsedAddress.toIPv4Address();
  }

  return parsedAddress.range() === 'unicast';
}

function parseHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new InvalidAnalysisTargetError('유효한 URL을 입력해주세요.');
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch (error) {
    throw new InvalidAnalysisTargetError('URL 형식이 올바르지 않습니다.', { cause: error });
  }

  if (!NETWORK_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new InvalidAnalysisTargetError('HTTP와 HTTPS URL만 분석할 수 있습니다.');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new TargetSecurityBlockedError('사용자 정보가 포함된 URL은 분석할 수 없습니다.');
  }

  return parsedUrl;
}

export async function assertPublicHttpUrl(value, { lookup = dnsLookup } = {}) {
  const parsedUrl = parseHttpUrl(value);
  const hostname = normalizeHostname(parsedUrl.hostname);

  if (!hostname || isBlockedHostname(hostname)) {
    throw new TargetSecurityBlockedError();
  }

  if (ipaddr.isValid(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new TargetSecurityBlockedError();
    }

    return parsedUrl;
  }

  let addresses;

  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new TargetUnreachableError('분석 대상의 주소를 확인할 수 없습니다.', { cause: error });
  }

  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new TargetSecurityBlockedError();
  }

  return parsedUrl;
}

export function isSafeLocalResourceUrl(value) {
  try {
    return SAFE_LOCAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export async function installNetworkPolicy(page, options = {}) {
  let blockedRequestError = null;

  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);

  const handleRequest = async (request) => {
    if (request.isInterceptResolutionHandled()) {
      return;
    }

    try {
      if (!isSafeLocalResourceUrl(request.url())) {
        await assertPublicHttpUrl(request.url(), options);
      }

      if (!request.isInterceptResolutionHandled()) {
        await request.continue();
      }
    } catch (error) {
      if (error instanceof TargetSecurityBlockedError || request.isNavigationRequest?.() === true) {
        blockedRequestError ??= error;
      }

      if (!request.isInterceptResolutionHandled()) {
        try {
          await request.abort('blockedbyclient');
        } catch {
          // 페이지가 동시에 종료된 경우에는 이미 요청을 계속할 수 없다.
        }
      }
    }
  };

  page.on('request', handleRequest);

  return {
    getBlockedRequestError() {
      return blockedRequestError;
    },
    dispose() {
      page.off('request', handleRequest);
    },
  };
}
