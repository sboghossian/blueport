import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

export function getDb(env: { DB: D1Database }): DrizzleD1Database {
  return drizzle(env.DB);
}
