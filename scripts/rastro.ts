// Linha do tempo completa de um pedido: eventos dos agentes, mudanças de dados,
// chamadas de IA e mensagens. Com --em, mostra o estado exato naquele instante.
//
// npm run rastro -- 12                       pedido 12 no banco principal
// npm run rastro -- 12 --teste               no banco de teste
// npm run rastro -- 12 --em "2026-11-07T13:05:00-03:00"
// npm run rastro -- 12 --completo            inclui prompt e resposta da IA e todos os campos

const args = process.argv.slice(2);
if (args.includes("--teste") && process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
const pedidoId = Number(args.find((a) => /^\d+$/.test(a)));
const iEm = args.indexOf("--em");
const completo = args.includes("--completo");
if (!pedidoId) {
  console.error('Uso: npm run rastro -- <pedido> [--teste] [--em "<data e hora>"] [--completo]');
  process.exit(1);
}

const { conexao } = await import("../src/nucleo/index.ts");
const { fotoDoPedido, linhaDoTempo } = await import("../src/nucleo/rastreio.ts");

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }) + "." + String(d.getMilliseconds()).padStart(3, "0");
const curto = (v: unknown, n = completo ? 10_000 : 80) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};

if (iEm >= 0) {
  const instante = new Date(args[iEm + 1]!);
  console.log(JSON.stringify(await fotoDoPedido(pedidoId, instante), null, 2));
} else {
  const linhas = await linhaDoTempo(pedidoId);
  console.log(`Pedido ${pedidoId}: ${linhas.length} registros\n`);
  for (const l of linhas) {
    const h = hora(l.em);
    if (l.tipo === "evento") {
      console.log(`${h}  ◆ ${l.agente}: ${l.acao}${l.paraEstado ? `  [${l.deEstado ?? "—"} → ${l.paraEstado}]` : ""}\n              ${l.motivo}`);
    } else if (l.tipo === "dado") {
      const mud = l.mudancas.filter((m) => completo || !["criado_em"].includes(m.campo));
      console.log(`${h}  · ${l.tabela} ${l.chave} ${l.operacao}: ${mud.map((m) => `${m.campo}=${curto(m.para, 40)}`).join(", ").slice(0, completo ? 100_000 : 160)}`);
    } else if (l.tipo === "ia") {
      console.log(`${h}  ✦ IA ${l.agente} ${l.rota}/${l.modelo} ${l.ok ? "ok" : "falhou"} ${l.duracaoMs} ms${l.tokensEntrada ? ` ${l.tokensEntrada}→${l.tokensSaida} tokens` : ""}${l.erro ? ` — ${l.erro}` : ""}`);
      if (completo) console.log(`      prompt: ${l.prompt}\n      resposta: ${l.resposta}`);
    } else {
      console.log(`${h}  ${l.direcao === "entrada" ? "←" : "→"} ${l.canal} [${l.situacao}] ${curto(l.texto.replace(/\n/g, " ⏎ "))}`);
    }
  }
}
await conexao.end();
