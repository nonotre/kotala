// Conversa com o fornecedor: convite por e-mail com link pessoal (E1), cadastro
// pelo bot (R5, reserva para o QR), respostas de cotação (Extrator, R6), dúvidas
// (Cotador) e confirmação do pedido de compra (R11).

import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { cotacaoAbertaDo, encerrarSeTodosResponderam, reenviarCotacaoAberta, responderDuvida } from "../agentes/cotador/index.ts";
import { emailValido, FONTE_CONVITE_MANUAL, linkConvite, normalizarEmail } from "../canais/email.ts";
import { EMPRESA } from "../config.ts";
import { extrair, type Extracao } from "../agentes/extrator/index.ts";
import { db } from "../nucleo/db/cliente.ts";
import { avancarItem, TransicaoConcorrente, TransicaoInvalida } from "../nucleo/orquestrador/index.ts";
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
import { baseDeItens } from "../agentes/interpretador/base-itens.ts";
import { palavrasEmComum } from "../agentes/interpretador/index.ts";
import { quando } from "../texto.ts";

export const AVISO_PRIVACIDADE_FORNECEDOR =
  "Olá! Sou o assistente automatizado de cotações de material de construção. Ao se cadastrar, você recebe pedidos de cotação por aqui, " +
  "sem compromisso de compra. Guardo o nome da empresa e as mensagens desta conversa só para as cotações. Para sair, escreva PARAR.";

const PERGUNTA_NOME = "Qual o nome da sua empresa?";
const SAUDACAO = /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem\??|ok|blz|beleza)[!.\s]*$/i;
const CONFIRMA = /^(confirmo|confirmado|confirmamos|ok,? confirmo|pode mandar|fechado)[!.\s]*$/i;

export async function aoMensagemDoFornecedor({ contato, mensagemId, entrada }: MensagemRecebida) {
  const texto = entrada.texto.trim();

  // Botões do pedido de compra e do cadastro.
  if (entrada.botao) {
    if (entrada.botao.startsWith("cad:") && contato.fornecedorId) return botaoDoCadastro(contato, entrada.botao);
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
    const [f] = await db.insert(fornecedor).values({ nome, origem: "real", fonte: "Cadastro pelo bot", cadastroEtapa: "categorias" }).returning();
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
    await perguntarCategorias(contato.id, nome, []);
    return;
  }

  // Cadastro em andamento: o que vende e CNPJ (opcional).
  const [forn] = await db.select().from(fornecedor).where(eq(fornecedor.id, contato.fornecedorId));
  if (forn?.cadastroEtapa && texto && !texto.startsWith("/")) {
    if (await etapaDoCadastro(contato, forn, texto)) return;
  }

  if (texto.startsWith("/start")) {
    const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, contato.fornecedorId));
    await enviar(contato.id, `Você já está cadastrado como ${f?.nome}. Quando houver cotação, mando por aqui.`);
    return;
  }

  // R8: resposta a um pedido de confirmação de preço retido.
  if (await respostaConfirmacaoDePreco(contato.id, contato.fornecedorId, mensagemId, texto)) return;

  // Confirmação do pedido de compra por texto.
  if (CONFIRMA.test(texto)) {
    const itemId = await pedidoEnviadoPara(contato.fornecedorId);
    if (itemId && (await aoRespostaDoVencedor(contato, itemId, true))) return;
  }

  const c = await cotacaoAbertaDo(contato.fornecedorId);
  if (!c) {
    // Sem cotação aberta a conversa não se encerra: guarda a mensagem e explica o que acontece.
    const temConteudo = !!texto || !!entrada.anexos?.length;
    await registrar(db, {
      agente: "Fornecedor",
      acao: `${forn?.nome ?? "Fornecedor"} mandou mensagem sem cotação aberta.`,
      motivo: texto ? texto.slice(0, 300) : entrada.anexos?.length ? "Mandou um anexo." : "Mensagem vazia.",
      fornecedorIds: [contato.fornecedorId],
      dados: { texto: texto.slice(0, 2000), anexos: entrada.anexos?.length ?? 0 },
    });
    if (!temConteudo) return;
    // Resposta que chegou depois de a cotação fechar: explica, em vez de falar como se nada existisse.
    const [recente] = await db
      .select({ itemPedidoId: cotacao.itemPedidoId })
      .from(cotacao)
      .where(and(eq(cotacao.fornecedorId, contato.fornecedorId), gte(cotacao.criadoEm, new Date(Date.now() - 48 * 3600_000))))
      .orderBy(desc(cotacao.criadoEm))
      .limit(1);
    if (recente) {
      await enviar(
        contato.id,
        `A cotação ${recente.itemPedidoId} já foi encerrada. Guardei sua mensagem; se o comprador quiser negociar ou abrir nova rodada, volto a falar com você por aqui.`,
        { itemPedidoId: recente.itemPedidoId },
      );
      return;
    }
    const perguntarCats = forn?.origem === "real" && !forn.categorias.length;
    const cats = forn?.categorias.length ? ` de ${forn.categorias.join(", ")}` : "";
    await enviar(
      contato.id,
      `Recebi sua mensagem e guardei aqui. No momento não há pedido de cotação aberto para vocês. ` +
        `Quando surgir um pedido${cats}, mando por aqui com os detalhes, e aí você pode responder com preço, frete, prazo e pagamento.` +
        (perguntarCats ? " Para receber os pedidos certos, me diga o que vocês vendem (ex.: hidráulica, elétrico, cimento)." : ""),
    );
    if (forn && perguntarCats && !forn.cadastroEtapa) await db.update(fornecedor).set({ cadastroEtapa: "categorias" }).where(eq(fornecedor.id, forn.id));
    return;
  }
  await processarResposta(c, contato.id, mensagemId, entrada);
}

