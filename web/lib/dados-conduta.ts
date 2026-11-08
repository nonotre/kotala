// Leitura do banco para a tela de alertas de conduta. Só leitura, como lib/dados.ts.
// Dois lados, sem tabela própria:
// - comprador: os casos dos guardrails, eventos do agente "Guardrail" (src/agentes/guardrail/rastro.ts);
// - fornecedor: os alertas lidos nas respostas (sem nota, propina, pagamento por fora...), dos eventos
//   do Extrator ("Alerta na resposta do fornecedor") e de `oferta.extraido.alertas`. O evento cobre
//   também a resposta barrada, que não vira oferta; a oferta cobre o que veio antes do evento existir.

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { contato, evento, fornecedor, itemPedido, oferta, usuario } from "../../src/nucleo/db/schema.ts";

/** Classes do guardrail que viram linha na tela. "resposta" (o comprador respondeu à pergunta) é só contexto. */
const CLASSES_FORA = ["resposta"];

export type CasoComprador = {
  id: string;
  em: string;
  classe: string;
  subtipo: string | null;
  acao: string;
  motivo: string;
  trecho: string | null;
  pedidoId: number | null;
  /** Nome do usuário ligado ao contato; senão, o nome do contato. */
  quem: string | null;
  /** Só nos avisos ao gestor: se a mensagem saiu. */
  enviado: boolean | null;
};

export type AlertaFornecedor = {
  chave: string;
  em: string;
  alerta: string;
  fornecedorId: string;
  fornecedor: string;
  simulado: boolean;
  bloqueado: boolean;
  motivoBloqueio: string | null;
  homologado: boolean;
  pedidoId: number | null;
  item: string | null;
  /** Trecho da mensagem do fornecedor, quando o evento guardou. */
  texto: string | null;
};

export type Conduta = { comprador: CasoComprador[]; fornecedor: AlertaFornecedor[] };

const LIMITE = 300;

