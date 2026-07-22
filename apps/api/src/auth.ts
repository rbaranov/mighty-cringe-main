import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { GoogleIdentity } from './repository.js';

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_ENDPOINT));

export type IdentityProvider = {
  createAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
  }): Promise<GoogleIdentity>;
};

export type AuthOptions = {
  provider: IdentityProvider;
  adminEmails: ReadonlySet<string>;
  trainerEmails: ReadonlySet<string>;
  secureCookies: boolean;
  sessionTtlMs: number;
};

export class GoogleIdentityProvider implements IdentityProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  createAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }) {
    const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; expectedNonce: string }) {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Google token exchange failed with ${response.status}`);

    const tokenResponse = (await response.json()) as { id_token?: unknown };
    if (typeof tokenResponse.id_token !== 'string') {
      throw new Error('Google token response did not contain an ID token');
    }

    const { payload } = await jwtVerify(tokenResponse.id_token, googleJwks, {
      audience: this.clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    if (!safeEqual(payload.nonce, input.expectedNonce)) throw new Error('Invalid OIDC nonce');
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true
    ) {
      throw new Error('Google account does not provide a verified identity');
    }

    return {
      subject: payload.sub,
      email: payload.email,
      displayName:
        typeof payload.name === 'string' && payload.name.trim()
          ? payload.name.trim()
          : payload.email,
      avatarUrl: typeof payload.picture === 'string' ? payload.picture : null,
    };
  }
}

export function authOptionsFromEnvironment(): AuthOptions | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const webOrigin = process.env.WEB_ORIGIN?.trim();
  if (!clientId || !clientSecret || !webOrigin) return undefined;

  const origin = new URL(webOrigin).origin;
  const ttlDays = Number(process.env.SESSION_TTL_DAYS ?? 30);
  if (!Number.isFinite(ttlDays) || ttlDays < 1 || ttlDays > 90) {
    throw new Error('SESSION_TTL_DAYS must be between 1 and 90');
  }

  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const trainerEmails = new Set(
    (process.env.TRAINER_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    provider: new GoogleIdentityProvider(
      clientId,
      clientSecret,
      `${origin}/api/v1/auth/google/callback`,
    ),
    adminEmails,
    trainerEmails,
    secureCookies: origin.startsWith('https://'),
    sessionTtlMs: ttlDays * 24 * 60 * 60 * 1_000,
  };
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function codeChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function safeEqual(left: unknown, right: string) {
  if (typeof left !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
