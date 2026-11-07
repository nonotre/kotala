// Aplica as migrações em drizzle/ sem precisar do drizzle-kit (usado no container).
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { conexao, db } from "../src/nucleo/db/cliente.ts";

await migrate(db, { migrationsFolder: "drizzle" });
await conexao.end();
console.log("Migrações aplicadas.");
