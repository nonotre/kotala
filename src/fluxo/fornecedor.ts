// Conversa com o fornecedor: cadastro pelo bot (R5), respostas de cotação
// (Extrator, R6), dúvidas (Cotador) e confirmação do pedido de compra (R11).

import { and, eq } from "drizzle-orm";
import { cotacaoAbertaDo, encerrarSeTodosResponderam, responderDuvida } from "../agentes/cotador/index.ts";
import { extrair, type Extracao } from "../agentes/extrator/index.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato as tContato, cotacao, fornecedor, itemPedido, oferta, pedido } from "../nucleo/db/schema.ts";
import type { AnexoIa } from "../nucleo/ia/index.ts";
import { baixarAnexo, enviar, marcarParouContato, type MensagemRecebida } from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { aoRespostaDoVencedor, pedidoEnviadoPara } from "./decisao.ts";

export const AVISO_PRIVACIDADE_FORNECEDOR =
  "Olá! Sou o assistente automatizado de cotações de material de construção. Ao se cadastrar, você recebe pedidos de cotação por aqui, " +
  "sem compromisso de compra. Guardo o nome da empresa e as mensagens desta conversa só para as cotações. Para sair, escreva PARAR.";

const PERGUNTA_NOME = "Qual o nome da sua empresa?";
const CONFIRMA = /^(confirmo|confirmado|confirmamos|ok,? confirmo|pode mandar|fechado)[!.\s]*$/i;

export async function aoMensagemDoFornecedor({ contato, mensagemId, entrada }: MensagemRecebida) {
  const texto = entrada.texto.trim();

  // Botões do pedido de compra.
  if (entrada.botao) {
    const m = /^compra:(\d+):(confirmo|desisto)$/.exec(entrada.botao);
    if (m) await aoRespostaDoVencedor(contato, Number(m[1]), m[2] === "confirmo");
    return;
  }

  // R5: cadastro. Quem chega ao bot do fornecedor sem cadastro informa o nome da empresa.
  if (!contato.fornecedorId) {
    if (!texto || texto.startsWith("/")) {
      if (!contato.avisoPrivacidadeEm) {
        await db.update(tContato).set({ avisoPrivacidadeEm: new Date() }).where(eq(tContato.id, contato.id));
      }
      await enviar(contato.id, AVISO_PRIVACIDADE_FORNECEDOR);
      await enviar(contato.id, PERGUNTA_NOME);
      return;
    }
    const nome = texto.slice(0, 120);
    const [f] = await db.insert(fornecedor).values({ nome, origem: "real", fonte: "Cadastro pelo bot" }).returning();
    await db
      .update(tContato)
      .set({ fornecedorId: f!.id, papel: "fornecedor", nome, avisoPrivacidadeEm: contato.avisoPrivacidadeEm ?? new Date() })
      .where(eq(tContato.id, contato.id));
    await registrar(db, {
      agente: "Fornecedor",
      acao: `${nome} se cadastrou pelo bot.`,
      motivo: "Entrou pelo link ou QR do fornecedor.",
      fornecedorIds: [f!.id],
    });
    await enviar(contato.id, `Cadastro feito, ${nome}! Quando houver pedido de cotação, mando por aqui. Pode responder do seu jeito, em texto ou PDF.`);
    return;
  }

  if (texto.startsWith("/start")) {
    const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, contato.fornecedorId));
    await enviar(contato.id, `Você já está cadastrado como ${f?.nome}. Quando houver cotação, mando por aqui.`);
    return;
  }

  // Confirmação do pedido de compra por texto.
  if (CONFIRMA.test(texto)) {
    const itemId = await pedidoEnviadoPara(contato.fornecedorId);
    if (itemId && (await aoRespostaDoVencedor(contato, itemId, true))) return;
  }

  const c = await cotacaoAbertaDo(contato.fornecedorId);
  if (!c) {
    await enviar(contato.id, "Não tenho cotação aberta para você agora. Obrigado!");
    return;
  }
  await processarResposta(c, contato.id, mensagemId, entrada);
}

