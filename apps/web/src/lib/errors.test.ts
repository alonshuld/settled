import { ApiError } from '@settled/api-client';
import { describe, expect, it } from 'vite-plus/test';
import { en } from './i18n/en';
import { he } from './i18n/he';
import { errorCode, errorMessage, isTransient } from './errors';
import { i18n } from './i18n';
import { loginPath, safeNext } from './nav';
import { isEmail, maskPhone, toE164 } from './phone';

describe('errorCode', () => {
  it('uses the server code when it has copy', () => {
    expect(errorCode(new ApiError(409, 'VERSION_CONFLICT', 'x'))).toBe('VERSION_CONFLICT');
    expect(errorCode(new ApiError(400, 'SPLIT_SUM_MISMATCH', 'x'))).toBe('SPLIT_SUM_MISMATCH');
  });

  it('falls back to the HTTP status for unknown codes', () => {
    expect(errorCode(new ApiError(404, 'SOMETHING_NEW', 'x'))).toBe('NOT_FOUND');
    expect(errorCode(new ApiError(429, 'SOMETHING_NEW', 'x'))).toBe('RATE_LIMITED');
    expect(errorCode(new ApiError(503, 'SOMETHING_NEW', 'x'))).toBe('INTERNAL');
    expect(errorCode(new ApiError(418, 'SOMETHING_NEW', 'x'))).toBe('UNKNOWN');
  });

  it('understands Better Auth errors and network failures', () => {
    expect(errorCode({ code: 'INVALID_OTP', message: 'Invalid OTP', status: 400 })).toBe('INVALID_OTP');
    expect(errorCode({ status: 429 })).toBe('RATE_LIMITED');
    expect(errorCode(new TypeError('Failed to fetch'))).toBe('NETWORK');
    expect(errorCode('boom')).toBe('UNKNOWN');
  });

  it('only retries transient failures', () => {
    expect(isTransient(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransient(new ApiError(502, 'INTERNAL', 'x'))).toBe(true);
    expect(isTransient(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe(false);
  });
});

describe('errorMessage', () => {
  it('translates in the active language', async () => {
    const err = new ApiError(410, 'INVITE_EXPIRED', 'x');
    await i18n.changeLanguage('en');
    expect(errorMessage(i18n.t.bind(i18n), err)).toBe(en.errors.INVITE_EXPIRED);
    await i18n.changeLanguage('he');
    expect(errorMessage(i18n.t.bind(i18n), err)).toBe(he.errors.INVITE_EXPIRED);
  });
});

describe('i18n', () => {
  it('has the same keys in he and en', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(en).sort()).toEqual(keys(he).sort());
  });

  it('pluralises tries left, including the Hebrew dual', async () => {
    await i18n.changeLanguage('he');
    expect(i18n.t('login.wrongCode', { count: 2 })).toContain('שני');
    expect(i18n.t('login.wrongCode', { count: 1 })).toContain('אחד');
    await i18n.changeLanguage('en');
    expect(i18n.t('login.wrongCode', { count: 2 })).toBe('That code doesn’t match. 2 tries left.');
  });
});

describe('safeNext / loginPath', () => {
  it('keeps same-origin app paths only', () => {
    expect(safeNext('/groups/1?tab=balances')).toBe('/groups/1?tab=balances');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('/login')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });

  it('builds the login redirect', () => {
    expect(loginPath('/j/KR7-4QX')).toBe('/login?next=%2Fj%2FKR7-4QX');
    expect(loginPath('/')).toBe('/login');
  });
});

describe('phone / email helpers', () => {
  it('normalises Israeli numbers', () => {
    expect(toE164('050-123-4567')).toBe('+972501234567');
    expect(toE164('+1 415 555 0100')).toBe('+14155550100');
    expect(toE164('12')).toBeNull();
    expect(maskPhone('+972501234567')).toBe('+972 50-•••-4567');
  });

  it('checks emails', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('nope')).toBe(false);
  });
});
