// Conversa com o fornecedor: convite por e-mail com link pessoal (E1), cadastro
// pelo bot (R5, reserva para o QR), respostas de cotação (Extrator, R6), dúvidas
// (Cotador) e confirmação do pedido de compra (R11).

import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { cotacaoAbertaDo, encerrarSeTodosResponderam, reenviarCotacaoAberta, responderDuvida } from "../agentes/cotador/index.ts";
import { respostaPedidoDeDados } from "../agentes/cotador/dados-empresa.ts";
import { repassarMotivoAoComprador } from "../agentes/cotador/prazo.ts";
import { despacharPerguntas, ETAPA_CATEGORIA_COTACAO } from "../agentes/cotador/cadencia.ts";
import {
  aplicarDesconto,
  citarReferencia,
  compraramAntes,
  condicaoDaOferta,
  condicaoDoDesconto,
  descontoPorUnidade,
  deveNegociar,
  escolherAlavancas,
  jaPediuDesconto,
  mantemFirme,
  marcaDe,
  produtoDe,
  resultadoNegociacao,
  TEXTO_MANTEVE,
  unitarioDe,
  vaiResponderDepois,
  reservarPedidoDeDesconto,
  type CondicaoProposta,
  type MarcaNegociacao,
} from "../agentes/negociador/index.ts";
import { redigirPedidoDeDesconto, type OrigemTexto } from "../agentes/negociador/redacao.ts";
import { referenciasDoItem } from "../agentes/busca/internet.ts";
import { formatarBRL } from "../agentes/comparador/calculo.ts";
import { avisarGestor, liberarSaida } from "../agentes/guardrail/rastro.ts";
import { conferirSaida } from "../agentes/guardrail/index.ts";
import { emailValido, FONTE_CONVITE_MANUAL, linkConvite, normalizarEmail } from "../canais/email.ts";
import { EMPRESA, PAGAMENTO_PADRAO } from "../config.ts";
import { extrair, type AlertaFornecedor, type Extracao } from "../agentes/extrator/index.ts";
import { db } from "../nucleo/db/cliente.ts";
import { avancarItem, TransicaoConcorrente, TransicaoInvalida } from "../nucleo/orquestrador/index.ts";
import { contato as tContato, cotacao, fornecedor, itemPedido, oferta, pedido } from "../nucleo/db/schema.ts";
import type { AnexoIa } from "../nucleo/ia/index.ts";
import {
  baixarAnexo,
  enviar,
  aoPararNaCotacao,
  vincularMensagem,
  type Contato,
  type MensagemRecebida,
  type ResultadoEnvio,
} from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { aoRespostaDoVencedor, pedidoEnviadoPara } from "./decisao.ts";
import { cnpjValido, formatarCnpj, verificarFornecedor } from "../agentes/verificacao/index.ts";
import { categoriasDoCadastro, detectarCategorias, exemplosDoNicho } from "../dominio/categorias.ts";
import { palavrasEmComum } from "../agentes/interpretador/index.ts";
import { quando } from "../texto.ts";

export const AVISO_PRIVACIDADE_FORNECEDOR =
  "Olá! Sou o assistente automatizado de cotações de compras da empresa. Ao se cadastrar, você recebe pedidos de cotação por aqui, " +
  "sem compromisso de compra. Guardo o nome da empresa e as mensagens desta conversa só para as cotações. Para sair de uma cotação, escreva PARAR; para não receber mais nenhuma, ENCERRAR CONTATO.";

/** "papelaria, limpeza, hidráulica", tirado das categorias (as do nicho da empresa primeiro). */
const exemplosDeCategoria = () => exemplosDoNicho().categorias.slice(0, 3).join(", ");

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
    // I1: resposta ao pedido automático de desconto que chegou depois do fechamento.
    if (await respostaTardiaAoDesconto(contato.id, contato.fornecedorId, mensagemId, texto)) return;
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
        (perguntarCats ? ` Para receber os pedidos certos, me diga o que vocês vendem (ex.: ${exemplosDeCategoria()}).` : ""),
    );
    if (forn && perguntarCats && !forn.cadastroEtapa) await db.update(fornecedor).set({ cadastroEtapa: "categorias" }).where(eq(fornecedor.id, forn.id));
    return;
  }
  await processarResposta(c, contato.id, mensagemId, entrada);
}

// ---------- R5: cadastro em etapas (o que vende e CNPJ) ----------

/** Categorias do cadastro: vêm de src/dominio/categorias.json, independentes de haver item na base. */
export function categoriasConhecidas(): string[] {
  return categoriasDoCadastro().map((c) => c.nome);
}

