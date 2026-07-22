import assert from 'node:assert/strict';
import test from 'node:test';

import { localDemoIdentityFromEnvironment } from './auth.js';

test('local demo identity requires an explicit development flag', () => {
  assert.equal(localDemoIdentityFromEnvironment({}), undefined);
  assert.equal(localDemoIdentityFromEnvironment({ LOCAL_DEMO_AUTH: 'false' }), undefined);
  assert.equal(
    localDemoIdentityFromEnvironment({ LOCAL_DEMO_AUTH: 'true' })?.email,
    'local-athlete@mightycringe.test',
  );
});

test('local demo identity is always disabled in production', () => {
  assert.equal(
    localDemoIdentityFromEnvironment({ NODE_ENV: 'production', LOCAL_DEMO_AUTH: 'true' }),
    undefined,
  );
});