export async function alertasDeConduta(): Promise<Conduta> {
  const casos = await db
    .select({
      id: evento.id,
      em: evento.criadoEm,
      acao: evento.acao,
      motivo: evento.motivo,
      pedidoId: evento.pedidoId,
      dados: evento.dados,
      contato: contato.nome,
      usuario: usuario.nome,
    })
    .from(evento)
    .leftJoin(contato, sql`${contato.id}::text = ${evento.dados}->>'contatoId'`)
    .leftJoin(usuario, eq(usuario.id, contato.usuarioId))
    .where(eq(evento.agente, "Guardrail"))
    .orderBy(desc(evento.criadoEm))
    .limit(LIMITE);

  const comprador: CasoComprador[] = casos.flatMap((c) => {
    const d = (c.dados ?? {}) as { classe?: unknown; subtipo?: unknown; trecho?: unknown; texto?: unknown; enviado?: unknown };
    const classe = String(d.classe ?? "");
    if (CLASSES_FORA.includes(classe)) return [];
    return [
      {
        id: c.id,
        em: c.em.toISOString(),
        classe,
        subtipo: d.subtipo ? String(d.subtipo) : null,
        acao: c.acao,
        motivo: c.motivo,
        trecho: d.trecho ? String(d.trecho) : null,
        pedidoId: c.pedidoId,
        quem: c.usuario ?? c.contato ?? null,
        enviado: typeof d.enviado === "boolean" ? d.enviado : null,
      },
    ];
  });

  // Fornecedor: eventos do Extrator com `dados.alerta` e ofertas com alertas lidos.
  const [eventos, ofertas] = await Promise.all([
    db
      .select({ em: evento.criadoEm, itemId: evento.itemPedidoId, pedidoId: evento.pedidoId, fornecedores: evento.fornecedorIds, dados: evento.dados })
      .from(evento)
      .where(and(eq(evento.agente, "Extrator"), sql`${evento.dados} ? 'alerta'`))
      .orderBy(desc(evento.criadoEm))
      .limit(LIMITE),
    db
      .select({ em: oferta.criadoEm, itemId: oferta.itemPedidoId, fornecedorId: oferta.fornecedorId, alertas: sql<unknown>`${oferta.extraido}->'alertas'` })
      .from(oferta)
      .where(and(isNotNull(oferta.extraido), sql`jsonb_typeof(${oferta.extraido}->'alertas') = 'array'`, sql`jsonb_array_length(${oferta.extraido}->'alertas') > 0`))
      .orderBy(desc(oferta.criadoEm))
      .limit(LIMITE),
  ]);

  type Bruto = { em: Date; alerta: string; fornecedorId: string; itemId: number | null; pedidoId: number | null; texto: string | null };
  const brutos: Bruto[] = [];
  for (const e of eventos) {
    const d = (e.dados ?? {}) as { alerta?: unknown; texto?: unknown };
    const fornecedorId = e.fornecedores?.[0];
    if (!fornecedorId || !d.alerta) continue;
    brutos.push({ em: e.em, alerta: String(d.alerta), fornecedorId, itemId: e.itemId, pedidoId: e.pedidoId, texto: d.texto ? String(d.texto).slice(0, 300) : null });
  }
  for (const o of ofertas) {
    for (const a of Array.isArray(o.alertas) ? o.alertas : []) brutos.push({ em: o.em, alerta: String(a), fornecedorId: o.fornecedorId, itemId: o.itemId, pedidoId: null, texto: null });
  }

  // Um alerta por fornecedor, item e tipo: fica a data mais antiga e o trecho, se algum guardou.
  const unicos = new Map<string, Bruto>();
  for (const b of brutos) {
    const chave = `${b.fornecedorId}|${b.itemId ?? ""}|${b.alerta}`;
    const ja = unicos.get(chave);
    if (!ja) unicos.set(chave, { ...b });
    else {
      if (b.em < ja.em) ja.em = b.em;
      ja.texto ??= b.texto;
      ja.pedidoId ??= b.pedidoId;
    }
  }

  const idsFornecedor = [...new Set([...unicos.values()].map((b) => b.fornecedorId))];
  const idsItem = [...new Set([...unicos.values()].flatMap((b) => (b.itemId ? [b.itemId] : [])))];
  const [fs, itens] = await Promise.all([
    idsFornecedor.length
      ? db
          .select({ id: fornecedor.id, nome: fornecedor.nome, origem: fornecedor.origem, bloqueadoEm: fornecedor.bloqueadoEm, motivoBloqueio: fornecedor.motivoBloqueio, homologado: fornecedor.homologado })
          .from(fornecedor)
          .where(inArray(fornecedor.id, idsFornecedor))
      : [],
    idsItem.length ? db.select({ id: itemPedido.id, pedidoId: itemPedido.pedidoId, descricao: itemPedido.descricao }).from(itemPedido).where(inArray(itemPedido.id, idsItem)) : [],
  ]);

  const fornecedorAlertas: AlertaFornecedor[] = [...unicos.entries()].flatMap(([chave, b]) => {
    const f = fs.find((x) => x.id === b.fornecedorId);
    if (!f) return [];
    const i = itens.find((x) => x.id === b.itemId);
    return [
      {
        chave,
        em: b.em.toISOString(),
        alerta: b.alerta,
        fornecedorId: f.id,
        fornecedor: f.nome,
        simulado: f.origem === "simulado",
        bloqueado: !!f.bloqueadoEm,
        motivoBloqueio: f.motivoBloqueio,
        homologado: f.homologado,
        pedidoId: i?.pedidoId ?? b.pedidoId,
        item: i?.descricao ?? null,
        texto: b.texto,
      },
    ];
  });
  fornecedorAlertas.sort((a, b) => b.em.localeCompare(a.em));

  return { comprador, fornecedor: fornecedorAlertas };
}
