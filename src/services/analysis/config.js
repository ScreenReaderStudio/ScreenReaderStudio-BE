function readPositiveInteger(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}은 ${min} 이상 ${max} 이하의 정수여야 합니다.`);
  }

  return value;
}

export const ANALYSIS_TIMEOUT_MS = readPositiveInteger('ANALYSIS_TIMEOUT_MS', 100_000, {
  min: 10_000,
  max: 180_000,
});

export const BROWSER_LAUNCH_TIMEOUT_MS = readPositiveInteger('BROWSER_LAUNCH_TIMEOUT_MS', 20_000, {
  min: 5_000,
  max: 60_000,
});

export const BROWSER_CLOSE_TIMEOUT_MS = readPositiveInteger('BROWSER_CLOSE_TIMEOUT_MS', 5_000, {
  min: 1_000,
  max: 15_000,
});

export const NAVIGATION_TIMEOUT_MS = readPositiveInteger('NAVIGATION_TIMEOUT_MS', 60_000, {
  min: 5_000,
  max: ANALYSIS_TIMEOUT_MS,
});

export const PAGE_OPERATION_TIMEOUT_MS = readPositiveInteger('PAGE_OPERATION_TIMEOUT_MS', 30_000, {
  min: 5_000,
  max: ANALYSIS_TIMEOUT_MS,
});

export const NETWORK_IDLE_TIMEOUT_MS = readPositiveInteger('NETWORK_IDLE_TIMEOUT_MS', 3_000, {
  min: 500,
  max: 10_000,
});

export const MAX_HTML_LENGTH = readPositiveInteger('MAX_HTML_LENGTH', 1_000_000, {
  min: 1_000,
  max: 5_000_000,
});
