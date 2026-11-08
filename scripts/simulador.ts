// 3.6: simulador geral. Roda cenários com gabarito de ponta a ponta no banco de teste
// (DATABASE_URL_TESTE), com a trava de rede ligada, e confere o rastro.
//
// npm run simulador -- todos                 # todos os cenários, IA falsa (sem chamada nenhuma)
// npm run simulador -- feliz desconto        # só alguns
// npm run simulador -- feliz --ia            # IA real no Interpretador, no Extrator etc. (gasta chamadas)
// npm run simulador -- todos --rep 2         # repete cada cenário
// npm run simulador -- todos -v              # mostra a conversa enquanto roda
// npm run simulador -- todos --json saida.json
// npm run simulador -- --lista               # lista os cenários
//
// Sai com código 1 se algum cenário falhar sem estar marcado como "esperado falhar".

if (process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
process.env.SIM_SEM_REDE = "1";

const args = process.argv.slice(2);
const flag = (nome: string) => args.includes(nome);
const valor = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const ia = flag("--ia");
const verboso = flag("-v") || flag("--verboso");
const rep = Math.max(1, Number(valor("--rep") ?? 1) || 1);
const json = valor("--json");
const nomes = args.filter((a, i) => !a.startsWith("-") && !["--rep", "--json"].includes(args[i - 1] ?? ""));

const { CENARIOS, cenarioPorChave } = await import("../src/simulador/cenarios/index.ts");

if (flag("--lista") || !nomes.length) {
  console.log("Cenários (npm run simulador -- <chave|todos> [--ia] [--rep N] [-v] [--json arquivo]):");
  for (const c of CENARIOS) console.log(`  ${c.chave.padEnd(18)} ${c.titulo}${c.esperadoFalhar ? "  (esperado falhar)" : ""}`);
  process.exit(nomes.length || flag("--lista") ? 0 : 1);
}

const escolhidos = nomes.includes("todos") ? CENARIOS : nomes.map((n) => cenarioPorChave(n) ?? (console.error(`Cenário desconhecido: ${n}`), process.exit(1)));

const { conferirBancoDeTeste, encerrarSimulador, rodarCenario } = await import("../src/simulador/executor.ts");
const { conferir } = await import("../src/simulador/cenarios/gabarito.ts");
const { rodadaPassou, textoRelatorio } = await import("../src/simulador/relatorio.ts");

console.log(`Banco: ${conferirBancoDeTeste()} · modo ${ia ? "IA real (Gemini)" : "determinístico (IA falsa)"} · trava de rede ligada`);
const resultados = [];
for (const c of escolhidos) {
  for (let i = 0; i < rep; i++) {
    console.log(`\n▶ ${c.chave}${rep > 1 ? ` (${i + 1}/${rep})` : ""}: ${c.titulo}`);
    const rastro = await rodarCenario(c, { ia, verboso });
    const r = conferir(c, rastro);
    resultados.push(r);
    console.log(`  ${r.passou ? "passou" : "falhou"} (${r.resultados.filter((x) => x.ok).length}/${r.resultados.length}) em ${(rastro.duracaoMs / 1000).toFixed(0)}s`);
  }
}
console.log(textoRelatorio(resultados, ia ? "ia" : "deterministico"));
if (json) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(json, JSON.stringify({ modo: ia ? "ia" : "deterministico", quando: new Date().toISOString(), resultados }, null, 2));
  console.log(`JSON em ${json}`);
}
await encerrarSimulador();
process.exit(rodadaPassou(resultados) ? 0 : 1);
