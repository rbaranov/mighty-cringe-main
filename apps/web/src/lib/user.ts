import type { CurrentUser } from '@mighty-cringe/contracts';

const userRoles = new Set<CurrentUser['role']>(['athlete', 'admin', 'trainer', 'superadmin']);
const locales = new Set<CurrentUser['locale']>(['ru', 'en']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCurrentUser(value: unknown): CurrentUser | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    !uuid.test(candidate.id) ||
    typeof candidate.email !== 'string' ||
    !candidate.email.includes('@') ||
    typeof candidate.displayName !== 'string' ||
    !candidate.displayName.trim() ||
    (candidate.avatarUrl !== null && !isHttpUrl(candidate.avatarUrl)) ||
    typeof candidate.role !== 'string' ||
    !userRoles.has(candidate.role as CurrentUser['role']) ||
    typeof candidate.locale !== 'string' ||
    !locales.has(candidate.locale as CurrentUser['locale'])
  ) {
    return null;
  }
  return candidate as CurrentUser;
}

function isHttpUrl(value: unknown) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
