// Leitura da tela Contratos: os contratos (regra em src/agentes/memoria/contrato.ts), os
// itens que podem ter contrato (base fixa e catálogo cadastrado pelo agente) e os
// fornecedores que podem assinar (fora os bloqueados e os que pediram para parar).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, isNull } from "drizzle-orm";
import { listarContratos, type LinhaContrato } from "../../../src/agentes/memoria/contrato.ts";
import { db } from "../../../src/nucleo/db/cliente.ts";
import { fornecedor, itemCatalogo } from "../../../src/nucleo/db/schema.ts";

export type OpcaoItem = { chave: string; descricao: string; unidade: string; categoria: string | null };
export type OpcaoFornecedor = { id: string; nome: string; simulado: boolean };
export type DadosContratos = { contratos: LinhaContrato[]; itens: OpcaoItem[]; fornecedores: OpcaoFornecedor[] };

/** Base fixa de itens (`src/dados/itens.json`, fora do git: pode faltar). Lida pelo cwd, como em lib/dados-pedido.ts. */
function itensDaBaseFixa(): OpcaoItem[] {
  try {
    const arquivo = join(/*turbopackIgnore: true*/ process.cwd(), "..", "src", "dados", "itens.json");
    const { itens } = JSON.parse(readFileSync(arquivo, "utf8")) as { itens: { id: string; descricao: string; unidade_compra: string; categoria?: string | null }[] };
    return itens.map((i) => ({ chave: i.id, descricao: i.descricao, unidade: i.unidade_compra, categoria: i.categoria ?? null }));
  } catch {
    return [];
  }
}

export async function dadosContratos(): Promise<DadosContratos> {
  const [contratos, catalogo, fornecedores] = await Promise.all([
    listarContratos(),
    db.select().from(itemCatalogo).orderBy(asc(itemCatalogo.codigo)),
    db
      .select({ id: fornecedor.id, nome: fornecedor.nome, origem: fornecedor.origem })
      .from(fornecedor)
      .where(and(isNull(fornecedor.bloqueadoEm), isNull(fornecedor.parouEm)))
      .orderBy(asc(fornecedor.nome)),
  ]);
  const itens = new Map<string, OpcaoItem>();
  for (const i of itensDaBaseFixa()) itens.set(i.chave, i);
  for (const c of catalogo) if (!itens.has(c.codigo)) itens.set(c.codigo, { chave: c.codigo, descricao: c.descricao, unidade: c.unidade, categoria: c.categoria });
  return {
    contratos,
    itens: [...itens.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR")),
    fornecedores: fornecedores.map((f) => ({ id: f.id, nome: f.nome, simulado: f.origem === "simulado" })),
  };
}