/** Acha categorias citadas em texto livre ("vendo cimento, areia e tinta" → Cimentícios, Agregados, Tintas). */
export function categoriasDoTexto(texto: string): string[] {
  const achadas = new Set<string>();
  // Pelas palavras da categoria: "cimento" acha Cimentícios, "areia" acha Agregados, "papel" acha Escritório.
  for (const c of detectarCategorias(texto)) if (c.cadastro !== false) achadas.add(c.nome);
  // Pelo nome da categoria ("hidráulica", "elétrico").
  for (const c of categoriasDoCadastro()) if (palavrasEmComum(texto, c.nome)) achadas.add(c.nome);
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
  // U5: pergunta de categoria feita depois da cotação. Só vira resposta o que claramente é
  // categoria; preço, desconto ou "não temos" seguem para a cotação.
  if (f.cadastroEtapa === ETAPA_CATEGORIA_COTACAO) {
    const achadas = categoriasDoTexto(texto);
    if (!achadas.length || /\d|\bn[aã]o\b|desconto|pre[cç]o|frete|prazo|proposta/i.test(texto)) return false;
    const categorias = [...new Set([...f.categorias, ...achadas])];
    await db.update(fornecedor).set({ categorias, cadastroEtapa: null }).where(eq(fornecedor.id, f.id));
    await enviar(contato.id, `Anotei: ${categorias.join(", ")}. Obrigado! Vou mandar os pedidos dessas categorias.`);
    return true;
  }
  if (f.cadastroEtapa === "categorias") {
    const achadas = categoriasDoTexto(texto);
    if (!achadas.length) {
      await enviar(contato.id, `Não reconheci a categoria em "${texto.slice(0, 60)}". Escolha nos botões acima ou escreva, por exemplo: ${exemplosDeCategoria()}.`);
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
    // U5: pergunta feita depois da cotação; não abre o resto do cadastro.
    if (f.cadastroEtapa === ETAPA_CATEGORIA_COTACAO) {
      await db.update(fornecedor).set({ cadastroEtapa: null }).where(eq(fornecedor.id, f.id));
      await enviar(contato.id, `Anotei: ${f.categorias.join(", ")}. Obrigado! Vou mandar os pedidos dessas categorias.`);
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
    `Sou o assistente automatizado de compras da ${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj}). Queremos convidar vocês a receber nossos pedidos de cotação de compras da empresa, sem compromisso de compra.`,
    "",
    "As cotações chegam e são respondidas pelo Telegram, do seu jeito: texto, PDF ou foto. Para começar, abra o link abaixo e toque em Iniciar:",
    "",
    link,
    "",
    "O link é pessoal: liga a conversa à sua empresa, sem cadastro.",
    "Guardamos só o nome da empresa, este e-mail e as mensagens das cotações. Se não tiver interesse, basta ignorar este e-mail. Para não receber mais nada depois, escreva ENCERRAR CONTATO no Telegram.",
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
  // S: o nome é digitado por alguém e vai no corpo do convite; confere antes de gravar e mandar.
  const saida = conferirSaida(textoConvite(nome, linkConvite(dados.usuarioBot, "conferencia")));
  if (!saida.ok) {
    await registrar(db, {
      agente: "Guardrail",
      acao: "Não mandou o convite ao fornecedor.",
      motivo: `Conferência de saída: ${saida.motivos.join("; ")}.`,
      dados: { email, nome },
    });
    throw new Error(`Convite não enviado: o texto tinha ${saida.motivos.join("; ")}.`);
  }

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
      "Guardo o nome da empresa e as mensagens desta conversa só para as cotações, sem compromisso de compra. Para sair de uma cotação, escreva PARAR; para não receber mais nenhuma, ENCERRAR CONTATO.",
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

  // Q1/Q2: se a proposta anterior ficou "a confirmar", esta mensagem é a resposta à pergunta.
  const [anterior] = await db.select().from(oferta).where(and(eq(oferta.cotacaoId, c.id), eq(oferta.rodada, c.rodada))).limit(1);
  const pendente = (anterior?.extraido ?? null) as { aConfirmar?: ("preco" | "item")[]; perguntaPendente?: string } | null;
  // I1: com pedido de desconto aberto, o Extrator sabe que a mensagem responde a ele ("não consigo" não é recusa).
  const marcaAberta = marcaDe(anterior?.extraido);
  const descontoAberto = !!marcaAberta && !marcaAberta.respondidaEm;

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
      pendente?.aConfirmar?.length ? pendente.perguntaPendente : descontoAberto ? CONTEXTO_DESCONTO : null,
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

  // Mensagem que completa a proposta já mandada ("validade 10 dias", "frete grátis", "faço 5% a menos"):
  // junta com a anterior em vez de trocar por uma proposta sem preço. I1: desconto condicionado
  // ("3% à vista") não muda o preço; o incondicional é aplicado em código.
  const qtd = Number(l.item.quantidade);
  // Desconto condicionado: o campo do Extrator manda; a regex é a reserva.
  const condicao = condicaoDoDesconto(e, entrada.texto);
  let marcaCarregada: MarcaNegociacao | null = marcaDe(anterior?.extraido);
  if (anterior && (e.classificacao === "proposta" || e.classificacao === "outro")) {
    const completa = completarComAnterior(e, anterior, { quantidade: qtd, condicional: !!condicao, porUnidade: descontoPorUnidade(entrada.texto) });
    if (completa) {
      const { negociacao, ...resto } = completa;
      e = resto;
      marcaCarregada = negociacao ?? marcaCarregada;
    }
  }
  const temPropostaAnterior = !!anterior && (anterior.precoUnitario !== null || anterior.totalProduto !== null);
  const anteriorAConfirmar = !!pendente?.aConfirmar?.length;
  // Perguntei o preço ou o item e a resposta não trouxe preço: a pendência continua.
  if (anteriorAConfirmar && e.classificacao === "proposta" && !e.aConfirmar && e.precoUnitario === null && e.totalProduto === null) e = { ...e, aConfirmar: pendente!.aConfirmar };

  const ressalva = await tratarAlertas(e.alertas, c, contatoId, l, ctx, entrada.texto);
  if (ressalva === "bloqueada") return;
  // Classes que não têm resposta própria sobre o alerta: a ressalva vai sozinha.
  if (ressalva && !["proposta", "outro", "recusa"].includes(e.classificacao)) await enviar(contatoId, ressalva, { ...ctx, tipo: "resposta" });
  // R11: proposta ou recado que também pede dados da empresa ("segue o preço; qual o CNPJ para faturar?").
  // A dúvida pura vai ao Cotador (responderDuvida), que usa o mesmo template.
  if (!ressalva && ["proposta", "outro", "recusa"].includes(e.classificacao)) {
    const dados = respostaPedidoDeDados(l, entrada.texto);
    if (dados && (await liberarSaida(dados, { compradorId: l.pedido.compradorId, ...ctx, oQue: "os dados da empresa" }))) {
      await enviar(contatoId, dados, { ...ctx, tipo: "resposta" });
      await registrar(db, { agente: "Cotador", acao: "Respondeu ao pedido de dados da empresa com o template.", motivo: "R11: só os dados básicos da empresa.", ...ctx, fornecedorIds: [c.fornecedorId], dados: { tipo: "dados_empresa" } });
    }
  }

  switch (e.classificacao) {
    case "proposta": {
      // Q1: preço ambíguo não vira número em silêncio: as colunas de preço ficam vazias (o número lido fica em `extraido`) até o fornecedor responder.
      const precoAConfirmar = !!e.aConfirmar?.includes("preco");
      const perguntaPendente = e.aConfirmar?.length ? perguntaDeConfirmacao(e, l.item) : undefined;
      const agora = new Date();
      // I1: desconto condicionado em resposta ao pedido vai para o texto do pagamento, não para o preço.
      if (condicao && marcaCarregada && !e.pagamento?.includes("não aplicado")) e = { ...e, pagamento: `${e.pagamento ? `${e.pagamento}; ` : ""}desconto condicionado: "${condicao}" (não aplicado ao total)` };
      const depois: CondicaoProposta = {
        precoUnitario: precoAConfirmar ? null : e.precoUnitario,
        totalProduto: precoAConfirmar ? null : e.totalProduto,
        frete: e.frete,
        prazoDias: e.prazoDias,
        pagamento: e.pagamento,
        prazoPagamentoDias: e.prazoPagamentoDias,
        impostosValor: e.impostosValor,
      };
      // I1: a marca do pedido de desconto passa de oferta em oferta (o delete+insert não apaga o "antes"),
      // e o resultado é recalculado em código a cada proposta nova.
      const negociacao: MarcaNegociacao | undefined = !marcaCarregada
        ? undefined
        : precoAConfirmar
          ? { ...marcaCarregada, respondidaEm: marcaCarregada.respondidaEm ?? agora.toISOString() }
          : resultadoNegociacao(marcaCarregada, depois, qtd, { agora, condicao, firme: marcaCarregada.firme });
      const [nova] = await db.transaction(async (tx) => {
        await tx.delete(oferta).where(and(eq(oferta.cotacaoId, c.id), eq(oferta.rodada, c.rodada)));
        const linhas = await tx
          .insert(oferta)
          .values({
            itemPedidoId: l.item.id,
            fornecedorId: c.fornecedorId,
            cotacaoId: c.id,
            rodada: c.rodada,
            itemOferecido: e.itemOferecido ?? l.item.descricao,
            itemExato: e.itemExato,
            embalagem: e.embalagem,
            quantidadeOfertada: e.quantidadeOfertada?.toString(),
            unidadeOfertada: e.unidadeOfertada,
            precoUnitario: precoAConfirmar ? undefined : e.precoUnitario?.toString(),
            totalProduto: precoAConfirmar ? undefined : e.totalProduto?.toString(),
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
            extraido: { ...e, modelo, ...(perguntaPendente ? { perguntaPendente } : {}), ...(negociacao ? { negociacao } : {}) },
          })
          .returning();
        await tx.update(cotacao).set({ situacao: "respondeu", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
        return linhas;
      });
      const faltam: string[] = [];
      if (e.prazoDias === null) faltam.push("prazo de entrega");
      if (e.frete === null && l.pedido.modoEntrega !== "retirada") faltam.push("frete");
      if (e.pagamento === null) faltam.push("condição de pagamento");
      if (e.validadeDias === null) faltam.push("validade da proposta (até quando vale o preço)");
      await registrar(db, {
        agente: "Extrator",
        acao: precoAConfirmar
          ? "Leu a proposta, mas o preço ficou a confirmar (unitário ou total)."
          : `Leu a proposta: ${e.precoUnitario !== null ? `R$ ${e.precoUnitario} por ${l.item.unidade}` : `total R$ ${e.totalProduto}`}${e.itemExato ? "" : " (item equivalente)"}.`,
        motivo: [faltam.length ? `Faltou: ${faltam.join(", ")}.` : "Proposta completa.", perguntaPendente ? "Perguntei ao fornecedor o que ficou a confirmar." : ""].filter(Boolean).join(" "),
        ...ctx,
        fornecedorIds: [c.fornecedorId],
        dados: { aderencia: e.aderencia, divergencias: e.divergencias, leituraPreco: e.leituraPreco, trechoPreco: e.trechoPreco, alertas: e.alertas },
      });
      if (negociacao?.resultado) await registrarResultado(negociacao, c.fornecedorId, ctx);
      // R3b: preço ou frete maior que na proposta anterior entra no mapa (vale a mais recente),
      // mas o comprador fica sabendo agora; nada é aceito sem a aprovação dele no mapa.
      if (anterior && temPropostaAnterior && !precoAConfirmar) {
        const aumento = await avisarAumento(anterior, depois, qtd, c.fornecedorId, l, ctx);
        // O mapa marca a subida na linha do fornecedor ("Subiu: produto de A para B").
        if (aumento && nova) {
          // A cópia local também, para as próximas gravações do extraido (marca do desconto, pergunta) não apagarem a subida.
          nova.extraido = { ...(nova.extraido as Record<string, unknown>), aumento };
          await gravarExtraido(nova.id, nova.extraido as Record<string, unknown>);
        }
      }
      if (e.pedidoContato) {
        await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: a proposta chegou, e o fornecedor também pediu para falar com uma pessoa.`, { ...ctx, tipo: "aviso" });
      }

      // I1: pede desconto em toda proposta completa, uma vez por fornecedor e item, dentro desta mensagem.
      // A marca é gravada antes de tentar fechar a cotação, para o fechamento esperar a janela.
      let pedido: { marca: MarcaNegociacao; texto: string; origem: OrigemTexto } | null = null;
      // R13: pede desconto em qualquer ocasião. Ester (revisaodochat.md): em mensagem separada, nunca junto de
      // outra pergunta; com proposta incompleta, o desconto espera o fornecedor completar e sai depois, sozinho.
      if (nova && !negociacao && !faltam.length && !perguntaPendente) {
        const decisao = deveNegociar({
          temPreco: depois.precoUnitario !== null || depois.totalProduto !== null,
          aConfirmar: !!perguntaPendente,
          alertas: e.alertas.length,
          // A rodada do botão já pediu preço melhor: não repete o pedido na mesma rodada.
          jaPedido: l.item.negociacao?.rodada === c.rodada || (await jaPediuDesconto(c.fornecedorId, l.item.id)),
          estadoItem: l.item.estado,
          prazoRespostasEm: l.item.prazoRespostasEm,
          inicio: c.enviadaEm ?? c.criadoEm,
          agora,
          itemExato: e.itemExato,
          aceitaSimilar: l.item.aceitaSimilar,
          prazoDias: e.prazoDias,
          prazoMaxDias: l.pedido.prazoMaxDias,
        });
        if (decisao.ok && (await reservarPedidoDeDesconto(c.fornecedorId, l.item.id, l.pedido.id))) {
          const [recompra, refs] = await Promise.all([compraramAntes(c.fornecedorId), referenciasDoItem(l.item.id)]);
          const referencia = citarReferencia(unitarioDe(depois, qtd), refs.mediana);
          // I2: a IA redige a partir das mesmas alavancas; reprovada ou fora do ar, vale o template.
          const montado = await redigirPedidoDeDesconto({
            alavancas: escolherAlavancas({
              recompra,
              quantidade: qtd,
              pagamento: e.pagamento,
              pagamentoPreferido: l.pedido.pagamentoPreferido,
              frete: l.pedido.modoEntrega === "retirada" ? null : e.frete,
              entregas: l.pedido.entregas,
            }),
            quantidade: l.item.quantidade,
            unidade: l.item.unidade,
            frete: e.frete,
            referencia,
            pagamentoPreferido: l.pedido.pagamentoPreferido,
            janelaAte: decisao.janelaAte,
            agora,
          }, { contexto: ctx });
          if (montado.motivosIa.length) {
            await registrar(db, { agente: "Negociador", acao: "Usou o template no pedido de desconto, no lugar do texto da IA.", motivo: `A redação por IA não foi usada: ${montado.motivosIa.join("; ")}.`, ...ctx, fornecedorIds: [c.fornecedorId], dados: { redacao: "template", motivosIa: montado.motivosIa } });
          }
          if (!montado.validado) {
            await registrar(db, { agente: "Negociador", acao: "Usou o texto mínimo no pedido de desconto.", motivo: `O texto montado não passou no validador: ${montado.motivos.join("; ")}.`, ...ctx, fornecedorIds: [c.fornecedorId] });
          }
          const marca: MarcaNegociacao = {
            pedidaEm: agora.toISOString(),
            janelaAte: decisao.janelaAte.toISOString(),
            rodadaAuto: 1,
            alavancas: montado.alavancas,
            referenciaCitada: montado.referenciaCitada,
            antes: depois,
          };
          await gravarExtraido(nova.id, { ...(nova.extraido as Record<string, unknown>), negociacao: marca });
          pedido = { marca, texto: montado.texto, origem: montado.origem };
        }
      }

      await encerrarSeTodosResponderam(l.item.id);
      const [agoraItem] = await db.select({ estado: itemPedido.estado }).from(itemPedido).where(eq(itemPedido.id, l.item.id));
      const aberta = agoraItem?.estado === "cotando";
      const ate = l.item.prazoRespostasEm ? ` até ${quando(l.item.prazoRespostasEm).replace(/^(às|em) /, "")}` : "";
      const recebi = negociacao?.resultado === "desconto" ? `Recebi sua proposta atualizada para a cotação ${l.item.id}. Obrigado pelo desconto!` : `Recebi sua proposta para a cotação ${l.item.id}. Obrigado!`;
      // S: o pedido de desconto passa pela conferência de saída; se não passar, vai só o recebimento.
      const textoDesconto = pedido && aberta ? pedido.texto : null;
      const comDesconto =
        !!textoDesconto &&
        (await liberarSaida(textoDesconto, { compradorId: l.pedido.compradorId, ...ctx, oQue: "o pedido de desconto" }));
      const textoComum = [
        recebi,
        perguntaPendente ?? "",
        faltam.length ? `Para completar, me diga também: ${faltam.join("; ")}.` : "",
        ressalva ?? "",
        // Com o pedido de desconto logo abaixo, o convite a melhorar a proposta seria repetido.
        comDesconto
          ? ""
          : aberta
            ? `Vou comparar com as outras propostas e aviso o resultado. Se quiser melhorar alguma condição (preço, frete, prazo ou pagamento), pode mandar por aqui${ate}.`
            : "Vou comparar com as outras propostas e aviso o resultado. Se o comprador quiser negociar alguma condição, volto a falar com você por aqui.",
      ]
        .filter(Boolean)
        .join(" ");
      const completar = (faltam.length > 0 || !!perguntaPendente) && aberta;
      const recebimento = await enviar(contatoId, textoComum, {
        ...ctx,
        // Com proposta incompleta, o que falta vem primeiro (o simulador completa a proposta por este tipo).
        tipo: completar ? "completar_proposta" : "proposta_recebida",
      });
      // Ester: o desconto em mensagem própria, depois do recebimento.
      const r = comDesconto ? await enviar(contatoId, textoDesconto!, { ...ctx, tipo: "negociacao" }) : { situacao: "falhou" as const };
      if (pedido && nova) {
        if (comDesconto && r.situacao === "enviada") {
          await registrar(db, {
            agente: "Negociador",
            acao: "Pediu desconto ao fornecedor, em mensagem separada do recebimento da proposta.",
            motivo: `Uma vez por fornecedor e item; janela ${quando(new Date(pedido.marca.janelaAte))}. Alavancas: ${pedido.marca.alavancas.join(", ") || "nenhuma"}.${pedido.marca.referenciaCitada !== null ? ` Citou só a referência pública (${formatarBRL(pedido.marca.referenciaCitada)}).` : " Não citou valor de fora."} Texto ${pedido.origem === "ia" ? "redigido pela IA e conferido pelo validador" : "do template"}.`,
            ...ctx,
            fornecedorIds: [c.fornecedorId],
            dados: { alavancas: pedido.marca.alavancas, janelaAte: pedido.marca.janelaAte, referenciaCitada: pedido.marca.referenciaCitada, redacao: pedido.origem, texto: pedido.texto },
          });
        } else {
          // Não saiu: tira a marca, para a cotação não esperar uma janela que não existe.
          await gravarExtraido(nova.id, nova.extraido as Record<string, unknown>);
          await encerrarSeTodosResponderam(l.item.id);
        }
      }
      // U3: a cobrança do que falta é pergunta aberta até a próxima mensagem do fornecedor
      // (com ela pendente, o desconto nunca sai junto: ver acima).
      if (completar && nova && recebimento.situacao === "enviada") {
        await gravarExtraido(nova.id, { ...(nova.extraido as Record<string, unknown>), pergunta: { tipo: "completar", em: new Date().toISOString() } });
      }
      await despacharPerguntas(contatoId);
      return;
    }
    case "duvida":
      await responderDuvida(c.id, contatoId, e.duvida ?? entrada.texto, entrada.texto);
      return;
    case "parar":
      // Liria: PARAR no meio de uma cotação sai só dela; "encerrar contato" é que sai de vez.
      await db.update(cotacao).set({ situacao: "desistiu" }).where(eq(cotacao.id, c.id));
      await registrar(db, { agente: "Fornecedor", acao: "Saiu desta cotação (PARAR).", motivo: entrada.texto.slice(0, 200), ...ctx, fornecedorIds: [c.fornecedorId] });
      await enviar(contatoId, TEXTO_SAIU_DA_COTACAO, { ...ctx, tipo: "resposta" });
      await encerrarSeTodosResponderam(l.item.id);
      return;
    case "recusa":
      // Quem já mandou proposta e agora diz que não faz desconto ou que o preço é esse não está recusando o pedido.
      if (temPropostaAnterior) {
        await registrar(db, { agente: "Extrator", acao: "Fornecedor manteve a proposta anterior.", motivo: entrada.texto.slice(0, 200), ...ctx, fornecedorIds: [c.fornecedorId] });
        const noDesconto = await manteveNoDesconto(anterior!, entrada.texto, qtd, c.fornecedorId, ctx);
        await enviar(contatoId, [noDesconto ? TEXTO_MANTEVE : "Certo, mantenho a sua proposta anterior.", ressalva ?? ""].filter(Boolean).join(" "), { ...ctx, tipo: "resposta" });
        if (noDesconto) await encerrarSeTodosResponderam(l.item.id);
        await despacharPerguntas(contatoId);
        return;
      }
      await db.update(cotacao).set({ situacao: "encerrada", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
      await registrar(db, { agente: "Extrator", acao: "O fornecedor não atende este pedido.", motivo: entrada.texto.slice(0, 200), ...ctx, fornecedorIds: [c.fornecedorId] });
      await enviar(contatoId, "Obrigado por avisar!", ctx);
      // R14b: cotação com prioridade: o motivo vai ao comprador.
      await repassarMotivoAoComprador(c, entrada.texto);
      await encerrarSeTodosResponderam(l.item.id);
      await despacharPerguntas(contatoId);
      return;
    case "responsavel":
    case "suspeita":
    case "ofensa":
    case "fora_do_assunto": {
      // I1: "vou ver com o gerente e te retorno" com o pedido de desconto aberto não é pedido de
      // falar com uma pessoa: o fornecedor vai responder depois e a janela continua aberta.
      const marca = e.classificacao === "responsavel" && temPropostaAnterior ? marcaDe(anterior!.extraido) : null;
      if (marca && !marca.respondidaEm && vaiResponderDepois(entrada.texto)) {
        await registrar(db, { agente: "Negociador", acao: "O fornecedor vai responder o desconto depois.", motivo: entrada.texto.slice(0, 200), ...ctx, fornecedorIds: [c.fornecedorId] });
        return;
      }
      await situacaoDelicada(e.classificacao, c.fornecedorId, contatoId, entrada.texto, l, ctx);
      return;
    }
    default: {
      // Resposta sem preço de quem já tem proposta ("não consigo desconto"): a proposta segue valendo.
      if (temPropostaAnterior) {
        const marca = marcaDe(anterior!.extraido);
        // I1: "vou ver com o gerente" no meio do pedido de desconto: sem resposta, a janela continua aberta.
        if (marca && !marca.respondidaEm && !ressalva && vaiResponderDepois(entrada.texto)) {
          await registrar(db, { agente: "Negociador", acao: "O fornecedor vai responder o desconto depois.", motivo: entrada.texto.slice(0, 200), ...ctx, fornecedorIds: [c.fornecedorId] });
          return;
        }
        const noDesconto = await manteveNoDesconto(anterior!, entrada.texto, qtd, c.fornecedorId, ctx);
        await enviar(contatoId, [noDesconto ? TEXTO_MANTEVE : "Certo, mantenho a sua proposta anterior.", ressalva ?? ""].filter(Boolean).join(" "), { ...ctx, tipo: "resposta" });
        if (noDesconto) await encerrarSeTodosResponderam(l.item.id);
        await despacharPerguntas(contatoId);
        return;
      }
      // R14b: na cotação com prioridade, a explicação de quem ainda não cotou vai ao comprador.
      if (!ressalva && c.situacao === "aguardando" && (await repassarMotivoAoComprador(c, entrada.texto))) {
        const ate = l.item.prazoRespostasEm ? ` até ${quando(l.item.prazoRespostasEm).replace(/^(às|em) /, "")}` : "";
        await enviar(contatoId, `Obrigado por explicar, repassei ao comprador. Se conseguir mandar uma proposta (preço, frete e prazo), ainda dá tempo${ate}.`, { ...ctx, tipo: "resposta" });
        return;
      }
      await enviar(contatoId, ressalva ?? "Não encontrei preço na sua mensagem. Pode mandar o preço unitário, o frete e o prazo de entrega?", ctx);
    }
  }
}

/**
 * R3b: o fornecedor mandou proposta nova com produto ou frete mais caros que a anterior.
 * A proposta nova vale (é a mais recente) e entra no mapa; o comprador é avisado, e a
 * mudança só vale se ele aprovar essa proposta no mapa. O agente nunca aceita sozinho.
 */
async function avisarAumento(
  anterior: typeof oferta.$inferSelect,
  depois: CondicaoProposta,
  qtd: number,
  fornecedorId: string,
  l: { item: typeof itemPedido.$inferSelect; pedido: typeof pedido.$inferSelect },
  ctx: { pedidoId: number; itemPedidoId: number },
) {
  const antes = condicaoDaOferta(anterior);
  const pa = produtoDe(antes, qtd);
  const pd = produtoDe(depois, qtd);
  const mudancas: string[] = [];
  if (pa !== null && pd !== null && pd - pa >= 0.01) mudancas.push(`produto de ${formatarBRL(pa)} para ${formatarBRL(pd)}`);
  if (antes.frete !== null && depois.frete !== null && depois.frete - antes.frete >= 0.01) mudancas.push(`frete de ${formatarBRL(antes.frete)} para ${formatarBRL(depois.frete)}`);
  if (!mudancas.length) return null;
  const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  const nome = f?.nome ?? "Um fornecedor";
  await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: ${nome} mudou a proposta de ${l.item.descricao}: ${mudancas.join(" e ")}. O valor novo vai para o mapa; só vale se você aprovar essa proposta.`, { ...ctx, tipo: "aviso" });
  await registrar(db, {
    agente: "Cotador",
    acao: `${nome} aumentou a proposta: ${mudancas.join(" e ")}.`,
    motivo: "R3b: alteração de valor vai para o mapa e é confirmada pelo comprador; o agente não aceita sozinho.",
    ...ctx,
    fornecedorIds: [fornecedorId],
    dados: { tipo: "alteracao_valor", antes, depois },
  });
  return mudancas.join(" e ");
}

/** Troca o `extraido` da oferta (a marca do desconto ou da pergunta mora nele). */
async function gravarExtraido(ofertaId: string, extraido: Record<string, unknown>) {
  await db.update(oferta).set({ extraido }).where(eq(oferta.id, ofertaId));
}

/** I1: "não consigo", "já está no limite" com pedido de desconto aberto: fecha a marca como "manteve". */
async function manteveNoDesconto(
  anterior: typeof oferta.$inferSelect,
  texto: string,
  qtd: number,
  fornecedorId: string,
  ctx: { pedidoId: number; itemPedidoId: number },
): Promise<boolean> {
  const marca = marcaDe(anterior.extraido);
  if (!marca || marca.respondidaEm) return false;
  const fechada = resultadoNegociacao(marca, condicaoDaOferta(anterior), qtd, { firme: mantemFirme(texto) });
  await gravarExtraido(anterior.id, { ...(anterior.extraido as Record<string, unknown>), negociacao: fechada });
  await registrarResultado(fechada, fornecedorId, ctx);
  return true;
}

/** Registro do Negociador por resposta ao pedido de desconto (é o que o harness lê para as métricas). */
export async function registrarResultado(m: MarcaNegociacao, fornecedorId: string, ctx: { pedidoId: number; itemPedidoId: number }) {
  const de = m.produtoAntes ?? null;
  const para = m.produtoDepois ?? null;
  const valores = de !== null && para !== null ? ` de ${formatarBRL(de)} para ${formatarBRL(para)}` : "";
  const acao = {
    desconto: `Desconto obtido: o produto foi${valores}${m.descontoFrete && m.descontoFrete > 0 ? ` e o frete baixou ${formatarBRL(m.descontoFrete)}` : ""}.`,
    manteve: m.firme ? "O fornecedor manteve a proposta e disse que o preço está no limite." : "O fornecedor manteve a proposta.",
    subiu: `O preço subiu depois do pedido de desconto${valores}.`,
    condicional: `O fornecedor ofereceu desconto condicionado (não aplicado): ${m.condicao ?? ""}.`,
    sem_resposta: "O fornecedor não respondeu ao pedido de desconto.",
  }[m.resultado ?? "manteve"];
  await registrar(db, {
    agente: "Negociador",
    acao,
    motivo: "Resposta ao pedido automático de desconto; a conta é feita em código.",
    ...ctx,
    fornecedorIds: [fornecedorId],
    dados: { antes: m.antes, depois: m.depois, descontoProduto: m.descontoProduto, descontoFrete: m.descontoFrete, resultado: m.resultado, condicao: m.condicao ?? null },
  });
}

export const RESSALVA: Record<AlertaFornecedor, string> = {
  sem_nota: "Só compramos com nota fiscal. Pode mandar o preço com nota?",
  item_irregular: "Só compramos produto original, com nota e procedência.",
  propina: "Não aceitamos comissão nem vantagem. A escolha segue o mapa de cotação.",
  combinacao_preco: "Não passo valores de outros fornecedores. Mande sua melhor proposta.",
  // R13: o padrão é à vista, no recebimento; nada é pago antes nem fora do CNPJ da proposta.
  pagamento_por_fora: `O pagamento é feito só para a empresa do CNPJ da proposta, ${PAGAMENTO_PADRAO}.`,
  pede_dados: `Não passo dados pessoais, senhas nem códigos. Os dados da empresa são ${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj}).`,
  produto_controlado: "Por aqui eu só trato da cotação pedida. Se tiver proposta ou dúvida sobre ela, é só mandar.",
  link_suspeito: "Não abro links nem arquivos desconhecidos. Pode mandar a proposta em texto ou PDF?",
};
/** A ressalva do alerta; a de pagamento por fora cita a forma do comprador, se ele pediu uma (R13). */
export function ressalvaDe(a: AlertaFornecedor, pagamentoPreferido?: string | null): string {
  if (a === "pagamento_por_fora" && pagamentoPreferido?.trim()) return `O pagamento é feito só para a empresa do CNPJ da proposta, ${pagamentoPreferido.trim()}.`;
  return RESSALVA[a];
}
/** Alertas que impedem a proposta de entrar: o preço não vira proposta limpa. */
export const ALERTAS_BLOQUEANTES: AlertaFornecedor[] = ["sem_nota", "item_irregular", "produto_controlado"];
export const AVISO_COMPRADOR: Record<AlertaFornecedor, string | null> = {
  sem_nota: "ofereceu preço sem nota fiscal. Não registrei como proposta; pedi o preço com nota.",
  item_irregular: "ofereceu produto irregular (réplica, paralelo ou sem procedência). A oferta não entra no mapa.",
  propina: "ofereceu comissão ou vantagem. A proposta fica, marcada; não aceitei nada.",
  combinacao_preco: "tentou saber o preço de concorrentes ou combinar preço. Não passei nada.",
  pagamento_por_fora: "pediu pagamento fora do padrão (conta pessoal, link ou cripto). Respondi que o pagamento é só para o CNPJ da proposta.",
  pede_dados: "pediu dados pessoais ou sigilosos. Não passei nada; pode ser golpe.",
  produto_controlado: null,
  link_suspeito: null,
};
export const AVISO_GESTOR: AlertaFornecedor[] = ["propina", "combinacao_preco", "produto_controlado"];

/**
 * Guardrails do fornecedor: registra e avisa o comprador; nos alertas graves, avisa o gestor
 * por `avisarGestor` (gestores pelo papel, modo demo e um aviso por 24 h ficam lá).
 * Devolve "bloqueada" quando a resposta já foi dada e a proposta não pode entrar, ou a ressalva
 * para ir junto da resposta normal (undefined se não há alerta).
 */
async function tratarAlertas(
  alertas: AlertaFornecedor[],
  c: typeof cotacao.$inferSelect,
  contatoId: string,
  l: { item: typeof itemPedido.$inferSelect; pedido: typeof pedido.$inferSelect },
  ctx: { pedidoId: number; itemPedidoId: number },
  texto: string,
): Promise<string | undefined | "bloqueada"> {
  if (!alertas.length) return undefined;
  const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, c.fornecedorId));
  const nome = f?.nome ?? "O fornecedor";
  for (const a of alertas) {
    await registrar(db, {
      agente: "Extrator",
      acao: `Alerta na resposta do fornecedor: ${a}.`,
      motivo: "Sinal de risco na mensagem; ver a ação tomada na resposta.",
      ...ctx,
      fornecedorIds: [c.fornecedorId],
      dados: { alerta: a, texto: texto.slice(0, 300) },
    });
    const aviso = AVISO_COMPRADOR[a];
    if (aviso) await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: ${nome} ${aviso}`, { ...ctx, tipo: "aviso" });
    if (AVISO_GESTOR.includes(a)) {
      await avisarGestor({
        chave: `fornecedor:${a}:${c.fornecedorId}:${ctx.itemPedidoId}`,
        texto: `Pedido ${l.pedido.id}: ${nome} — alerta ${a}. Mensagem: "${texto.slice(0, 200)}"`,
        contatoId: l.pedido.compradorId,
        ...ctx,
      });
    }
  }
  const bloqueante = alertas.find((a) => ALERTAS_BLOQUEANTES.includes(a));
  if (bloqueante) {
    await enviar(contatoId, ressalvaDe(bloqueante, l.pedido.pagamentoPreferido), { ...ctx, tipo: "resposta" });
    return "bloqueada";
  }
  return alertas.map((a) => ressalvaDe(a, l.pedido.pagamentoPreferido)).join(" ");
}

/** Pergunta única ao fornecedor sobre o que ficou a confirmar (preço unitário ou total; item que diverge). */
export function perguntaDeConfirmacao(e: Extracao, item: { id: number; descricao: string; unidade: string; quantidade: string | number }): string {
  const partes: string[] = [];
  if (e.aConfirmar?.includes("preco")) {
    const valor = e.precoUnitario ?? e.totalProduto;
    partes.push(`o valor de R$ ${String(valor).replace(".", ",")} é o preço por ${item.unidade} ou o total das ${Number(item.quantidade)} ${item.unidade}?`);
  }
  if (e.aConfirmar?.includes("item")) {
    partes.push(
      `o item oferecido${e.itemOferecido ? ` (${e.itemOferecido})` : ""} atende ao pedido de ${item.descricao}?${e.divergencias.length ? ` Pontos a conferir: ${e.divergencias.join("; ")}.` : ""}`,
    );
  }
  const [primeira, ...resto] = partes;
  const texto = [primeira ? primeira[0]!.toUpperCase() + primeira.slice(1) : "", ...resto.map((r) => `Também: ${r}`)].join(" ");
  return `Para fechar a leitura da cotação ${item.id}: ${texto}`;
}

const numOuNull = (v: string | null) => (v === null ? null : Number(v));

/**
 * Junta a extração nova com a proposta anterior do mesmo fornecedor. null se a mensagem não traz nada de proposta.
 * I1: desconto sem preço novo ("faço 5% a menos", "tiro R$ 20") é aplicado aqui, em código, só se for
 * incondicional; a marca do pedido de desconto (`extraido.negociacao`) vai junto.
 */
export function completarComAnterior(
  e: Extracao,
  a: typeof oferta.$inferSelect,
  contexto: { quantidade?: number; condicional?: boolean; porUnidade?: boolean } = {},
): (Extracao & { negociacao?: MarcaNegociacao }) | null {
  const temDesconto = e.descontoPercentual !== null || e.descontoValor !== null;
  const trazAlgo = temDesconto || [e.precoUnitario, e.totalProduto, e.frete, e.prazoDias, e.validadeDias, e.pagamento, e.prazoPagamentoDias, e.impostosValor, e.impostosNaoInclusos, e.entregaNoLocal].some((v) => v !== null);
  if (!trazAlgo) return null;
  const novoPreco = e.precoUnitario !== null || e.totalProduto !== null;
  let precoUnitario = novoPreco ? e.precoUnitario : numOuNull(a.precoUnitario);
  let totalProduto = novoPreco ? e.totalProduto : numOuNull(a.totalProduto);
  if (!novoPreco && temDesconto && !contexto.condicional) {
    const aplicado = aplicarDesconto({ precoUnitario, totalProduto }, e, contexto.quantidade ?? null, contexto.porUnidade);
    if (aplicado) ({ precoUnitario, totalProduto } = aplicado);
  }
  const marca = marcaDe(a.extraido);
  return {
    ...e,
    ...(marca ? { negociacao: marca } : {}),
    classificacao: "proposta",
    itemOferecido: e.itemOferecido ?? a.itemOferecido,
    itemExato: novoPreco ? e.itemExato : a.itemExato,
    precoUnitario,
    totalProduto,
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
    suspeita: `Entendo a cautela. Sou um assistente automatizado da ${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj}) e estou pedindo uma cotação sem compromisso de ${item}. Não peço pagamento nem dados bancários. Se preferir, o comprador fala com você. Para não receber mais mensagens, escreva ENCERRAR CONTATO.`,
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

// ---------- I1: resposta ao desconto depois do fechamento ----------

/** Estados em que o comprador ainda não decidiu: o desconto tardio ainda entra no mapa. */
const ESTADOS_MAPA_ABERTO = ["cotando", "comparando", "aguardando_decisao"];

/**
 * O fornecedor respondeu ao pedido automático de desconto depois de a cotação fechar
 * (a janela venceu e a marca ficou "sem_resposta", ou nem chegou a ser fechada).
 * - Mapa aberto (o comprador não decidiu): o desconto entra na proposta, com antes e
 *   depois em `oferta.extraido.negociacao` (marca `tardia`), e o mapa é refeito pelo
 *   mecanismo de sempre ("reavaliar", que o Comparador anuncia como "Mapa refeito").
 *   Preço que subiu não é aplicado: a cotação já fechou para propostas novas.
 * - Compra decidida: agradece sem aplicar nada, e avisa o comprador se o desconto veio
 *   do fornecedor escolhido (pode valer conversar antes de pagar).
 * Devolve false quando a mensagem não é resposta a um desconto (segue o fluxo de antes).
 */
async function respostaTardiaAoDesconto(contatoId: string, fornecedorId: string, mensagemId: string, texto: string): Promise<boolean> {
  if (!texto) return false;
  const [l] = await db
    .select({ oferta, item: itemPedido, pedido })
    .from(oferta)
    .innerJoin(itemPedido, eq(itemPedido.id, oferta.itemPedidoId))
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(
      and(
        eq(oferta.fornecedorId, fornecedorId),
        gte(oferta.criadoEm, new Date(Date.now() - 48 * 3600_000)),
        sql`${oferta.extraido}->'negociacao'->>'pedidaEm' is not null`,
        sql`(${oferta.extraido}->'negociacao'->>'respondidaEm' is null or ${oferta.extraido}->'negociacao'->>'resultado' = 'sem_resposta')`,
      ),
    )
    .orderBy(desc(sql`${oferta.extraido}->'negociacao'->>'pedidaEm'`))
    .limit(1);
  const marca = marcaDe(l?.oferta.extraido);
  if (!l || !marca) return false;
  const ctx = { pedidoId: l.pedido.id, itemPedidoId: l.item.id };
  const qtd = Number(l.item.quantidade);

  let e: Extracao;
  try {
    e = (
      await extrair(
        { descricao: l.item.descricao, quantidade: qtd, unidade: l.item.unidade, aceitaSimilar: l.item.aceitaSimilar, destino: l.pedido.destino, modoEntrega: l.pedido.modoEntrega },
        { texto },
        ctx,
        CONTEXTO_DESCONTO,
      )
    ).valor;
  } catch (erro) {
    console.error("[fornecedor] desconto tardio", erro);
    return false;
  }
  return aplicarDescontoTardio(e, { contatoId, fornecedorId, mensagemId, texto, oferta: l.oferta, item: l.item, pedido: l.pedido, marca });
}

/**
 * Parte de respostaTardiaAoDesconto depois da leitura (sem IA; separada para os testes).
 * Devolve false quando a leitura não é resposta ao desconto.
 */
export async function aplicarDescontoTardio(
  e: Extracao,
  p: {
    contatoId: string;
    fornecedorId: string;
    mensagemId: string | null;
    texto: string;
    oferta: typeof oferta.$inferSelect;
    item: typeof itemPedido.$inferSelect;
    pedido: typeof pedido.$inferSelect;
    marca: MarcaNegociacao;
  },
): Promise<boolean> {
  const { contatoId, fornecedorId, texto, marca } = p;
  const l = { item: p.item, pedido: p.pedido };
  // Recusa do item, dúvida, PARAR, conversa delicada: não é resposta ao desconto.
  if (!["proposta", "outro", "recusa"].includes(e.classificacao)) return false;
  const ctx = { pedidoId: p.pedido.id, itemPedidoId: p.item.id };
  if (p.mensagemId) await vincularMensagem(p.mensagemId, ctx);
  const qtd = Number(p.item.quantidade);
  const aberto = ESTADOS_MAPA_ABERTO.includes(p.item.estado);

  if (e.alertas.length) {
    const [c] = p.oferta.cotacaoId ? await db.select().from(cotacao).where(eq(cotacao.id, p.oferta.cotacaoId)) : [];
    const ressalva = c ? await tratarAlertas(e.alertas, c, contatoId, l, ctx, texto) : undefined;
    if (ressalva !== "bloqueada") await enviar(contatoId, ressalva || "Obrigado pelo retorno. Repasso ao comprador.", { ...ctx, tipo: "resposta" });
    return true;
  }

  const condicao = condicaoDoDesconto(e, texto);
  const completa = completarComAnterior(e, p.oferta, { quantidade: qtd, condicional: !!condicao, porUnidade: descontoPorUnidade(texto) });
  // "Vou ver com o gerente": nada a registrar ainda.
  if (!completa && vaiResponderDepois(texto)) {
    await enviar(
      contatoId,
      aberto
        ? `Sem problema! O comprador ainda está decidindo a cotação ${p.item.id}; se conseguir uma condição melhor, mande por aqui.`
        : `Obrigado! O comprador já decidiu a compra da cotação ${p.item.id}, então não precisa se preocupar com esta. Conto com vocês nas próximas.`,
      { ...ctx, tipo: "resposta" },
    );
    return true;
  }
  const precoAConfirmar = !!completa?.aConfirmar?.includes("preco");
  const depois: CondicaoProposta =
    completa && !precoAConfirmar
      ? { precoUnitario: completa.precoUnitario, totalProduto: completa.totalProduto, frete: completa.frete, prazoDias: completa.prazoDias, pagamento: completa.pagamento, prazoPagamentoDias: completa.prazoPagamentoDias, impostosValor: completa.impostosValor }
      : condicaoDaOferta(p.oferta);
  const { resultado: _resultado, respondidaEm: _respondidaEm, ...base } = marca;
  const fechada: MarcaNegociacao = { ...resultadoNegociacao(base, depois, qtd, { condicao, firme: mantemFirme(texto) }), tardia: true };
  const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  const nome = f?.nome ?? "O fornecedor";
  const deuAlgo = fechada.resultado === "desconto" || fechada.resultado === "condicional";

  if (!aberto) {
    // Compra decidida: nada muda na proposta; fica o registro.
    await registrar(db, {
      agente: "Negociador",
      acao: `${nome} respondeu ao pedido de desconto depois de a compra ser decidida (${fechada.resultado}).`,
      motivo: texto.slice(0, 200),
      ...ctx,
      fornecedorIds: [fornecedorId],
      dados: { tardia: true, resultado: fechada.resultado, antes: fechada.antes, depois: fechada.depois, condicao: fechada.condicao ?? null },
    });
    const escolhido = p.item.fornecedorEscolhidoId === fornecedorId;
    if (escolhido && deuAlgo) {
      await enviar(
        p.pedido.compradorId,
        `Pedido ${p.pedido.id}: ${nome}, que você escolheu, ofereceu desconto depois de a compra ser decidida: "${texto.slice(0, 200)}". O pedido de compra seguiu com o valor da proposta; se quiser, fale com ele.`,
        { ...ctx, tipo: "aviso" },
      );
    }
    await enviar(
      contatoId,
      deuAlgo
        ? `Obrigado pelo retorno e pela condição! A compra da cotação ${p.item.id} já foi decidida, então desta vez não consigo incluir o desconto.${escolhido ? " Repassei ao comprador." : ""} Conto com vocês nas próximas cotações.`
        : `Obrigado pelo retorno! A compra da cotação ${p.item.id} já foi decidida. Conto com vocês nas próximas cotações.`,
      { ...ctx, tipo: "resposta" },
    );
    return true;
  }

  // Mapa aberto. Preço ambíguo ou maior: não aplica, repassa ao comprador.
  if (precoAConfirmar || fechada.resultado === "subiu") {
    await registrar(db, {
      agente: "Negociador",
      acao: `${nome} respondeu ao pedido de desconto depois do fechamento, sem desconto aplicável.`,
      motivo: precoAConfirmar ? "Preço ambíguo (unitário ou total) numa resposta tardia; não foi aplicado." : "O preço novo é maior; a cotação já fechou para propostas novas.",
      ...ctx,
      fornecedorIds: [fornecedorId],
      dados: { tardia: true, texto: texto.slice(0, 500) },
    });
    await enviar(p.pedido.compradorId, `Pedido ${p.pedido.id}: ${nome} respondeu ao pedido de desconto depois do fechamento: "${texto.slice(0, 200)}". Mantive a proposta anterior no mapa.`, { ...ctx, tipo: "aviso" });
    await enviar(contatoId, `Obrigado pelo retorno! As propostas da cotação ${p.item.id} já fecharam, então mantive a sua proposta anterior e repassei a mensagem ao comprador.`, { ...ctx, tipo: "resposta" });
    return true;
  }

  const pagamento =
    condicao && !depois.pagamento?.includes("não aplicado") ? `${depois.pagamento ? `${depois.pagamento}; ` : ""}desconto condicionado: "${condicao}" (não aplicado ao total)` : depois.pagamento;
  const extraido = { ...(p.oferta.extraido as Record<string, unknown>), negociacao: fechada };
  const txt = (v: number | null) => (v === null ? null : v.toString());
  await db
    .update(oferta)
    .set(
      fechada.resultado === "desconto"
        ? { precoUnitario: txt(depois.precoUnitario), totalProduto: txt(depois.totalProduto), frete: txt(depois.frete), pagamento, prazoPagamentoDias: depois.prazoPagamentoDias, extraido }
        : { pagamento, extraido },
    )
    .where(eq(oferta.id, p.oferta.id));
  await registrarResultado(fechada, fornecedorId, ctx);

  if (fechada.resultado === "desconto") {
    await enviar(contatoId, `Obrigado pelo desconto! Registrei na sua proposta da cotação ${p.item.id}; o comprador ainda está decidindo e vai ver o valor novo.`, { ...ctx, tipo: "resposta" });
    // Mapa já mostrado: refaz pelo caminho de sempre. Em "comparando" o mapa está sendo montado
    // agora e pode não pegar o valor novo (janela de segundos; fica para quando o Comparador
    // tiver um "refazer se mudou").
    if (p.item.estado === "aguardando_decisao") {
      await avancarItem(p.item.id, "reavaliar", {
        agente: "Negociador",
        acao: `${nome} deu desconto depois do fechamento.`,
        motivo: `Resposta tardia ao pedido de desconto: o produto foi de ${formatarBRL(fechada.produtoAntes ?? 0)} para ${formatarBRL(fechada.produtoDepois ?? 0)}. O mapa é refeito.`,
        fornecedorIds: [fornecedorId],
      }).catch((erro) => {
        if (!(erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente)) throw erro;
      });
    }
  } else if (fechada.resultado === "condicional") {
    await enviar(p.pedido.compradorId, `Pedido ${p.pedido.id}: ${nome} respondeu ao pedido de desconto depois do fechamento com um desconto condicionado (não aplicado ao total): ${condicao}.`, { ...ctx, tipo: "aviso" });
    await enviar(contatoId, `Obrigado! Anotei a condição (${condicao}) na sua proposta da cotação ${p.item.id} e repassei ao comprador.`, { ...ctx, tipo: "resposta" });
  } else {
    await enviar(contatoId, TEXTO_MANTEVE, { ...ctx, tipo: "resposta" });
  }
  return true;
}

/** Contexto do Extrator quando a mensagem responde ao pedido de desconto (sem valores: a conta é do código). */
const CONTEXTO_DESCONTO =
  "Pedi desconto sobre a proposta que ele já mandou (\"Por gentileza, conseguiria desconto na cotação?\"). Se ele der um percentual ou valor de desconto sem preço novo, preencha descontoPercentual ou descontoValor e deixe o preço null; \"não consigo\" ou \"mantenho\" é classificacao outro.";

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

// ---------- PARAR numa cotação (Liria, erros_chat.md) ----------

export const TEXTO_SAIU_DA_COTACAO =
  "Certo, você saiu desta cotação e não recebe mais mensagens sobre ela. As próximas cotações continuam chegando por aqui; para não receber mais nenhuma, escreva ENCERRAR CONTATO.";

/**
 * PARAR de fornecedor com cotação aberta: sai só das cotações em andamento (situação "desistiu",
 * fora do mapa) e continua recebendo as próximas. Sem cotação aberta, devolve false e o PARAR
 * vale para tudo, como antes. "Encerrar contato" sai de vez (nucleo/mensagens).
 */
export async function sairDasCotacoesAbertas(c: Contato, mensagemId: string): Promise<boolean> {
  if (!c.fornecedorId) return false;
  const abertas = await db
    .select({ id: cotacao.id, itemPedidoId: cotacao.itemPedidoId, pedidoId: itemPedido.pedidoId })
    .from(cotacao)
    .innerJoin(itemPedido, and(eq(itemPedido.id, cotacao.itemPedidoId), eq(itemPedido.rodada, cotacao.rodada)))
    .where(and(eq(cotacao.fornecedorId, c.fornecedorId), inArray(cotacao.situacao, ["aguardando", "respondeu"]), inArray(itemPedido.estado, ["cotando", "comparando", "aguardando_decisao"])));
  if (!abertas.length) return false;
  await db.update(cotacao).set({ situacao: "desistiu" }).where(inArray(cotacao.id, abertas.map((a) => a.id)));
  await vincularMensagem(mensagemId, { itemPedidoId: abertas[0]!.itemPedidoId });
  for (const a of abertas) {
    await registrar(db, {
      agente: "Fornecedor",
      acao: "Saiu desta cotação (PARAR).",
      motivo: "Respondeu PARAR com a cotação aberta: sai só dela e continua recebendo as próximas.",
      pedidoId: a.pedidoId,
      itemPedidoId: a.itemPedidoId,
      fornecedorIds: [c.fornecedorId],
    });
  }
  await enviar(c.id, TEXTO_SAIU_DA_COTACAO, { itemPedidoId: abertas[0]!.itemPedidoId, tipo: "resposta" });
  for (const id of new Set(abertas.map((a) => a.itemPedidoId))) await encerrarSeTodosResponderam(id);
  return true;
}

let saidaLigada = false;
/** Chamado por ligarFluxos(). */
export function ligarSaidaDaCotacao() {
  if (saidaLigada) return;
  saidaLigada = true;
  aoPararNaCotacao(sairDasCotacoesAbertas);
}
