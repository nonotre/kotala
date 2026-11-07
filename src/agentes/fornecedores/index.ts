// Gestão de fornecedores pela empresa: lista de bloqueio (quem deu problema não
// entra em busca nem recompra) e homologação (aprovação formal, que soma pontos
// na confiança). Verificar (Q8) continua sendo outra coisa: é o que as fontes dizem.

import { eq } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { fornecedor } from "../../nucleo/db/schema.ts";
import { registrar } from "../../nucleo/registro.ts";
import { verificarFornecedor } from "../verificacao/index.ts";

export type AcaoFornecedor = "bloquear" | "desbloquear" | "homologar" | "desomologar";

export async function alterarFornecedor(fornecedorId: string, acao: AcaoFornecedor, motivo: string) {
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  if (!f) return { ok: false as const, erro: "Fornecedor não existe" };
  const texto = motivo.trim().slice(0, 300);
  if (acao === "bloquear" && !texto) return { ok: false as const, erro: "Diga o motivo do bloqueio" };
  const mudanca = {
    bloquear: { bloqueadoEm: new Date(), motivoBloqueio: texto },
    desbloquear: { bloqueadoEm: null, motivoBloqueio: null },
    homologar: { homologado: true },
    desomologar: { homologado: false },
  }[acao];
  await db.update(fornecedor).set(mudanca).where(eq(fornecedor.id, fornecedorId));
  await registrar(db, {
    agente: "Comprador",
    acao: { bloquear: `Bloqueou ${f.nome}.`, desbloquear: `Desbloqueou ${f.nome}.`, homologar: `Homologou ${f.nome}.`, desomologar: `Tirou a homologação de ${f.nome}.` }[acao],
    motivo: texto || "Decisão da empresa.",
    fornecedorIds: [fornecedorId],
  });
  // Homologação muda os pontos de confiança: refaz a verificação.
  if (acao === "homologar" || acao === "desomologar") await verificarFornecedor(fornecedorId, { forcar: true }).catch(() => {});
  return { ok: true as const };
}
