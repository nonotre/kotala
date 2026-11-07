import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env");
} catch {
  // Sem .env: usa as variáveis do ambiente.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/nucleo/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
