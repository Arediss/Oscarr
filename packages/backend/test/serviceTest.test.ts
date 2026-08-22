import { describe, it, expect } from 'vitest';
import { classifyTestError } from '../src/utils/serviceTestError.js';

/**
 * Regression cover for a beta tester's report: pointing the Radarr form at a Sonarr instance
 * tested green. Every *arr answers /system/status on the same path shape and returns 200 with a
 * valid key, so the version alone proves nothing — only appName does.
 */
describe('wrong *arr detection', () => {
  it('names what was found and what was expected', () => {
    const info = classifyTestError(new Error('WRONG_APP:Sonarr:Radarr'));
    expect(info.code).toBe('WRONG_APP');
    expect(info.message).toContain('Sonarr');
    expect(info.message).toContain('Radarr');
  });

  it('degrades gracefully when the service names itself nothing', () => {
    const info = classifyTestError(new Error('WRONG_APP::Radarr'));
    expect(info.code).toBe('WRONG_APP');
    expect(info.message).toContain('Radarr');
  });

  it('is not confused with a credential problem', () => {
    // The old Prowlarr guard threw AUTH_FAILED here, sending admins hunting for a bad API key
    // when the real problem was the URL.
    expect(classifyTestError(new Error('WRONG_APP:Radarr:Prowlarr')).code).not.toBe('AUTH_FAILED');
    expect(classifyTestError(new Error('AUTH_FAILED')).code).toBe('AUTH_FAILED');
  });

  it('leaves the other classifications alone', () => {
    expect(classifyTestError({ code: 'ECONNREFUSED' }).code).toBe('CONNECTION_REFUSED');
    expect(classifyTestError({ isAxiosError: true, response: { status: 401 } }).code).toBe('HTTP_UNAUTHORIZED');
  });
});
