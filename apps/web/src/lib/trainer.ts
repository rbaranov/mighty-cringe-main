import type {
  MeasurementRecord,
  TrainerAthleteSummary,
  TrainerInviteRecord,
  TrainerSummary,
  WorkoutRecord,
} from '@mighty-cringe/contracts';

type Request = typeof fetch;

export async function acceptTrainerInviteFromUrl(
  href: string,
  request: Request = fetch,
): Promise<{ trainer: TrainerSummary; cleanUrl: string } | null> {
  const url = new URL(href);
  const token = url.searchParams.get('trainerInvite');
  if (!token) return null;
  const response = await request('/api/v1/trainer/invites/accept', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw await trainerRequestError(response, 'Не удалось принять приглашение');
  const payload = (await response.json()) as { trainer: TrainerSummary };
  url.searchParams.delete('trainerInvite');
  return { trainer: payload.trainer, cleanUrl: `${url.pathname}${url.search}${url.hash}` };
}

export function currentLoginReturnTo(location: Pick<Location, 'pathname' | 'search'>): string {
  return `${location.pathname}${location.search}`;
}

export async function getTrainerRelationship(request: Request = fetch) {
  return requestJson<{ trainer: TrainerSummary | null }>('/api/v1/trainer/relationship', request);
}

export async function revokeTrainerRelationship(request: Request = fetch) {
  await requestNoContent('/api/v1/trainer/relationship', 'DELETE', request);
}

export async function listTrainerAthletes(request: Request = fetch) {
  return requestJson<{ items: TrainerAthleteSummary[] }>('/api/v1/trainer/athletes', request);
}

export async function listTrainerInvites(request: Request = fetch) {
  return requestJson<{ items: TrainerInviteRecord[] }>('/api/v1/trainer/invites', request);
}

export async function createTrainerInvite(email: string, request: Request = fetch) {
  return requestJson<{ invite: TrainerInviteRecord; token: string }>(
    '/api/v1/trainer/invites',
    request,
    {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() || null }),
    },
  );
}

export async function revokeTrainerInvite(inviteId: string, request: Request = fetch) {
  await requestNoContent(`/api/v1/trainer/invites/${inviteId}`, 'DELETE', request);
}

export async function revokeTrainerAthlete(athleteId: string, request: Request = fetch) {
  await requestNoContent(`/api/v1/trainer/athletes/${athleteId}`, 'DELETE', request);
}

export async function loadTrainerAthlete(athleteId: string, request: Request = fetch) {
  const [workouts, measurements] = await Promise.all([
    requestJson<{ items: WorkoutRecord[] }>(
      `/api/v1/trainer/athletes/${athleteId}/workouts`,
      request,
    ),
    requestJson<{ items: MeasurementRecord[] }>(
      `/api/v1/trainer/athletes/${athleteId}/measurements`,
      request,
    ),
  ]);
  return { workouts: workouts.items, measurements: measurements.items };
}

async function requestJson<T>(url: string, request: Request, init: RequestInit = {}): Promise<T> {
  const response = await request(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
  if (!response.ok) throw await trainerRequestError(response, 'Ошибка доступа к данным тренера');
  return (await response.json()) as T;
}

async function requestNoContent(url: string, method: string, request: Request) {
  const response = await request(url, { method, credentials: 'include' });
  if (!response.ok) throw await trainerRequestError(response, 'Не удалось отозвать доступ');
}

async function trainerRequestError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    code?: string;
    error?: string;
  } | null;
  const known: Record<string, string> = {
    invite_expired: 'Срок приглашения истёк. Попроси тренера создать новое.',
    invite_used: 'Это приглашение уже использовано.',
    invite_email_mismatch: 'Приглашение создано для другого Google-аккаунта.',
    self_link: 'Нельзя подключить свой аккаунт как собственного тренера.',
  };
  return new Error((payload?.code && known[payload.code]) || payload?.error || fallback);
}
