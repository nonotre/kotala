// Ciclo completo sem Telegram: comprador pelo terminal, fornecedores
// simulados respondendo sozinhos, IA real. Usa o banco de teste
// (DATABASE_URL_TESTE) para não mexer no banco dos bots.
//
// npm run simular -- "40 cp2 pra obra alfa até sexta" "clicar:Confirmar" "esperar:aguardando_decisao" "clicar:Aprovar" "clicar:Sim" "esperar:confirmado"
//
// Cada argumento é uma mensagem do comprador, ou:
//   clicar:<início do rótulo>  toca no botão da última mensagem que o tiver
//   esperar:<estado>           espera o item mais recente chegar ao estado (até 5 min)

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
await semearSimulados();

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

for (const arg of process.argv.slice(2)) {
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
await conexao.end();
process.exit(0);
