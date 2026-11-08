// Ciclo completo sem Telegram: comprador pelo terminal, fornecedores
// simulados respondendo sozinhos, IA real. Usa o banco de teste
// (DATABASE_URL_TESTE) para não mexer no banco dos bots.
//
// npm run simular -- "40 cp2 pra obra alfa até sexta" "clicar:Confirmar" "esperar:aguardando_decisao" "clicar:Aprovar" "clicar:Sim" "esperar:confirmado"
//
// Cada argumento é uma mensagem do comprador, ou:
//   clicar:<início do rótulo>  toca no botão da última mensagem que o tiver
//   esperar:<estado>           espera o item mais recente chegar ao estado (até 5 min)
//   dormir:<segundos>          só espera (para o fornecedor simulado responder)
//   persona:<chave>            roteiro pronto de um comprador (src/simulador/compradores.ts:
//                              obra, escritorio, clips, epi, extintor, limpeza, informatica, copa)
//
// SIM_PERSONAS=todas também semeia as personas difíceis de fornecedor (preço ambíguo,
// duas mensagens, só Pix, PDF). No fim, imprime as métricas do harness (desconto por
// rodada, mensagens seguidas sem resposta) do último pedido.

if (process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
process.env.PRAZO_RESPOSTAS_SEG ??= "40";
process.env.SIM_ATRASO_FATOR ??= "0.3";

const { desc } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { ligarFluxos } = await import("../src/fluxo/index.ts");
const { conexao, db, schema } = await import("../src/nucleo/index.ts");
const { aoRegistrarUso } = await import("../src/nucleo/ia/index.ts");
const { canalEmMemoria, receber, registrarCanal } = await import("../src/nucleo/mensagens/index.ts");
const { iniciarVarredor } = await import("../src/nucleo/orquestrador/index.ts");
const { adaptadorSimulado, semearSimulados } = await import("../src/simulador/index.ts");

await migrate(db, { migrationsFolder: "drizzle" });
await semearSimulados({ extras: process.env.SIM_PERSONAS === "todas" });
await (await import("../src/agentes/interpretador/catalogo.ts")).carregarCatalogo();

const { adaptador, enviadas } = canalEmMemoria("web");
registrarCanal(adaptador);
const simulado = adaptadorSimulado();
registrarCanal({
  ...simulado,
  async enviar(endereco, texto, opcoes) {
    console.log(`\n  → ${endereco} [${opcoes.tipo ?? "mensagem"}]: ${texto.split("\n")[0]}`);
    return simulado.enviar(endereco, texto, opcoes);
  },
});
ligarFluxos();
// O terminal fala pelo canal web, então passa pelo Assistente (Frente 3). ASSISTENTE=desligado testa o fluxo puro.
if (process.env.ASSISTENTE !== "desligado") (await import("../src/assistente/roteador.ts")).ligarAssistente();
const pararVarredor = iniciarVarredor(2000);
aoRegistrarUso((r) => {
  if (!r.ok) console.log(`  (IA ${r.rota}/${r.modelo} falhou: ${r.erro})`);
});


const endereco = `terminal-${Date.now()}`;
let n = 0;
let mostradas = 0;

function mostrarNovas() {
  for (const m of enviadas.slice(mostradas)) {
    console.log(`\n< assistente:\n${m.texto}`);
    if (m.opcoes.botoes) console.log(`  [${m.opcoes.botoes.map((b) => b.rotulo).join("] [")}]`);
  }
  mostradas = enviadas.length;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { compradorPorChave } = await import("../src/simulador/compradores.ts");
const passos = process.argv.slice(2).flatMap((a) => {
  if (!a.startsWith("persona:")) return [a];
  const c = compradorPorChave(a.slice(8));
  if (!c) throw new Error(`Persona de comprador desconhecida: ${a.slice(8)}`);
  console.log(`(persona ${c.chave}: ${c.quem})`);
  return c.roteiro;
});

for (const arg of passos) {
  if (arg.startsWith("dormir:")) {
    await esperar(Number(arg.slice(7)) * 1000);
    mostrarNovas();
    continue;
  }
  if (arg.startsWith("esperar:")) {
    const alvo = arg.slice(8);
    console.log(`\n… esperando o item chegar a ${alvo}`);
    const fim = Date.now() + 5 * 60_000;
    let estado = "";
    while (Date.now() < fim) {
      mostrarNovas();
      const [i] = await db.select({ estado: schema.itemPedido.estado }).from(schema.itemPedido).orderBy(desc(schema.itemPedido.id)).limit(1);
      estado = i?.estado ?? "";
      if (estado === alvo) break;
      await esperar(1000);
    }
    mostrarNovas();
    console.log(`… item em ${estado}`);
    continue;
  }
  let botao: string | undefined;
  if (arg.startsWith("clicar:")) {
    const rotulo = arg.slice(7).toLowerCase();
    const m = [...enviadas].reverse().find((e) => e.opcoes.botoes?.some((b) => b.rotulo.toLowerCase().startsWith(rotulo)));
    botao = m?.opcoes.botoes?.find((b) => b.rotulo.toLowerCase().startsWith(rotulo))?.dado;
    if (!botao) {
      console.log(`\n(nenhum botão "${arg.slice(7)}")`);
      continue;
    }
  }
  console.log(`\n> comprador: ${botao ? `[${arg.slice(7)}]` : arg}`);
  await receber({ canal: "web", endereco, idExterno: String(++n), texto: botao ? "" : arg, botao });
  mostrarNovas();
}

pararVarredor();
await esperar(500);
const [ultimo] = await db.select({ id: schema.pedido.id }).from(schema.pedido).orderBy(desc(schema.pedido.id)).limit(1);
if (ultimo) {
  const { metricasDoPedido, textoMetricas } = await import("../src/simulador/metricas.ts");
  console.log(`\n${textoMetricas(await metricasDoPedido(ultimo.id))}`);
}
await conexao.end();
process.exit(0);
