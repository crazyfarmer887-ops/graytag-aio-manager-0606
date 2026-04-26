import { drizzle } from 'drizzle-orm/d1';

// Local Node runtime does not provide Cloudflare's env.DB binding.
// Keep this module import-safe for the local server build; the app does not use
// the database layer yet, so we fail only if someone tries to access it.
const runtimeEnv = globalThis as typeof globalThis & {
  DB?: Parameters<typeof drizzle>[0];
};

const db = runtimeEnv.DB;

if (!db) {
  throw new Error('database() is not configured for the local Node runtime.');
}

export const database = drizzle(db);
