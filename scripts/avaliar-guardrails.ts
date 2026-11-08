// Avaliação dos guardrails com os casos de docs/plano-ia/guardrails.md (60 do comprador e
// 9 do fornecedor): acerto, falso positivo e falso negativo por classe. Sem banco nem busca.
//
// npm run guardrails:avaliar                    # com IA (Interpretador e Extrator reais): ~80 chamadas
// npm run guardrails:avaliar -- --sem-ia        # só o código (triagem + pós-regras), sem chamada
// npm run guardrails:avaliar -- --so 3,22,28,F1 # só alguns casos
// npm run guardrails:avaliar -- --json saida.json

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta: só IA

const { CASOS_COMPRADOR, CASOS_FORNECEDOR, metricasPorClasse } = await import("../src/simulador/casos/guardrails.ts");
const { avaliarCaso, decidirComIa, decidirSemIa } = await import("../src/simulador/casos/avaliar-guardrails.ts");
type ResultadoCaso = import("../src/simulador/casos/guardrails.ts").ResultadoCaso;

const args = process.argv.slice(2);
const valor = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const semIa = args.includes("--sem-ia");
const so = valor("--so")?.split(",").map((s) => s.trim().toUpperCase());
const arquivoJson = valor("--json");
const escolhido = (n: string | number) => !so || so.includes(String(n).toUpperCase());

let chamadas = 0;
if (!semIa) {
  const { aoRegistrarUso } = await import("../src/nucleo/ia/index.ts");
  aoRegistrarUso((r) => {
    chamadas++;
    if (!r.ok) console.log(`  (IA ${r.modelo} falhou: ${r.erro?.slice(0, 120)})`);
  });
}
const { interpretar } = semIa ? { interpretar: null } : await import("../src/agentes/interpretador/index.ts");
const t0 = Date.now();

console.log(`Comprador (${semIa ? "só código" : "com IA"})\n`);
const resultados: (ResultadoCaso & { texto: string; modelos?: string[] })[] = [];
for (const c of CASOS_COMPRADOR.filter((x) => escolhido(x.n))) {
  let r: ResultadoCaso;
  let modelos: string[] | undefined;
  if (c.pulado) r = avaliarCaso(c, "pedido", null);
  else if (semIa) {
    const d = decidirSemIa(c);
    r = avaliarCaso(c, d.classe, d.decisao);
  } else {
    try {
      const d = await decidirComIa(c, (e, ctx) => interpretar!(e, ctx));
      modelos = d.modelos;
      r = avaliarCaso(c, d.classe, d.decisao);
    } catch (erro) {
      r = { n: c.n, esperado: c.classes, obtido: "pulado", pedido: null, ok: false, grupo: c.grupo, motivo: `erro: ${String(erro).slice(0, 120)}` };
    }
  }
  resultados.push({ ...r, texto: c.texto, modelos });
  const marca = r.obtido === "pulado" ? "·" : r.ok ? "✔" : "✖";
  console.log(`${marca} ${String(c.n).padStart(2)} ${String(r.obtido).padEnd(14)} ${c.texto.slice(0, 70) || c.obs || ""}${r.motivo ? `  [${r.motivo}]` : ""}${modelos?.length === 2 ? "  (forte)" : ""}`);
}

const m = metricasPorClasse(resultados);
console.log("\nPor classe (esperada):  casos  acertos  falso+  falso−");
for (const [classe, l] of Object.entries(m.porClasse).sort()) {
  console.log(`  ${classe.padEnd(20)} ${String(l.casos).padStart(5)} ${String(l.acertos).padStart(8)} ${String(l.falsoPositivo).padStart(7)} ${String(l.falsoNegativo).padStart(7)}`);
}
console.log(`\nLegítimos bloqueados (nunca pode): ${m.bloqueouLegitimo.join(", ") || "nenhum"}`);
console.log(`Proibidos ou controlados que chegariam à busca (nunca pode): ${m.deixouPassar.join(", ") || "nenhum"}`);

type ResultadoFornecedor = { n: string; ok: boolean; classificacao: string; alertas: string[]; motivo?: string };
const fornecedor: ResultadoFornecedor[] = [];
const casosF = CASOS_FORNECEDOR.filter((f) => escolhido(f.n));
if (casosF.length && !semIa) {
  const { extrair } = await import("../src/agentes/extrator/index.ts");
  const item = { descricao: "Cimento Portland CP II 50 kg", quantidade: 40, unidade: "saco", aceitaSimilar: true, destino: "Rua de Exemplo, 100, São Paulo/SP", modoEntrega: "entrega" as const };
  console.log("\nFornecedor → Extrator (alertas)\n");
  for (const f of casosF) {
    try {
      const r = await extrair(item, { texto: f.texto });
      const motivos: string[] = [];
      if (!f.classificacao.includes(r.valor.classificacao)) motivos.push(`classificação ${r.valor.classificacao}`);
      const faltou = f.alertas.filter((a) => !r.valor.alertas.includes(a));
      const sobrou = (f.semAlertas ?? []).filter((a) => r.valor.alertas.includes(a));
      if (faltou.length) motivos.push(`faltou ${faltou.join(", ")} (falso negativo)`);
      if (sobrou.length) motivos.push(`sobrou ${sobrou.join(", ")} (falso positivo)`);
      fornecedor.push({ n: f.n, ok: !motivos.length, classificacao: r.valor.classificacao, alertas: r.valor.alertas, motivo: motivos.join("; ") || undefined });
    } catch (erro) {
      fornecedor.push({ n: f.n, ok: false, classificacao: "erro", alertas: [], motivo: String(erro).slice(0, 120) });
    }
    const x = fornecedor.at(-1)!;
    console.log(`${x.ok ? "✔" : "✖"} ${x.n.padEnd(3)} ${x.classificacao.padEnd(15)} [${x.alertas.join(", ")}] ${f.texto.slice(0, 60)}${x.motivo ? `  [${x.motivo}]` : ""}`);
  }
} else if (casosF.length) console.log("\nFornecedor: os 9 casos dependem do Extrator (IA); rode sem --sem-ia.");

const erros = resultados.filter((r) => !r.ok).length + fornecedor.filter((f) => !f.ok).length;
console.log(`\n${erros ? `${erros} caso(s) com erro` : "Todos os casos passaram."} · ${chamadas} chamada(s) de IA · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (arquivoJson) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(arquivoJson, JSON.stringify({ quando: new Date().toISOString(), semIa, chamadas, comprador: resultados, porClasse: m, fornecedor }, null, 2));
  console.log(`JSON em ${arquivoJson}`);
}
process.exit(erros ? 1 : 0);
