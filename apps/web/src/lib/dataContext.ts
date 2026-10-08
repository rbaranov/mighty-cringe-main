import {
  MightyCringeDatabase,
  ownDb,
  registerScopedDatabaseCleanup,
  setActiveDatabase,
} from './db';

/** A captured owner boundary, shared by a local write and its durable network queue. */
export type DataContext = Readonly<{
  key: string;
  actorId: string;
  ownerId: string;
  relationshipId: string | null;
  database: MightyCringeDatabase;
  session: number;
}>;

let session = 0;
let actorId = '';
let ownContext: DataContext = makeOwnContext();
let activeContext = ownContext;
const athleteDatabases = new Map<string, MightyCringeDatabase>();
const athleteContexts = new Map<string, DataContext>();
const revokedContexts = new Set<string>();
const listeners = new Set<() => void>();
registerScopedDatabaseCleanup(() => {
  // Clearing account data must also invalidate timers and responses holding old handles.
  session += 1;
  ownContext = makeOwnContext();
  selectContext(ownContext);
  for (const database of athleteDatabases.values()) database.close();
  athleteDatabases.clear();
  athleteContexts.clear();
  revokedContexts.clear();
});

function makeOwnContext(): DataContext {
  return Object.freeze({
    key: `self:${actorId}`,
    actorId,
    ownerId: actorId,
    relationshipId: null,
    database: ownDb,
    session,
  });
}

/** Call after account activation; never pass the athlete identity here. */
export function initializeDataContext(authenticatedActorId: string) {
  if (authenticatedActorId === actorId) return activeContext;
  session += 1;
  actorId = authenticatedActorId;
  ownContext = makeOwnContext();
  return selectContext(ownContext);
}

/** Invalidates late session responses while keeping unsent work durable. */
export function invalidateDataContext() {
  session += 1;
  actorId = '';
  ownContext = makeOwnContext();
  return selectContext(ownContext);
}

export function getDataContext() {
  return activeContext;
}

export function getDataContextKey() {
  return activeContext.key;
}

export function subscribeDataContext(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setOwnDataContext() {
  return selectContext(ownContext);
}

/** Only call after the server has confirmed this exact trainer relationship is active. */
export function setAthleteDataContext(input: {
  actorId: string;
  athleteId: string;
  relationshipId: string;
}) {
  if (!actorId || input.actorId !== actorId || !input.athleteId || !input.relationshipId) {
    throw new Error('invalid_data_context');
  }
  const key = `athlete:${JSON.stringify([actorId, input.athleteId, input.relationshipId])}`;
  let database = athleteDatabases.get(key);
  if (!database) {
    database = new MightyCringeDatabase(`mighty-cringe:${key}`);
    athleteDatabases.set(key, database);
  }
  // Re-entry is authorized by a fresh server check. A new relationship gets a new
  // database, so work retained after revocation can never replay to a later link.
  revokedContexts.delete(key);
  let context = athleteContexts.get(key);
  if (!context || context.session !== session) {
    context = Object.freeze({
      key,
      actorId,
      ownerId: input.athleteId,
      relationshipId: input.relationshipId,
      database,
      session,
    });
    athleteContexts.set(key, context);
  }
  return selectContext(context);
}

function selectContext(context: DataContext) {
  activeContext = context;
  setActiveDatabase(context.database);
  for (const listener of listeners) listener();
  return context;
}

export function isDataContextValid(context: DataContext) {
  return (
    context.session === session && context.actorId === actorId && !revokedContexts.has(context.key)
  );
}

export function assertDataContext(context: DataContext) {
  if (!isDataContextValid(context)) throw new Error('data_context_unavailable');
}

export function isAthleteDataContext(context = getDataContext()) {
  return context.relationshipId !== null;
}

/** Scope is captured at invocation; this deliberately does not intercept global fetch. */
export async function sportingRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
  context: DataContext = getDataContext(),
): Promise<Response> {
  assertDataContext(context);
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.delete('X-Actor-Id');
  if (context.actorId) headers.set('X-Actor-Id', context.actorId);
  headers.delete('X-Athlete-Id');
  headers.delete('X-Trainer-Link-Id');
  if (context.relationshipId) {
    headers.set('X-Athlete-Id', context.ownerId);
    headers.set('X-Trainer-Link-Id', context.relationshipId);
  }
  const response = await fetch(input, {
    ...init,
    credentials: init.credentials ?? 'same-origin',
    headers,
  });
  assertDataContext(context);
  if (response.status === 403) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => ({}))) as { error?: string; code?: string };
    assertDataContext(context);
    const code = payload.code ?? payload.error;
    if (code === 'actor_session_changed') {
      invalidateDataContext();
      window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
      throw new Error('actor_session_changed');
    }
    if (
      context.relationshipId &&
      (code === 'trainer_access_revoked' || code === 'trainer_manage_required')
    ) {
      revokedContexts.add(context.key);
      window.dispatchEvent(
        new CustomEvent('mighty-cringe:trainer-access-revoked', {
          detail: {
            key: context.key,
            ownerId: context.ownerId,
            relationshipId: context.relationshipId,
          },
        }),
      );
    }
  }
  return response;
}
