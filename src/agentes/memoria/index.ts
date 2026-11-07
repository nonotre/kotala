// X2: memória de fornecedores. Compra repetida em pouco tempo quase não muda de
// preço: em vez de cotar de novo, o sistema propõe repetir com o mesmo
// fornecedor, com o histórico à vista (preço e data, prazo cumprido, quantas
// vezes já comprou). O comprador decide entre repetir e cotar de novo.

import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { fornecedor, historicoCompra } from "../../nucleo/db/schema.ts";
import { contatoAtivoDoFornecedor } from "../../nucleo/mensagens/index.ts";
import { formatarBRL } from "../comparador/calculo.ts";

/** Janela da recompra, na regra da área de compras: menos de 3 meses. */
export const DIAS_RECOMPRA = 90;

export type Recompra = {
  historicoId: string;
  fornecedorId: string;
  fornecedorNome: string;
  simulado: boolean;
  precoUnitario: number;
  frete: number | null;
  quantidade: number;
  data: Date;
  prazoPrometidoDias: number | null;
  prazoCumprido: boolean | null;
  experiencia: string | null;
  comprasNoPeriodo: number;
};

/** Última compra confirmada do mesmo item nos últimos 90 dias, com fornecedor ainda contatável. */
/** Palavras que identificam o item ("cimento-portland-cp-ii-50-kg" → cimento, cp, ii, 50, kg). */
const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "com", "para", "portland", "lavada", "lavado", "unidade"]);
export function palavrasDoItem(chave: string): Set<string> {
  return new Set(
    chave
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((p) => p && !PALAVRAS_VAZIAS.has(p)),
  );
}

/** Termos que mudam o produto: números (bitola, peso) e numerais romanos (classe, tipo). */
const decisiva = (p: string) => /\d/.test(p) || /^(i|ii|iii|iv|v|vi)$/.test(p);

/**
 * Mesmo item quando a chave é igual, ou quando os termos decisivos são idênticos
 * (CP II não é CP III; 50 kg não é 25 kg) e quase todas as outras palavras coincidem.
 */
export function mesmoItem(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = palavrasDoItem(a);
  const pb = palavrasDoItem(b);
  if (!pa.size || !pb.size) return false;
  const da = [...pa].filter(decisiva).sort().join(" ");
  const db_ = [...pb].filter(decisiva).sort().join(" ");
  if (da !== db_) return false;
  const comuns = [...pa].filter((p) => pb.has(p)).length;
  return comuns / Math.max(pa.size, pb.size) >= 0.75;
}

export async function acharRecompra(item: { itemChave: string | null; descricao: string }, agora = new Date()): Promise<Recompra | null> {
  const desde = new Date(agora.getTime() - DIAS_RECOMPRA * 24 * 3600_000);
  const chave = item.itemChave ?? item.descricao;
  const recentes = await db
    .select({ h: historicoCompra, f: fornecedor })
    .from(historicoCompra)
    .innerJoin(fornecedor, eq(fornecedor.id, historicoCompra.fornecedorId))
    .where(and(gte(historicoCompra.data, desde), isNull(fornecedor.parouEm), isNull(fornecedor.bloqueadoEm)))
    .orderBy(desc(historicoCompra.data))
    .limit(200);
  const linhas = recentes.filter(({ h }) => mesmoItem(chave, h.itemChave));
  for (const { h, f } of linhas) {
    // Atraso registrado tira a compra da recompra automática.
    if (h.prazoCumprido === false) continue;
    if (!(await contatoAtivoDoFornecedor(f.id))) continue;
    const compras = linhas.filter((x) => x.f.id === f.id).length;
    return {
      historicoId: h.id,
      fornecedorId: f.id,
      fornecedorNome: f.nome,
      simulado: f.origem === "simulado",
      precoUnitario: Number(h.precoUnitario),
      frete: h.frete === null ? null : Number(h.frete),
      quantidade: Number(h.quantidade),
      data: h.data,
      prazoPrometidoDias: h.prazoPrometidoDias,
      prazoCumprido: h.prazoCumprido,
      experiencia: h.experiencia,
      comprasNoPeriodo: compras,
    };
  }
  return null;
}

const data = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function textoRecompra(pedidoId: number, item: { descricao: string; unidade: string }, r: Recompra): string {
  const linhas = [
    `Pedido ${pedidoId}: você comprou ${item.descricao} há pouco tempo.`,
    "",
    `Última compra: ${r.fornecedorNome}${r.simulado ? " (simulado)" : ""}, em ${data(r.data)}, a ${formatarBRL(r.precoUnitario)} por ${item.unidade}${r.frete !== null ? `, frete ${formatarBRL(r.frete)}` : ""}.`,
  ];
  if (r.prazoPrometidoDias !== null) linhas.push(`Prazo combinado: ${r.prazoPrometidoDias} ${r.prazoPrometidoDias === 1 ? "dia" : "dias"}${r.prazoCumprido === true ? ", cumprido" : ""}.`);
  if (r.comprasNoPeriodo > 1) linhas.push(`Comprou ${r.comprasNoPeriodo} vezes com ele nos últimos ${DIAS_RECOMPRA} dias.`);
  if (r.experiencia) linhas.push(`Observação: ${r.experiencia}`);
  linhas.push("", "Compras repetidas em menos de 3 meses quase não mudam de preço. Quer repetir com o mesmo fornecedor ou cotar de novo?");
  return linhas.join("\n");
}
