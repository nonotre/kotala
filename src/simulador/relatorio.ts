// Relatório do simulador (3.5): uma linha por cenário, as expectativas que falharam,
// o resumo por regra e o JSON, no espírito do `npm run assistente:avaliar`.

import type { ResultadoCenario } from "./cenarios/gabarito.ts";

/** Situação do cenário levando em conta o "esperado falhar". */
export function situacao(r: ResultadoCenario): "passou" | "falhou" | "falhou (esperado)" | "passou (inesperado)" {
  if (r.esperadoFalhar) return r.passou ? "passou (inesperado)" : "falhou (esperado)";
  return r.passou ? "passou" : "falhou";
}

/** A rodada só reprova por cenário que falhou sem estar marcado como esperado falhar. */
export const rodadaPassou = (rs: ResultadoCenario[]) => rs.every((r) => situacao(r) !== "falhou");

export function resumoPorRegra(rs: ResultadoCenario[]) {
  const porRegra = new Map<string, { ok: number; total: number }>();
  for (const r of rs) {
    if (r.esperadoFalhar) continue;
    for (const x of r.resultados) {
      const s = porRegra.get(x.regra) ?? { ok: 0, total: 0 };
      s.total++;
      if (x.ok) s.ok++;
      porRegra.set(x.regra, s);
    }
  }
  return [...porRegra.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function textoRelatorio(rs: ResultadoCenario[], modo: "deterministico" | "ia"): string {
  const linhas: string[] = [];
  linhas.push(`\nSimulador (${modo === "ia" ? "IA real" : "determinístico, IA falsa"}): ${rs.length} cenário(s)\n`);
  for (const r of rs) {
    const s = situacao(r);
    const marca = s === "passou" ? "ok " : s === "falhou (esperado)" ? "xf " : s === "passou (inesperado)" ? "?! " : "XX ";
    const oks = r.resultados.filter((x) => x.ok).length;
    const ia = modo === "ia" ? `, IA ${r.usoIa.chamadas} chamadas (${r.usoIa.falhas} falhas), Gemini ${r.rede.geminiReais}` : "";
    linhas.push(`${marca} ${r.cenario.padEnd(18)} ${s.padEnd(20)} ${oks}/${r.resultados.length} expectativas, ${(r.duracaoMs / 1000).toFixed(0)}s${ia}  ${r.titulo}`);
    if (r.esperadoFalhar) linhas.push(`      esperado falhar: ${r.esperadoFalhar}`);
    for (const x of r.resultados.filter((y) => !y.ok)) linhas.push(`      ✗ [${x.regra}] ${x.descricao}${x.detalhe ? ` → ${x.detalhe}` : ""}`);
  }
  linhas.push("\nPor regra (sem os esperados falhar):");
  for (const [regra, s] of resumoPorRegra(rs)) linhas.push(`  ${regra.padEnd(14)} ${s.ok}/${s.total}`);
  linhas.push(`\n${rodadaPassou(rs) ? "RODADA PASSOU" : "RODADA FALHOU"}`);
  return linhas.join("\n");
}
