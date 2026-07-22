import { describe, expect, it } from 'vitest';

import { parseCurrentUser } from './user';

describe('cached user validation', () => {
  it('accepts the complete public profile and rejects unsafe or partial cache data', () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'athlete@example.com',
      displayName: 'Athlete',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'athlete',
      locale: 'ru',
    };
    expect(parseCurrentUser(user)).toEqual({ ...user, unitSystem: 'metric' });
    expect(parseCurrentUser({ ...user, role: 'owner' })).toBeNull();
    expect(parseCurrentUser({ ...user, avatarUrl: 'javascript:alert(1)' })).toBeNull();
    expect(parseCurrentUser({ ...user, id: 'not-a-user-id' })).toBeNull();
  });
});