async function processarResposta(
  c: typeof cotacao.$inferSelect,
  contatoId: string,
  mensagemId: string,
  entrada: MensagemRecebida["entrada"],
) {
  const [l] = await db
    .select({ item: itemPedido, pedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(itemPedido.id, c.itemPedidoId));
  if (!l) return;
  const ctx = { pedidoId: l.pedido.id, itemPedidoId: l.item.id };

  // E5: PDF e foto vão junto para o Extrator.
  const anexos: AnexoIa[] = [];
  const arquivos = (entrada.anexos ?? []).filter((a) => a.tipo === "pdf" || a.tipo === "foto");
  for (const a of arquivos) {
    try {
      const r = await baixarAnexo(entrada.canal, a);
      anexos.push({ dados: r.dados, mediaType: r.mediaType });
    } catch (erro) {
      console.error("[fornecedor] anexo", erro);
    }
  }
  if (!entrada.texto.trim() && !anexos.length) {
    await enviar(contatoId, "Por enquanto leio texto, PDF e foto. Pode mandar a proposta assim?", ctx);
    return;
  }

  let e: Extracao;
  let modelo = "";
  try {
    const r = await extrair(
      {
        descricao: l.item.descricao,
        quantidade: Number(l.item.quantidade),
        unidade: l.item.unidade,
        aceitaSimilar: l.item.aceitaSimilar,
        destino: l.pedido.destino,
        modoEntrega: l.pedido.modoEntrega,
      },
      { texto: entrada.texto, anexos },
      ctx,
    );
    e = r.valor;
    modelo = r.modelo;
  } catch (erro) {
    await registrar(db, { agente: "Extrator", acao: "Não conseguiu ler a resposta.", motivo: String(erro), ...ctx, fornecedorIds: [c.fornecedorId] });
    await enviar(contatoId, "Recebi! Tive um problema para ler agora. Pode reenviar em instantes?", ctx);
    return;
  }

  switch (e.classificacao) {
    case "proposta": {
      await db.transaction(async (tx) => {
        await tx.delete(oferta).where(and(eq(oferta.cotacaoId, c.id), eq(oferta.rodada, c.rodada)));
        await tx.insert(oferta).values({
          itemPedidoId: l.item.id,
          fornecedorId: c.fornecedorId,
          cotacaoId: c.id,
          rodada: c.rodada,
          itemOferecido: e.itemOferecido ?? l.item.descricao,
          itemExato: e.itemExato,
          embalagem: e.embalagem,
          quantidadeOfertada: e.quantidadeOfertada?.toString(),
          unidadeOfertada: e.unidadeOfertada,
          precoUnitario: e.precoUnitario?.toString(),
          totalProduto: e.totalProduto?.toString(),
          frete: e.frete?.toString(),
          origemFrete: e.frete !== null ? "informado" : null,
          prazoDias: e.prazoDias,
          validadeDias: e.validadeDias,
          pagamento: e.pagamento,
          prazoPagamentoDias: e.prazoPagamentoDias,
          impostosNaoInclusos: e.impostosNaoInclusos,
          impostosValor: e.impostosValor?.toString(),
          entregaNoLocal: e.entregaNoLocal,
          formato: anexos.length ? (arquivos[0]?.tipo === "pdf" ? "pdf" : "foto") : "texto",
          mensagemId,
          extraido: { ...e, modelo },
        });
        await tx.update(cotacao).set({ situacao: "respondeu", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
      });
      const faltam: string[] = [];
      if (e.prazoDias === null) faltam.push("prazo de entrega");
      if (e.frete === null && l.pedido.modoEntrega !== "retirada") faltam.push("frete");
      if (e.pagamento === null) faltam.push("condição de pagamento");
      await registrar(db, {
        agente: "Extrator",
        acao: `Leu a proposta: ${e.precoUnitario !== null ? `R$ ${e.precoUnitario} por ${l.item.unidade}` : `total R$ ${e.totalProduto}`}${e.itemExato ? "" : " (item equivalente)"}.`,
        motivo: faltam.length ? `Faltou: ${faltam.join(", ")}.` : "Proposta completa.",
        ...ctx,
        fornecedorIds: [c.fornecedorId],
      });
      await enviar(
        contatoId,
        `Recebi sua proposta para a cotação ${l.item.id}. Obrigado!${faltam.length ? ` Se puder, me diga também: ${faltam.join(", ")}.` : ""} Aviso se for escolhida.`,
        ctx,
      );
      await encerrarSeTodosResponderam(l.item.id);
      return;
    }
    case "duvida":
      await responderDuvida(c.id, contatoId, e.duvida ?? entrada.texto);
      return;
    case "parar":
      await marcarParouContato(contatoId);
      await db.update(cotacao).set({ situacao: "parou" }).where(eq(cotacao.id, c.id));
      await encerrarSeTodosResponderam(l.item.id);
      return;
    case "recusa":
      await db.update(cotacao).set({ situacao: "encerrada", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
      await registrar(db, { agente: "Extrator", acao: "O fornecedor não atende este pedido.", motivo: entrada.texto.slice(0, 200), ...ctx, fornecedorIds: [c.fornecedorId] });
      await enviar(contatoId, "Obrigado por avisar!", ctx);
      await encerrarSeTodosResponderam(l.item.id);
      return;
    default:
      await enviar(contatoId, "Não encontrei preço na sua mensagem. Pode mandar o preço unitário, o frete e o prazo de entrega?", ctx);
  }
}