// ---------- R5: cadastro em etapas (o que vende e CNPJ) ----------

/** Categorias da base de itens: as mesmas que a busca usa para escolher a quem cotar. */
export function categoriasConhecidas(): string[] {
  return [...new Set(baseDeItens().map((i) => i.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Acha categorias citadas em texto livre ("vendo cimento, areia e tinta" → Cimentícios, Agregados, Tintas). */
export function categoriasDoTexto(texto: string): string[] {
  const achadas = new Set<string>();
  for (const cat of categoriasConhecidas()) {
    if (palavrasEmComum(texto, cat)) {
      achadas.add(cat);
      continue;
    }
    // Pelo nome dos itens da categoria: "cimento" acha Cimentícios, "areia" acha Agregados.
    if (baseDeItens().some((i) => i.categoria === cat && palavrasEmComum(texto, i.descricao))) achadas.add(cat);
  }
  return [...achadas];
}

async function perguntarCategorias(contatoId: string, nome: string, marcadas: string[]) {
  const cats = categoriasConhecidas();
  await enviar(
    contatoId,
    `${marcadas.length ? `Anotei: ${marcadas.join(", ")}.` : `Cadastro iniciado, ${nome}!`} O que vocês vendem? Toque nas categorias (pode marcar várias) e depois em Pronto, ou escreva do seu jeito.`,
    {
      botoes: [
        ...cats.map((c, i) => ({ rotulo: `${marcadas.includes(c) ? "✓ " : ""}${c}`, dado: `cad:cat:${i}` })),
        { rotulo: "Pronto", dado: "cad:pronto" },
      ],
    },
  );
}

async function perguntarCnpj(contatoId: string) {
  await enviar(contatoId, "Último passo: qual o CNPJ da empresa? Ele serve para conferirmos o cadastro na Receita. Se preferir, toque em Pular.", {
    botoes: [{ rotulo: "Pular", dado: "cad:pular" }],
  });
}

async function concluirCadastro(contatoId: string, f: typeof fornecedor.$inferSelect) {
  await db.update(fornecedor).set({ cadastroEtapa: null }).where(eq(fornecedor.id, f.id));
  const [atual] = await db.select().from(fornecedor).where(eq(fornecedor.id, f.id));
  await registrar(db, {
    agente: "Fornecedor",
    acao: `${f.nome} completou o cadastro.`,
    motivo: `Vende: ${atual?.categorias.join(", ") || "não informou"}. CNPJ: ${atual?.cnpj ?? "não informou"}.`,
    fornecedorIds: [f.id],
  });
  await enviar(
    contatoId,
    `Cadastro feito, ${f.nome}!${atual?.categorias.length ? ` Vou mandar pedidos de ${atual.categorias.join(", ")}.` : ""} Quando houver pedido de cotação, mando por aqui. Pode responder do seu jeito, em texto, PDF, foto ou áudio.`,
  );
  // Cotação que já esperava por este fornecedor chega agora.
  await reenviarCotacaoAberta(f.id, contatoId).catch(() => false);
}

/** Texto durante o cadastro. Devolve false quando a mensagem não é resposta do cadastro (segue o fluxo normal). */
async function etapaDoCadastro(contato: Contato, f: typeof fornecedor.$inferSelect, texto: string): Promise<boolean> {
  if (f.cadastroEtapa === "categorias") {
    const achadas = categoriasDoTexto(texto);
    if (!achadas.length) {
      await enviar(contato.id, `Não reconheci a categoria em "${texto.slice(0, 60)}". Escolha nos botões acima ou escreva, por exemplo: hidráulica, elétrico, cimento, areia, tintas.`);
      return true;
    }
    const categorias = [...new Set([...f.categorias, ...achadas])];
    await db.update(fornecedor).set({ categorias, cadastroEtapa: f.cnpj ? null : "cnpj" }).where(eq(fornecedor.id, f.id));
    await enviar(contato.id, `Anotei: ${categorias.join(", ")}.`);
    if (f.cnpj) await concluirCadastro(contato.id, f);
    else await perguntarCnpj(contato.id);
    return true;
  }
  if (f.cadastroEtapa === "cnpj") {
    const digitos = texto.replace(/\D/g, "");
    if (digitos.length === 14 && cnpjValido(digitos)) {
      await db.update(fornecedor).set({ cnpj: formatarCnpj(digitos) }).where(eq(fornecedor.id, f.id));
      verificarFornecedor(f.id, { forcar: true }).catch((erro) => console.error("[verificação]", erro));
      await concluirCadastro(contato.id, f);
      return true;
    }
    if (/^(pular|n[aã]o( tenho)?|depois|sem cnpj)\b/i.test(texto)) {
      await concluirCadastro(contato.id, f);
      return true;
    }
    if (digitos.length >= 11) {
      await enviar(contato.id, "Esse CNPJ não parece válido. Pode conferir os 14 números? Ou toque em Pular.", { botoes: [{ rotulo: "Pular", dado: "cad:pular" }] });
      return true;
    }
    // Outra coisa (uma proposta, uma dúvida): conclui sem CNPJ e deixa a mensagem seguir.
    await concluirCadastro(contato.id, f);
    return false;
  }
  return false;
}

async function botaoDoCadastro(contato: Contato, dado: string) {
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, contato.fornecedorId!));
  if (!f) return;
  const cat = /^cad:cat:(\d+)$/.exec(dado);
  if (cat) {
    const nome = categoriasConhecidas()[Number(cat[1])];
    if (!nome) return;
    const categorias = f.categorias.includes(nome) ? f.categorias.filter((c) => c !== nome) : [...f.categorias, nome];
    await db.update(fornecedor).set({ categorias, cadastroEtapa: f.cadastroEtapa ?? "categorias" }).where(eq(fornecedor.id, f.id));
    await perguntarCategorias(contato.id, f.nome, categorias);
    return;
  }
  if (dado === "cad:pronto") {
    if (!f.categorias.length) {
      await enviar(contato.id, "Marque pelo menos uma categoria, ou escreva o que vocês vendem.");
      return;
    }
    if (f.cnpj) return concluirCadastro(contato.id, f);
    await db.update(fornecedor).set({ cadastroEtapa: "cnpj" }).where(eq(fornecedor.id, f.id));
    return perguntarCnpj(contato.id);
  }
  if (dado === "cad:pular") return concluirCadastro(contato.id, f);
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

  // Mensagem que completa a proposta já mandada ("validade 10 dias", "frete grátis"):
  // junta com a anterior em vez de trocar por uma proposta sem preço.
  const [anterior] = await db.select().from(oferta).where(and(eq(oferta.cotacaoId, c.id), eq(oferta.rodada, c.rodada))).limit(1);
  if (anterior && (e.classificacao === "proposta" || e.classificacao === "outro")) {
    const completa = completarComAnterior(e, anterior);
    if (completa) e = completa;
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
      if (e.validadeDias === null) faltam.push("validade da proposta (até quando vale o preço)");
      await registrar(db, {
        agente: "Extrator",
        acao: `Leu a proposta: ${e.precoUnitario !== null ? `R$ ${e.precoUnitario} por ${l.item.unidade}` : `total R$ ${e.totalProduto}`}${e.itemExato ? "" : " (item equivalente)"}.`,
        motivo: faltam.length ? `Faltou: ${faltam.join(", ")}.` : "Proposta completa.",
        ...ctx,
        fornecedorIds: [c.fornecedorId],
      });
      if (e.pedidoContato) {
        await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: a proposta chegou, e o fornecedor também pediu para falar com uma pessoa.`, { ...ctx, tipo: "aviso" });
      }
      await encerrarSeTodosResponderam(l.item.id);
      const [agora] = await db.select({ estado: itemPedido.estado }).from(itemPedido).where(eq(itemPedido.id, l.item.id));
      const aberta = agora?.estado === "cotando";
      const ate = l.item.prazoRespostasEm ? ` até ${quando(l.item.prazoRespostasEm).replace(/^(às|em) /, "")}` : "";
      await enviar(
        contatoId,
        [
          `Recebi sua proposta para a cotação ${l.item.id}. Obrigado!`,
          faltam.length ? `Para completar, me diga também: ${faltam.join("; ")}.` : "",
          aberta
            ? `Vou comparar com as outras propostas e aviso o resultado. Se quiser melhorar alguma condição (preço, frete, prazo ou pagamento), pode mandar por aqui${ate}.`
            : "Vou comparar com as outras propostas e aviso o resultado. Se o comprador quiser negociar alguma condição, volto a falar com você por aqui.",
        ]
          .filter(Boolean)
          .join(" "),
        { ...ctx, tipo: faltam.length && aberta ? "completar_proposta" : "proposta_recebida" },
      );
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
    case "responsavel":
    case "suspeita":
    case "ofensa":
    case "fora_do_assunto":
      await situacaoDelicada(e.classificacao, c.fornecedorId, contatoId, entrada.texto, l, ctx);
      return;
    default:
      await enviar(contatoId, "Não encontrei preço na sua mensagem. Pode mandar o preço unitário, o frete e o prazo de entrega?", ctx);
  }
}

const numOuNull = (v: string | null) => (v === null ? null : Number(v));

/** Junta a extração nova com a proposta anterior do mesmo fornecedor. null se a mensagem não traz nada de proposta. */
export function completarComAnterior(e: Extracao, a: typeof oferta.$inferSelect): Extracao | null {
  const trazAlgo = [e.precoUnitario, e.totalProduto, e.frete, e.prazoDias, e.validadeDias, e.pagamento, e.prazoPagamentoDias, e.impostosValor, e.impostosNaoInclusos, e.entregaNoLocal].some((v) => v !== null);
  if (!trazAlgo) return null;
  const novoPreco = e.precoUnitario !== null || e.totalProduto !== null;
  return {
    ...e,
    classificacao: "proposta",
    itemOferecido: e.itemOferecido ?? a.itemOferecido,
    itemExato: novoPreco ? e.itemExato : a.itemExato,
    precoUnitario: novoPreco ? e.precoUnitario : numOuNull(a.precoUnitario),
    totalProduto: novoPreco ? e.totalProduto : numOuNull(a.totalProduto),
    quantidadeOfertada: e.quantidadeOfertada ?? numOuNull(a.quantidadeOfertada),
    unidadeOfertada: e.unidadeOfertada ?? a.unidadeOfertada,
    embalagem: e.embalagem ?? a.embalagem,
    frete: e.frete ?? numOuNull(a.frete),
    impostosValor: e.impostosValor ?? numOuNull(a.impostosValor),
    impostosNaoInclusos: e.impostosNaoInclusos ?? a.impostosNaoInclusos,
    prazoDias: e.prazoDias ?? a.prazoDias,
    validadeDias: e.validadeDias ?? a.validadeDias,
    pagamento: e.pagamento ?? a.pagamento,
    prazoPagamentoDias: e.prazoPagamentoDias ?? a.prazoPagamentoDias,
    entregaNoLocal: e.entregaNoLocal ?? a.entregaNoLocal,
  };
}

/**
 * Q7: situações que a área de compras listou no chat com fornecedor. Resposta
 * segura, sem revidar e sem sair da cotação; o comprador é avisado quando precisa.
 * A cotação continua aberta.
 */
async function situacaoDelicada(
  tipo: "responsavel" | "suspeita" | "ofensa" | "fora_do_assunto",
  fornecedorId: string,
  contatoId: string,
  texto: string,
  l: { item: typeof itemPedido.$inferSelect; pedido: typeof pedido.$inferSelect },
  ctx: { pedidoId: number; itemPedidoId: number },
) {
  const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  const nome = f?.nome ?? "O fornecedor";
  const item = `${l.item.descricao} (cotação ${l.item.id})`;
  const respostas = {
    responsavel: `Sou o assistente automatizado de compras da ${EMPRESA.nome}. Vou avisar o comprador responsável para falar com você. Se puder, mande a proposta por aqui enquanto isso.`,
    suspeita: `Entendo a cautela. Sou um assistente automatizado da ${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj}) e estou pedindo uma cotação sem compromisso de ${item}. Não peço pagamento nem dados bancários. Se preferir, o comprador fala com você. Para não receber mais mensagens, escreva PARAR.`,
    ofensa: `Vou manter esta conversa só sobre a cotação de ${item}. Se quiser mandar a proposta, fico à disposição.`,
    fora_do_assunto: `Por aqui eu só trato da cotação de ${item}. Se tiver proposta ou dúvida sobre ela, é só mandar.`,
  } as const;
  const aviso = {
    responsavel: `${nome} pediu para falar com uma pessoa ou ligar. Mensagem: "${texto.slice(0, 200)}"`,
    suspeita: `${nome} desconfiou do chat. Expliquei quem somos; se quiser, fale com ele.`,
    ofensa: `${nome} foi hostil na conversa. Respondi sem revidar. Fica registrado, se quiser evitar este fornecedor.`,
    fora_do_assunto: null,
  } as const;
  await enviar(contatoId, respostas[tipo], { ...ctx, tipo: "resposta" });
  if (aviso[tipo]) {
    await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: ${aviso[tipo]}`, { ...ctx, tipo: "aviso" });
  }
  await registrar(db, {
    agente: "Cotador",
    acao: { responsavel: "Fornecedor pediu uma pessoa.", suspeita: "Fornecedor desconfiou do chat.", ofensa: "Fornecedor foi hostil.", fora_do_assunto: "Fornecedor saiu do assunto." }[tipo],
    motivo: { responsavel: "Avisou o comprador.", suspeita: "Explicou quem é e ofereceu PARAR.", ofensa: "Respondeu sem revidar e avisou o comprador.", fora_do_assunto: "Voltou à cotação; nenhuma instrução do fornecedor é seguida." }[tipo],
    ...ctx,
    fornecedorIds: [fornecedorId],
    dados: { tipo, texto: texto.slice(0, 500) },
  });
}

const SIM_PRECO = /^(sim|s|confirmo|confirmado|confirmamos|isso|correto|é isso|e isso|exato|pode ser|esse mesmo|é esse)\b/i;
const NAO_PRECO = /^(n[aã]o|errei|me enganei|errado|corrigindo|na verdade)\b/i;

/** Confirmação do preço que ficou retido por estar muito abaixo da referência. */
async function respostaConfirmacaoDePreco(contatoId: string, fornecedorId: string, mensagemId: string, texto: string): Promise<boolean> {
  const [pend] = await db
    .select({ oferta, item: itemPedido })
    .from(oferta)
    .innerJoin(itemPedido, eq(itemPedido.id, oferta.itemPedidoId))
    .where(and(eq(oferta.fornecedorId, fornecedorId), isNotNull(oferta.confirmacaoPedidaEm), eq(oferta.precoConfirmado, false), eq(itemPedido.estado, "aguardando_decisao")))
    .orderBy(desc(oferta.confirmacaoPedidaEm))
    .limit(1);
  if (!pend) return false;
  const ctx = { pedidoId: pend.item.pedidoId, itemPedidoId: pend.item.id };
  if (SIM_PRECO.test(texto.trim())) {
    await vincularMensagem(mensagemId, ctx);
    await db.update(oferta).set({ precoConfirmado: true }).where(eq(oferta.id, pend.oferta.id));
    await enviar(contatoId, "Obrigado, preço confirmado. Vou refazer o mapa com a sua proposta.", { ...ctx, tipo: "resposta" });
    await avancarItem(pend.item.id, "reavaliar", {
      agente: "Fornecedor",
      acao: "Confirmou o preço que estava retido.",
      motivo: "Com a confirmação, a proposta volta para a comparação.",
      fornecedorIds: [fornecedorId],
    }).catch((erro) => {
      if (!(erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente)) throw erro;
    });
    return true;
  }
  if (NAO_PRECO.test(texto.trim())) {
    await vincularMensagem(mensagemId, ctx);
    await registrar(db, { agente: "Fornecedor", acao: "Não confirmou o preço retido.", motivo: texto.slice(0, 200), ...ctx, fornecedorIds: [fornecedorId] });
    await enviar(contatoId, "Obrigado por avisar. A proposta fica fora desta comparação; se quiser, mande o preço certo.", { ...ctx, tipo: "resposta" });
    return true;
  }
  return false;
}
