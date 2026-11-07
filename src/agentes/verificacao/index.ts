// Q8: verificação do fornecedor. Acha e consulta o CNPJ, confere a presença,
// junta o histórico e grava o julgamento no fornecedor. Roda quando a busca
// encontra uma loja, quando um fornecedor real responde e antes do mapa.

import { eq, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { fornecedor, historicoCompra } from "../../nucleo/db/schema.ts";
import { registrar } from "../../nucleo/registro.ts";
import { baixarPagina } from "../busca/pagina.ts";
import { acharCnpjs, consultarCnpj, formatarCnpj, limparCnpj, type DadosCnpj } from "./cnpj.ts";
import { julgar, ROTULO_NIVEL, type EntradaJulgamento, type Julgamento } from "./confianca.ts";
import { atualizarSancoes, sancoesDo } from "./sancoes.ts";
import { consultarTjsp } from "./tjsp.ts";
import { consultarPortal } from "./portal.ts";

export * from "./confianca.ts";
export { cnpjValido, formatarCnpj, acharCnpjs } from "./cnpj.ts";

export type Verificacao = Julgamento & {
  em: string;
  fonte: string;
  resumo: string;
  cnpj: string | null;
  razaoSocial: string | null;
  municipio: string | null;
  uf: string | null;
};

const VALIDADE_MS = 24 * 3600_000;

export function resumoVerificacao(v: Pick<Verificacao, "nivel" | "motivos">): string {
  if (v.nivel === "simulado") return "Simulado";
  return `Confiança ${ROTULO_NIVEL[v.nivel]}: ${v.motivos.slice(0, 3).join("; ")}`;
}

export async function verificarFornecedor(fornecedorId: string, opcoes: { forcar?: boolean } = {}): Promise<Verificacao | null> {
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  if (!f) return null;
  const anterior = f.verificacao as Verificacao | null;
  if (!opcoes.forcar && anterior?.em && Date.now() - new Date(anterior.em).getTime() < VALIDADE_MS && "nivel" in anterior) {
    return anterior;
  }

  let cnpj = f.cnpj ? limparCnpj(f.cnpj) : null;
  let presencaVerificavel = false;
  let fonteCnpj = f.cnpj ? "informado pelo fornecedor" : "";

  // Sem CNPJ: procura no site da fonte (rodapé costuma trazer).
  if (f.origem === "real" && f.fonte?.startsWith("http")) {
    const html = await baixarPagina(f.fonte);
    presencaVerificavel = !!html;
    if (!cnpj && html) {
      const achados = acharCnpjs(html);
      if (achados[0]) {
        cnpj = achados[0];
        fonteCnpj = `encontrado em ${f.fonte}`;
      }
    }
  }

  let sancoes: EntradaJulgamento["sancoes"] = null;
  let tjsp: EntradaJulgamento["tjsp"] = null;
  let portal: EntradaJulgamento["portal"] = null;
  if (f.origem === "real" && cnpj) {
    try {
      await atualizarSancoes();
      const s = await sancoesDo(cnpj);
      if (s.base) sancoes = { base: s.base, vigentes: s.sancoes.filter((x) => x.vigente), encerradas: s.sancoes.filter((x) => !x.vigente).length };
    } catch (erro) {
      console.error("[sanções]", erro);
    }
    tjsp = await consultarTjsp(cnpj);
    portal = await consultarPortal(cnpj);
  }

  let dados: DadosCnpj | null = null;
  let cnpjInexistente = false;
  let consultaIndisponivel = false;
  if (f.origem === "real" && cnpj) {
    try {
      dados = await consultarCnpj(cnpj);
      cnpjInexistente = !dados;
    } catch {
      consultaIndisponivel = true;
    }
  }

  const [h] = await db
    .select({
      compras: sql<number>`count(*)::int`,
      cumpridos: sql<number>`count(*) filter (where ${historicoCompra.prazoCumprido})::int`,
      avaliados: sql<number>`count(${historicoCompra.prazoCumprido})::int`,
    })
    .from(historicoCompra)
    .where(eq(historicoCompra.fornecedorId, fornecedorId));

  const j = julgar({
    simulado: f.origem === "simulado",
    homologado: f.homologado,
    cnpj: dados,
    cnpjInexistente,
    consultaIndisponivel,
    presencaVerificavel,
    compras: h?.compras ?? 0,
    prazosCumpridos: h?.cumpridos ?? 0,
    prazosAvaliados: h?.avaliados ?? 0,
    sancoes,
    tjsp,
    portal,
  });
  const v: Verificacao = {
    ...j,
    em: new Date().toISOString(),
    fonte: dados
      ? [`Receita (${dados.fonte}), CNPJ ${fonteCnpj}`, sancoes ? "CEIS e CNEP (dados abertos do Portal da Transparência)" : null, portal ? "Portal da Transparência (API)" : null, tjsp?.disponivel ? "TJSP (e-SAJ)" : null].filter(Boolean).join("; ")
      : f.origem === "simulado" ? "Base fictícia" : "Sem consulta à Receita",
    resumo: "",
    cnpj: cnpj ? formatarCnpj(cnpj) : null,
    razaoSocial: dados?.razaoSocial ?? null,
    municipio: dados?.municipio ?? null,
    uf: dados?.uf ?? null,
  };
  v.resumo = resumoVerificacao(v);

  await db
    .update(fornecedor)
    .set({ verificado: j.verificado, verificacao: v, cnpj: v.cnpj ?? f.cnpj })
    .where(eq(fornecedor.id, fornecedorId));

  if (f.origem === "real" && (!anterior || anterior.nivel !== v.nivel)) {
    await registrar(db, {
      agente: "Verificação",
      acao: `${f.nome}: confiança ${ROTULO_NIVEL[v.nivel]} (${v.pontos} pontos).`,
      motivo: v.motivos.join("; ") + ".",
      fornecedorIds: [fornecedorId],
      dados: { cnpj: v.cnpj, fonte: v.fonte, alertas: v.alertas },
    });
  }
  return v;
}

/** Verifica vários, um de cada vez (as consultas públicas pedem ritmo baixo). */
export async function verificarVarios(ids: string[]) {
  const saida = new Map<string, Verificacao>();
  for (const id of [...new Set(ids)]) {
    try {
      const v = await verificarFornecedor(id);
      if (v) saida.set(id, v);
    } catch (erro) {
      console.error("[verificação]", erro);
    }
  }
  return saida;
}
