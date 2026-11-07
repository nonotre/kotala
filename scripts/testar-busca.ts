// Testa a busca real (R3) para um item, no banco de teste.
// npm run busca:testar -- "Cimento CP II 50 kg" saco 40 01310-100
// Gasta no máximo BUSCA_MAX_CONSULTAS_ITEM consultas do Serper (0 se a busca já estiver no cache).

if (process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
const [descricao = "Cimento CP II 50 kg", unidade = "saco", qtd = "40", cep = "01310-100"] = process.argv.slice(2);

const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { conexao, db, schema } = await import("../src/nucleo/index.ts");
const { buscarNaInternet, referenciasDoItem } = await import("../src/agentes/busca/internet.ts");
const { consultasPagasFeitas, SERPER_LIMITE } = await import("../src/agentes/busca/rede.ts");

await migrate(db, { migrationsFolder: "drizzle" });
const [c] = await db.insert(schema.contato).values({ canal: "web", endereco: `busca-${Date.now()}`, papel: "comprador" }).returning();
const [p] = await db.insert(schema.pedido).values({ compradorId: c!.id, canalOrigem: "web", textoOriginal: descricao, cep, estado: "em_andamento" }).returning();
const [i] = await db.insert(schema.itemPedido).values({ pedidoId: p!.id, ordem: 1, descricao, quantidade: qtd, unidade, estado: "buscando" }).returning();

const antes = await consultasPagasFeitas();
const t0 = Date.now();
const r = await buscarNaInternet(i!.id);
console.log(`\n${descricao} · ${qtd} ${unidade} · CEP ${cep} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(r);
const todas = await db.query.referenciaPreco.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, i!.id) });
for (const x of todas) {
  console.log(`${x.aceita ? "✔" : "✖"} [${x.metodo}] ${x.loja} · ${x.titulo.slice(0, 60)} · R$ ${x.precoFonte}${x.precoUnitario && x.precoUnitario !== x.precoFonte ? ` (unit. ${x.precoUnitario})` : ""}${x.disponivel === false ? " · sem estoque" : ""}${x.regiaoDoPreco ? ` · ${x.regiaoDoPreco}` : ""}${x.frete ? ` · frete ${x.frete} em ${x.fretePrazoDias} d` : ""}${x.motivoCorte ? ` — ${x.motivoCorte}` : ""}`);
}
const evento = await db.query.evento.findFirst({ where: (t, { eq }) => eq(t.itemPedidoId, i!.id) });
console.log(`\nRegistro: ${evento?.acao}\n${evento?.motivo}`);
console.log(`Serper: ${(await consultasPagasFeitas()) - antes} consultas agora; ${await consultasPagasFeitas()} de ${SERPER_LIMITE()} no total.`);
console.log("mediana:", (await referenciasDoItem(i!.id)).mediana);
await conexao.end();
