import { describe, expect, it } from 'vitest';
import { requestLogFields } from './request-log.js';

describe('requestLogFields', () => {
  it('logs the path without its query string (a query can carry a secret: Meta’s hub.verify_token)', () => {
    expect(requestLogFields({ method: 'GET', url: '/v1/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=TEST-secret-0123&hub.challenge=abc', hostname: 'afflino.com' })).toEqual({
      method: 'GET',
      url: '/v1/integrations/meta/webhook',
      hostname: 'afflino.com',
    });
    expect(requestLogFields({ method: 'GET', url: '/r/0123?via=look' }).url).toBe('/r/0123');
    expect(requestLogFields({ method: 'GET' }).url).toBeUndefined();
  });
});
