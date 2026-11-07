// Conversa com o fornecedor: convite por e-mail com link pessoal (E1), cadastro
// pelo bot (R5, reserva para o QR), respostas de cotação (Extrator, R6), dúvidas
// (Cotador) e confirmação do pedido de compra (R11).

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cotacaoAbertaDo, encerrarSeTodosResponderam, reenviarCotacaoAberta, responderDuvida } from "../agentes/cotador/index.ts";
import { emailValido, FONTE_CONVITE_MANUAL, linkConvite, normalizarEmail } from "../canais/email.ts";
import { EMPRESA } from "../config.ts";
import { extrair, type Extracao } from "../agentes/extrator/index.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato as tContato, cotacao, fornecedor, itemPedido, oferta, pedido } from "../nucleo/db/schema.ts";
import type { AnexoIa } from "../nucleo/ia/index.ts";
import {
  baixarAnexo,
  enviar,
  marcarParouContato,
  vincularMensagem,
  type Contato,
  type MensagemRecebida,
  type ResultadoEnvio,
} from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { aoRespostaDoVencedor, pedidoEnviadoPara } from "./decisao.ts";
import { cnpjValido, formatarCnpj, verificarFornecedor } from "../agentes/verificacao/index.ts";

export const AVISO_PRIVACIDADE_FORNECEDOR =
  "Olá! Sou o assistente automatizado de cotações de material de construção. Ao se cadastrar, você recebe pedidos de cotação por aqui, " +
  "sem compromisso de compra. Guardo o nome da empresa e as mensagens desta conversa só para as cotações. Para sair, escreva PARAR.";

const PERGUNTA_NOME = "Qual o nome da sua empresa?";
const SAUDACAO = /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem\??|ok|blz|beleza)[!.\s]*$/i;
const CONFIRMA = /^(confirmo|confirmado|confirmamos|ok,? confirmo|pode mandar|fechado)[!.\s]*$/i;

