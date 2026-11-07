import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida. Veja .env.exemplo.");

export const conexao = postgres(url, { max: 10, onnotice: () => {} });
export const db = drizzle(conexao, { schema });

export type Db = typeof db;
/** Transação ou o próprio db: as funções do núcleo aceitam os dois. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export { schema };
