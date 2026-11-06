import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "../env";
import * as schema from "./schema";

// Reuse one pool across dev hot reloads.
const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
const sql = (g.__sql ??= postgres(requireEnv("DATABASE_URL"), { max: 5 }));

export const db = drizzle(sql, { schema });
export { schema };
