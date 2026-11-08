// Métricas do harness de um pedido já rodado: desconto por rodada e mensagens seguidas
// ao fornecedor sem resposta. Por padrão no banco de teste (o do npm run simular).
//
// npm run simular:metricas -- 12          # pedido 12
// npm run simular:metricas -- 12 13 14
// npm run simular:metricas -- --principal 12   # no banco principal (só leitura)

const args = process.argv.slice(2);
if (!args.includes("--principal") && process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!ids.length) {
  console.error("Uso: npm run simular:metricas -- <pedido> [<pedido>...] [--principal]");
  process.exit(1);
}
const { conexao } = await import("../src/nucleo/index.ts");
const { metricasDoPedido, textoMetricas } = await import("../src/simulador/metricas.ts");
for (const id of ids) console.log(`${textoMetricas(await metricasDoPedido(id))}\n`);
await conexao.end();
