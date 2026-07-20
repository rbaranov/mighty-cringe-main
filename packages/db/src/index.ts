import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
export { and, desc, eq, isNull } from 'drizzle-orm';

import * as schema from './schema.js';

export { schema };
export * from './schema.js';

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 10, prepare: false });
  return drizzle({ client, schema });
}