export async function aoMensagemDoFornecedor({ contato, mensagemId, entrada }: MensagemRecebida) {
  const texto = entrada.texto.trim();

  // Botões do pedido de compra.
  if (entrada.botao) {
    const m = /^compra:(\d+):(confirmo|desisto)$/.exec(entrada.botao);
    if (m) {
      await vincularMensagem(mensagemId, { itemPedidoId: Number(m[1]) });
      await aoRespostaDoVencedor(contato, Number(m[1]), m[2] === "confirmo");
    }
    return;
  }

  // E1: link pessoal do convite. Liga a conversa ao fornecedor já conhecido, sem perguntar o nome.
  if (!contato.fornecedorId && entrada.convite) {
    const [f] = await db.select().from(fornecedor).where(eq(fornecedor.codigoConvite, entrada.convite));
    if (f) {
      await ligarPeloConvite(contato, f);
      return;
    }
  }

  // R5: cadastro. Quem chega ao bot do fornecedor sem cadastro informa o nome da empresa.
  if (!contato.fornecedorId) {
    // Só aceita o nome depois de perguntar; saudação nunca vira nome de empresa.
    const jaPerguntou = !!contato.avisoPrivacidadeEm;
    if (!texto || texto.startsWith("/") || !jaPerguntou || SAUDACAO.test(texto)) {
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

// ---------- E1: convite por e-mail com link pessoal ----------

/** Código do link pessoal: só [A-Za-z0-9_-], como o Telegram exige no /start. */
const novoCodigo = () => `f${randomBytes(9).toString("base64url")}`;

export function textoConvite(nome: string, link: string): string {
  return [
    `Olá, ${nome}!`,
    "",
    `Sou o assistente automatizado de compras da ${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj}). Queremos convidar vocês a receber nossos pedidos de cotação de material de construção, sem compromisso de compra.`,
    "",
    "As cotações chegam e são respondidas pelo Telegram, do seu jeito: texto, PDF ou foto. Para começar, abra o link abaixo e toque em Iniciar:",
    "",
    link,
    "",
    "O link é pessoal: liga a conversa à sua empresa, sem cadastro.",
    "Guardamos só o nome da empresa, este e-mail e as mensagens das cotações. Se não tiver interesse, basta ignorar este e-mail. Para parar depois, escreva PARAR no Telegram.",
  ].join("\n");
}

export type Convite = { fornecedorId: string; codigo: string; link: string; envio: ResultadoEnvio };

/**
 * Convite manual: alguém digita o e-mail (a banca, o time) e a pessoa recebe o
 * link pessoal do bot. É o único jeito de liberar um endereço que não está em
 * EMAIL_PERMITIDOS (ver a trava em canais/email.ts).
 */
export async function convidarPorEmail(dados: { email: string; nome?: string; usuarioBot: string }): Promise<Convite> {
  if (!emailValido(dados.email)) throw new Error(`E-mail inválido: ${dados.email}`);
  const email = normalizarEmail(dados.email);
  const nome = (dados.nome?.trim() || email.split("@")[0]!).slice(0, 120);

  let [f] = await db.select().from(fornecedor).where(eq(fornecedor.email, email)).limit(1);
  if (f && f.fonte !== FONTE_CONVITE_MANUAL) {
    throw new Error(`${email} já é de um fornecedor achado na busca (${f.nome}). Para mandar e-mail a ele, ponha o endereço em EMAIL_PERMITIDOS.`);
  }
  if (!f) {
    [f] = await db.insert(fornecedor).values({ nome, origem: "real", fonte: FONTE_CONVITE_MANUAL, email, codigoConvite: novoCodigo() }).returning();
  } else if (!f.codigoConvite) {
    [f] = await db.update(fornecedor).set({ codigoConvite: novoCodigo() }).where(eq(fornecedor.id, f.id)).returning();
  }
  const forn = f!;
  const codigo = forn.codigoConvite!;

  await db
    .insert(tContato)
    .values({ canal: "email", endereco: email, papel: "fornecedor", fornecedorId: forn.id, nome: forn.nome })
    .onConflictDoNothing();
  const [ct] = await db.select().from(tContato).where(and(eq(tContato.canal, "email"), eq(tContato.endereco, email)));

  const link = linkConvite(dados.usuarioBot, codigo);
  const envio = await enviar(ct!.id, textoConvite(forn.nome, link), { tipo: "convite" });
  await registrar(db, {
    agente: "Fornecedor",
    acao: envio.situacao === "enviada" ? `Convidou ${forn.nome} por e-mail.` : `Não conseguiu convidar ${forn.nome} por e-mail.`,
    motivo: envio.situacao === "enviada" ? "Convite manual com link pessoal do bot." : envio.erro ?? envio.situacao,
    fornecedorIds: [forn.id],
  });
  return { fornecedorId: forn.id, codigo, link, envio };
}

async function ligarPeloConvite(contato: Contato, f: typeof fornecedor.$inferSelect) {
  await db
    .update(tContato)
    .set({ fornecedorId: f.id, papel: "fornecedor", nome: f.nome, avisoPrivacidadeEm: contato.avisoPrivacidadeEm ?? new Date() })
    .where(eq(tContato.id, contato.id));
  await registrar(db, {
    agente: "Fornecedor",
    acao: `${f.nome} abriu o link do convite.`,
    motivo: "Link pessoal do convite: a conversa foi ligada ao fornecedor sem perguntar o nome.",
    fornecedorIds: [f.id],
  });
  await enviar(
    contato.id,
    `Olá, ${f.nome}! Sou o assistente automatizado de cotações da ${EMPRESA.nome}. Esta conversa ficou ligada à sua empresa pelo link do convite. ` +
      "Guardo o nome da empresa e as mensagens desta conversa só para as cotações, sem compromisso de compra. Para sair, escreva PARAR.",
  );
  // Cotação que já tinha ido por e-mail chega também aqui, onde dá para responder.
  if (!(await reenviarCotacaoAberta(f.id, contato.id))) {
    await enviar(contato.id, "Quando houver pedido de cotação, mando por aqui. Pode responder do seu jeito, em texto, PDF ou foto.");
  }
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
  await vincularMensagem(mensagemId, ctx);

  // E5: PDF, foto e áudio (R1b) vão junto para o Extrator.
  const anexos: AnexoIa[] = [];
  const arquivos = (entrada.anexos ?? []).filter((a) => a.tipo === "pdf" || a.tipo === "foto" || a.tipo === "audio");
  for (const a of arquivos) {
    try {
      const r = await baixarAnexo(entrada.canal, a, mensagemId);
      anexos.push({ dados: r.dados, mediaType: r.mediaType });
    } catch (erro) {
      console.error("[fornecedor] anexo", erro);
    }
  }
  if (!entrada.texto.trim() && !anexos.length) {
    await enviar(contatoId, "Por enquanto leio texto, PDF, foto e áudio. Pode mandar a proposta assim?", ctx);
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

  // Q8: CNPJ citado na resposta ou no PDF vai para o fornecedor e é conferido.
  if (e.cnpj && cnpjValido(e.cnpj)) {
    const [f] = await db.select({ cnpj: fornecedor.cnpj }).from(fornecedor).where(eq(fornecedor.id, c.fornecedorId));
    if (f && !f.cnpj) {
      await db.update(fornecedor).set({ cnpj: formatarCnpj(e.cnpj) }).where(eq(fornecedor.id, c.fornecedorId));
      await verificarFornecedor(c.fornecedorId, { forcar: true }).catch((erro) => console.error("[verificação]", erro));
    }
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
          formato: anexos.length ? ({ pdf: "pdf", foto: "foto", audio: "voz" } as const)[arquivos[0]!.tipo as "pdf" | "foto" | "audio"] : "texto",
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
