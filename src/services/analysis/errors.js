export const PUBLIC_ANALYSIS_ERROR_CODES = Object.freeze([
  'ANALYSIS_TIMEOUT',
  'TARGET_UNREACHABLE',
  'TARGET_ACCESS_DENIED',
  'TARGET_SECURITY_BLOCKED',
  'INVALID_REQUEST',
  'INVALID_URL',
  'INVALID_HTML',
  'UNSUPPORTED_CONTENT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export class AnalysisError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class InvalidAnalysisTargetError extends AnalysisError {
  constructor(message, options = {}) {
    super(message, { code: 'INVALID_URL', status: 400, ...options });
  }
}

export class TargetSecurityBlockedError extends AnalysisError {
  constructor(message = '보안 정책에 따라 해당 주소를 분석할 수 없습니다.', options = {}) {
    super(message, { code: 'TARGET_SECURITY_BLOCKED', status: 403, ...options });
  }
}

export class TargetAccessDeniedError extends AnalysisError {
  constructor(message = '대상 페이지에 접근할 수 없습니다.', options = {}) {
    super(message, { code: 'TARGET_ACCESS_DENIED', status: 403, ...options });
  }
}

export class TargetUnreachableError extends AnalysisError {
  constructor(message = '분석 대상에 연결할 수 없습니다.', options = {}) {
    super(message, { code: 'TARGET_UNREACHABLE', status: 502, ...options });
  }
}

export class UnsupportedContentError extends AnalysisError {
  constructor(message = '지원하지 않는 형식의 콘텐츠입니다.', options = {}) {
    super(message, { code: 'UNSUPPORTED_CONTENT', status: 415, ...options });
  }
}

export class AnalysisTimeoutError extends AnalysisError {
  constructor(message = '분석 제한 시간을 초과했습니다.', options = {}) {
    super(message, { code: 'ANALYSIS_TIMEOUT', status: 504, ...options });
  }
}

export class AnalysisCancelledError extends AnalysisError {
  constructor(message = '분석 요청이 취소되었습니다.', options = {}) {
    super(message, { code: 'ANALYSIS_CANCELLED', status: 499, ...options });
  }
}
