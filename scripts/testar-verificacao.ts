// Testa a verificação do fornecedor (Q8) ao vivo, no banco de teste. Não gasta crédito do Serper.
// npm run verificacao:testar -- https://www.telhanorte.com.br            (acha o CNPJ no site)
// npm run verificacao:testar -- 15.351.310/0001-28                        (CNPJ direto)

if (process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
const alvo = process.argv[2] ?? "https://www.telhanorte.com.br";

const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { conexao, db, schema } = await import("../src/nucleo/index.ts");
const { verificarFornecedor } = await import("../src/agentes/verificacao/index.ts");

await migrate(db, { migrationsFolder: "drizzle" });
const ehUrl = alvo.startsWith("http");
const [f] = await db
  .insert(schema.fornecedor)
  .values({ nome: `Teste ${alvo}`, origem: "real", fonte: ehUrl ? alvo : null, cnpj: ehUrl ? null : alvo })
  .returning();
const t0 = Date.now();
const v = await verificarFornecedor(f!.id, { forcar: true });
console.log(`\n${alvo} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(JSON.stringify(v, null, 2));
await conexao.end();
