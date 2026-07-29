import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TargetSecurityBlockedError, TargetUnreachableError } from './errors.js';
import { assertPublicHttpUrl, installNetworkPolicy, isPublicIpAddress } from './networkPolicy.js';

const PUBLIC_ADDRESSES = [{ address: '93.184.216.34', family: 4 }];

function publicLookup() {
  return Promise.resolve(PUBLIC_ADDRESSES);
}

function createPage() {
  const listeners = new Map();

  return {
    bypassedServiceWorker: false,
    requestInterceptionEnabled: false,
    async setBypassServiceWorker(value) {
      this.bypassedServiceWorker = value;
    },
    async setRequestInterception(value) {
      this.requestInterceptionEnabled = value;
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    off(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    getRequestHandler() {
      return listeners.get('request');
    },
  };
}

function createRequest(url) {
  let resolution;

  return {
    url: () => url,
    isInterceptResolutionHandled: () => resolution !== undefined,
    async continue() {
      resolution = 'continued';
    },
    async abort() {
      resolution = 'aborted';
    },
    getResolution() {
      return resolution;
    },
  };
}

describe('isPublicIpAddress', () => {
  it('공인 IPv4와 IPv6만 허용한다', () => {
    assert.equal(isPublicIpAddress('8.8.8.8'), true);
    assert.equal(isPublicIpAddress('2001:4860:4860::8888'), true);
    assert.equal(isPublicIpAddress('127.0.0.1'), false);
    assert.equal(isPublicIpAddress('10.0.0.1'), false);
    assert.equal(isPublicIpAddress('169.254.169.254'), false);
    assert.equal(isPublicIpAddress('::1'), false);
    assert.equal(isPublicIpAddress('fc00::1'), false);
    assert.equal(isPublicIpAddress('::ffff:127.0.0.1'), false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('공인 주소로만 해석되는 HTTP와 HTTPS URL을 허용한다', async () => {
    const url = await assertPublicHttpUrl('https://example.com/path', {
      lookup: publicLookup,
    });

    assert.equal(url.href, 'https://example.com/path');
  });

  it('localhost와 비공개 IP 우회 표기를 차단한다', async () => {
    const blockedUrls = [
      'http://localhost',
      'http://service.localhost',
      'http://127.0.0.1',
      'http://127.1',
      'http://2130706433',
      'http://0x7f000001',
      'http://0.0.0.0',
      'http://10.0.0.1',
      'http://100.64.0.1',
      'http://172.16.0.1',
      'http://192.168.0.1',
      'http://224.0.0.1',
      'http://[::1]',
      'http://[fe80::1]',
      'http://[fd00::1]',
      'http://[::ffff:127.0.0.1]',
      'http://169.254.169.254',
    ];

    for (const url of blockedUrls) {
      await assert.rejects(
        assertPublicHttpUrl(url, { lookup: publicLookup }),
        TargetSecurityBlockedError
      );
    }
  });

  it('네트워크 URL의 사용자 정보와 HTTP 외 프로토콜을 거부한다', async () => {
    await assert.rejects(
      assertPublicHttpUrl('https://user:password@example.com', {
        lookup: publicLookup,
      }),
      TargetSecurityBlockedError
    );
    await assert.rejects(assertPublicHttpUrl('file:///etc/passwd', { lookup: publicLookup }));
    await assert.rejects(assertPublicHttpUrl('ftp://example.com', { lookup: publicLookup }));
  });

  it('DNS 결과에 비공개 주소가 하나라도 포함되면 차단한다', async () => {
    const lookup = async () => [...PUBLIC_ADDRESSES, { address: '10.0.0.10', family: 4 }];

    await assert.rejects(
      assertPublicHttpUrl('https://example.com', { lookup }),
      TargetSecurityBlockedError
    );
  });

  it('DNS 조회 실패를 대상 연결 오류로 구분한다', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };

    await assert.rejects(
      assertPublicHttpUrl('https://missing.example', { lookup }),
      TargetUnreachableError
    );
  });
});

describe('installNetworkPolicy', () => {
  it('리다이렉트와 하위 리소스에 해당하는 모든 요청을 다시 검사한다', async () => {
    const page = createPage();
    const lookedUpHosts = [];
    const lookup = async (hostname) => {
      lookedUpHosts.push(hostname);

      if (hostname === 'internal.example') {
        return [{ address: '192.168.0.10', family: 4 }];
      }

      return PUBLIC_ADDRESSES;
    };
    const policy = await installNetworkPolicy(page, { lookup });
    const publicRequest = createRequest('https://example.com/style.css');
    const blockedRequest = createRequest('https://internal.example/secret');

    await page.getRequestHandler()(publicRequest);
    await page.getRequestHandler()(blockedRequest);

    assert.equal(page.bypassedServiceWorker, true);
    assert.equal(page.requestInterceptionEnabled, true);
    assert.equal(publicRequest.getResolution(), 'continued');
    assert.equal(blockedRequest.getResolution(), 'aborted');
    assert.deepEqual(lookedUpHosts, ['example.com', 'internal.example']);
    assert.ok(policy.getBlockedRequestError() instanceof TargetSecurityBlockedError);

    policy.dispose();
  });

  it('data와 blob 리소스는 네트워크 조회 없이 허용한다', async () => {
    const page = createPage();
    let lookupCount = 0;
    const policy = await installNetworkPolicy(page, {
      lookup: async () => {
        lookupCount += 1;
        return PUBLIC_ADDRESSES;
      },
    });
    const dataRequest = createRequest('data:text/plain,hello');
    const blobRequest = createRequest('blob:https://example.com/id');

    await page.getRequestHandler()(dataRequest);
    await page.getRequestHandler()(blobRequest);

    assert.equal(dataRequest.getResolution(), 'continued');
    assert.equal(blobRequest.getResolution(), 'continued');
    assert.equal(lookupCount, 0);
    assert.equal(policy.getBlockedRequestError(), null);
  });

  it('연결할 수 없는 하위 리소스만 중단하고 전체 분석 오류로 만들지 않는다', async () => {
    const page = createPage();
    const policy = await installNetworkPolicy(page, {
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    const request = createRequest('https://missing-cdn.example/image.png');

    await page.getRequestHandler()(request);

    assert.equal(request.getResolution(), 'aborted');
    assert.equal(policy.getBlockedRequestError(), null);
  });
});
