// Conversa com o comprador: abre o pedido, chama o Interpretador, pergunta
// "Entendi assim, confirma?" e trata confirmação, correção e cancelamento.
// Áudio, foto, print de loja e PDF viram texto antes (R1b), em lerAnexos.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { lerAnexoDoComprador, textoDoPedidoComAnexo, type LeituraAnexo } from "../agentes/interpretador/anexos.ts";
import { chaveDoItem, interpretar, type Interpretacao } from "../agentes/interpretador/index.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato as tContato, itemPedido, pedido } from "../nucleo/db/schema.ts";
import type { AnexoIa } from "../nucleo/ia/index.ts";
import { baixarAnexo, enviar, vincularMensagem, type Anexo, type Botao, type Canal, type MensagemRecebida } from "../nucleo/mensagens/index.ts";
import {
  abrirPedido,
  avancarPedido,
  definirItens,
  TransicaoConcorrente,
  TransicaoInvalida,
} from "../nucleo/orquestrador/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { EMPRESA } from "../config.ts";
import { aoBotaoDoComprador } from "./decisao.ts";
import { dias, fmtNumero, quantidade } from "../texto.ts";

export const TEXTO_BOAS_VINDAS =
  "Olá! Sou o assistente de cotações. Mande o que precisa comprar, do seu jeito, por exemplo: " +
  "\"40 sacos de cp2 e 2 carradas de areia média para a Obra Alfa até sexta\". " +
  "Eu entendo o pedido, confirmo com você e busco fornecedores.";

export const AVISO_PRIVACIDADE =
  "Aviso: sou um assistente automatizado. Guardo as mensagens desta conversa para cotar seus pedidos. " +
  "Não mande dados pessoais que não sejam necessários. Para não receber mais mensagens, escreva PARAR.";

const TEXTO_FALHA_IA = "Não consegui ler seu pedido agora. Pode mandar de novo em instantes?";

export { plural } from "../texto.ts";
const quantidadeTexto = quantidade;

const CONFIRMACAO = /^(sim|ok|okay|confirm[oa]|confirmado|pode( seguir| cotar)?|isso|certo|fechado|beleza|blz|manda)[!.\s]*$/i;
const SAUDACAO = /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem\??|obrigad[oa]|valeu|ok|blz|beleza)[!.\s]*$/i;

// ---------- Botões ----------

type Acao = "confirmar" | "corrigir" | "cancelar";
const dadoBotao = (pedidoId: number, acao: Acao) => `pedido:${pedidoId}:${acao}`;

function lerBotao(dado: string): { pedidoId: number; acao: Acao } | null {
  const m = /^pedido:(\d+):(confirmar|corrigir|cancelar)$/.exec(dado);
  return m ? { pedidoId: Number(m[1]), acao: m[2] as Acao } : null;
}

// ---------- Texto da confirmação ----------

type ItemResumo = { descricao: string; quantidade: string | number; unidade: string; aceitaSimilar: boolean };

export function textoConfirmacao(p: {
  id: number;
  itens: ItemResumo[];
  destino: string | null;
  cep?: string | null;
  prazoTexto: string | null;
  prazoMaxDias: number | null;
  urgencia: "normal" | "urgente" | "obra_parada";
  modoEntrega: "entrega" | "retirada" | null;
  janelaRecebimento: string | null;
  suposicoes: string[];
  perguntas: string[];
}): string {
  const linhas = [`Pedido ${p.id}. Entendi assim:`, ""];
  p.itens.forEach((it, i) => {
    const qtd = Number(it.quantidade) > 0 ? quantidadeTexto(it.quantidade, it.unidade) : `? ${it.unidade}`;
    linhas.push(`${i + 1}. ${qtd} de ${it.descricao}${it.aceitaSimilar ? " (aceita similar)" : ""}`);
  });
  linhas.push("");
  const entrega = p.modoEntrega === "retirada" ? "Retirada na loja" : `Entrega: ${p.destino ?? "não informado"}${p.cep ? `, CEP ${p.cep}` : ""}`;
  linhas.push(entrega);
  if (p.janelaRecebimento) linhas.push(`Recebe: ${p.janelaRecebimento}`);
  const prazo = p.prazoTexto
    ? `${p.prazoTexto}${p.prazoMaxDias !== null ? ` (${dias(p.prazoMaxDias)})` : ""}`
    : "não informado";
  linhas.push(`Prazo: ${prazo}`);
  if (p.urgencia === "obra_parada") linhas.push("Obra parada: o prazo pesa mais que o preço.");
  else if (p.urgencia === "urgente") linhas.push("Urgente.");
  if (p.suposicoes.length) {
    linhas.push("", "Considerei:");
    for (const s of p.suposicoes) linhas.push(`- ${s}`);
  }
  if (p.itens.length > 1) linhas.push("", "Vou cotar um item por vez, nesta ordem.");
  if (p.perguntas.length) {
    linhas.push("", "Antes de cotar, me diga:");
    for (const q of p.perguntas) linhas.push(`- ${q}`);
    linhas.push("", "Responda aqui ou confirme assim mesmo.");
  } else {
    linhas.push("", "Confirma?");
  }
  return linhas.join("\n");
}

function botoesConfirmacao(pedidoId: number, comPerguntas: boolean): Botao[] {
  return [
    { rotulo: comPerguntas ? "Confirmar assim" : "Confirmar", dado: dadoBotao(pedidoId, "confirmar") },
    { rotulo: "Corrigir", dado: dadoBotao(pedidoId, "corrigir") },
    { rotulo: "Cancelar", dado: dadoBotao(pedidoId, "cancelar") },
  ];
}

// ---------- Interpretar e responder ----------

export async function interpretarEResponder(pedidoId: number) {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
  if (!p) return;

  let r: Awaited<ReturnType<typeof interpretar>>;
  try {
    r = await interpretar({ textoOriginal: p.textoOriginal, correcoes: p.correcoes }, { pedidoId });
  } catch (erro) {
    await registrar(db, {
      agente: "Interpretador",
      acao: "Não conseguiu ler o pedido.",
      motivo: erro instanceof Error ? erro.message : String(erro),
      pedidoId,
    });
    await enviar(p.compradorId, TEXTO_FALHA_IA, { pedidoId });
    return;
  }

  const i: Interpretacao = r.valor;
  // Sem destino: usa o endereço padrão da empresa, em vez de perguntar.
  if (i.ehPedido && i.modoEntrega !== "retirada" && !i.destino) {
    i.destino = EMPRESA.enderecoEntrega;
    i.cep = EMPRESA.cep;
    i.suposicoes = [...i.suposicoes, "Entrega no endereço padrão da empresa"];
    i.faltando = i.faltando.filter((f) => !/destino|endere[cç]o|entreg|onde|local|cep/i.test(f));
  }
  if (!i.ehPedido) {
    await avancarPedido(pedidoId, "cancelar", {
      agente: "Interpretador",
      motivo: "A mensagem não tinha pedido de material.",
    }).catch(ignorarCorrida);
    await enviar(p.compradorId, TEXTO_BOAS_VINDAS);
    return;
  }

  const perguntar = i.faltando.length > 0 && p.perguntasFeitas === 0;
  const itens = await definirItens(
    db,
    pedidoId,
    i.itens.map((it) => ({
      descricao: it.descricao,
      quantidade: it.quantidade,
      unidade: it.unidade,
      itemChave: chaveDoItem(it.descricao),
      especificacao: Object.fromEntries(it.especificacao.map((e) => [e.nome, e.valor])),
      aceitaSimilar: it.aceitaSimilar ?? false,
    })),
  );

  const alteracoes = {
    destino: i.destino,
    cep: i.cep,
    modoEntrega: i.modoEntrega,
    janelaRecebimento: i.janelaRecebimento,
    prazoTexto: i.prazoTexto,
    prazoMaxDias: i.prazoDias,
    urgencia: i.urgencia,
    faltando: i.faltando,
    suposicoes: i.suposicoes,
    perguntasFeitas: p.perguntasFeitas + (perguntar ? 1 : 0),
  };
  try {
    await avancarPedido(
      pedidoId,
      "interpretado",
      {
        agente: "Interpretador",
        acao: `Leu ${itens.length} ${itens.length === 1 ? "item" : "itens"}: ${i.itens.map((it) => it.descricao).join(", ")}.`,
        motivo: i.suposicoes.length ? `Assumiu: ${i.suposicoes.join("; ")}.` : "Tudo veio na mensagem do comprador.",
        dados: { interpretacao: i, modelo: r.modelo, rota: r.rota, caiuNaReserva: r.caiuNaReserva },
      },
      alteracoes,
    );
  } catch (erro) {
    ignorarCorrida(erro);
    return;
  }

  const texto = textoConfirmacao({
    id: pedidoId,
    itens: itens.map((it) => ({ ...it })),
    destino: i.destino,
    cep: i.cep,
    prazoTexto: i.prazoTexto,
    prazoMaxDias: i.prazoDias,
    urgencia: i.urgencia,
    modoEntrega: i.modoEntrega,
    janelaRecebimento: i.janelaRecebimento,
    suposicoes: i.suposicoes,
    perguntas: perguntar ? i.faltando : [],
  });
  await enviar(p.compradorId, texto, { pedidoId, botoes: botoesConfirmacao(pedidoId, perguntar) });
}

function ignorarCorrida(erro: unknown) {
  if (erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente) return;
  throw erro;
}

// ---------- Ações do comprador ----------

async function confirmar(pedidoId: number, compradorId: string) {
  const [p] = await db.select({ estado: pedido.estado }).from(pedido).where(eq(pedido.id, pedidoId));
  if (p?.estado !== "aguardando_confirmacao") {
    await enviar(compradorId, `O pedido ${pedidoId} não está esperando confirmação.`, { pedidoId });
    return;
  }
  const itens = await db
    .select()
    .from(itemPedido)
    .where(eq(itemPedido.pedidoId, pedidoId))
    .orderBy(asc(itemPedido.ordem));
  const [primeiro, ...resto] = itens;
  // A mensagem sai antes da transição: a busca dispara outras mensagens logo em seguida.
  const linhas = [`Pedido ${pedidoId} confirmado.`];
  if (primeiro) linhas.push(`Vou buscar fornecedores para ${quantidadeTexto(primeiro.quantidade, primeiro.unidade)} de ${primeiro.descricao}.`);
  if (resto.length) linhas.push(`${resto.length === 1 ? "O outro item fica" : `Os outros ${resto.length} itens ficam`} na fila.`);
  linhas.push("Aviso você a cada novidade.");
  await enviar(compradorId, linhas.join(" "), { pedidoId });
  try {
    await avancarPedido(pedidoId, "comprador_confirmou", { agente: "Comprador", motivo: "Confirmou o pedido." });
  } catch (erro) {
    ignorarCorrida(erro);
  }
}

async function cancelar(pedidoId: number, compradorId: string) {
  try {
    await avancarPedido(pedidoId, "cancelar", { agente: "Comprador", motivo: "Cancelou o pedido." });
    await enviar(compradorId, `Pedido ${pedidoId} cancelado.`, { pedidoId });
  } catch (erro) {
    if (!(erro instanceof TransicaoInvalida)) throw erro;
    await enviar(compradorId, `O pedido ${pedidoId} já terminou e não pode mais ser cancelado.`, { pedidoId });
  }
}

/** Pedido do comprador ainda antes da confirmação: a próxima mensagem dele é correção. */
async function pedidoPendente(compradorId: string) {
  const [p] = await db
    .select()
    .from(pedido)
    .where(and(eq(pedido.compradorId, compradorId), inArray(pedido.estado, ["interpretando", "aguardando_confirmacao"])))
    .orderBy(desc(pedido.id))
    .limit(1);
  return p;
}

export async function aoMensagemDoComprador({ contato, mensagemId, entrada }: MensagemRecebida) {
  if (entrada.botao) {
    const ref = /^(pedido|item):(\d+):/.exec(entrada.botao);
    if (ref) await vincularMensagem(mensagemId, ref[1] === "pedido" ? { pedidoId: Number(ref[2]) } : { itemPedidoId: Number(ref[2]) });
    if (await aoBotaoDoComprador(contato, entrada.botao)) return;
    const b = lerBotao(entrada.botao);
    if (!b) return;
    const [p] = await db.select({ compradorId: pedido.compradorId }).from(pedido).where(eq(pedido.id, b.pedidoId));
    if (!p || p.compradorId !== contato.id) return; // botão de pedido de outra pessoa: ignora
    if (b.acao === "confirmar") return confirmar(b.pedidoId, contato.id);
    if (b.acao === "cancelar") return cancelar(b.pedidoId, contato.id);
    return void (await enviar(contato.id, "O que devo mudar? Escreva do seu jeito.", { pedidoId: b.pedidoId }));
  }

  let texto = entrada.texto.trim();
  if (texto === "/start" || texto.startsWith("/start ") || texto === "/ajuda") {
    if (!contato.avisoPrivacidadeEm) {
      await db.update(tContato).set({ avisoPrivacidadeEm: new Date() }).where(eq(tContato.id, contato.id));
      await enviar(contato.id, AVISO_PRIVACIDADE);
    }
    await enviar(contato.id, TEXTO_BOAS_VINDAS);
    return;
  }
  // R1b: áudio, foto, print ou PDF viram texto de pedido.
  let leitura: LeituraAnexo | null = null;
  const arquivos = (entrada.anexos ?? []).filter((a) => a.tipo !== "outro");
  if (arquivos.length) {
    leitura = await lerAnexos(contato.id, mensagemId, entrada.canal, arquivos, texto);
    if (!leitura) return;
    texto = textoDoPedidoComAnexo(texto, leitura);
  }
  if (!texto) {
    await enviar(contato.id, "Pode escrever o pedido, mandar um áudio, uma foto do material ou o print do anúncio?");
    return;
  }

  if (!contato.avisoPrivacidadeEm) {
    await db.update(tContato).set({ avisoPrivacidadeEm: new Date() }).where(eq(tContato.id, contato.id));
    await enviar(contato.id, AVISO_PRIVACIDADE);
  }

  const pendente = await pedidoPendente(contato.id);
  if (!pendente && SAUDACAO.test(texto)) {
    await enviar(contato.id, TEXTO_BOAS_VINDAS);
    return;
  }
  if (pendente?.estado === "aguardando_confirmacao" && CONFIRMACAO.test(texto)) {
    return confirmar(pendente.id, contato.id);
  }
  // Saudação com pedido pendente não é correção: lembra o pedido em aberto.
  if (pendente?.estado === "aguardando_confirmacao" && SAUDACAO.test(texto)) {
    await enviar(contato.id, `Olá! O pedido ${pendente.id} está esperando sua confirmação. Confirma, corrige ou cancela?`, {
      pedidoId: pendente.id,
      botoes: botoesConfirmacao(pendente.id, false),
    });
    return;
  }
  if (pendente) {
    await vincularMensagem(mensagemId, { pedidoId: pendente.id });
    if (leitura) await anotarLeitura(pendente.id, contato.id, leitura);
    const correcoes = [...pendente.correcoes, texto];
    if (pendente.estado === "aguardando_confirmacao") {
      await avancarPedido(
        pendente.id,
        "comprador_corrigiu",
        { agente: "Comprador", motivo: "Corrigiu ou completou o pedido.", dados: { texto } },
        { correcoes },
      ).catch(ignorarCorrida);
    } else {
      await db.update(pedido).set({ correcoes }).where(eq(pedido.id, pendente.id));
    }
    await interpretarEResponder(pendente.id);
    return;
  }

  const novo = await abrirPedido({ compradorId: contato.id, canalOrigem: contato.canal, textoOriginal: texto });
  await vincularMensagem(mensagemId, { pedidoId: novo.id });
  if (leitura) await anotarLeitura(novo.id, contato.id, leitura);
  await interpretarEResponder(novo.id);
}

const NOME_ANEXO: Record<Anexo["tipo"], string> = { audio: "o áudio", foto: "a imagem", pdf: "o PDF", outro: "o arquivo" };

/** Baixa e lê os anexos do comprador. Devolve null quando já respondeu ao comprador (falha ou ilegível). */
async function lerAnexos(contatoId: string, mensagemId: string, canal: Canal, arquivos: Anexo[], legenda: string) {
  const qual = NOME_ANEXO[arquivos[0]!.tipo];
  const anexos: AnexoIa[] = [];
  for (const a of arquivos) {
    try {
      const r = await baixarAnexo(canal, a, mensagemId);
      anexos.push({ dados: r.dados, mediaType: r.mediaType });
    } catch (erro) {
      console.error("[comprador] anexo", erro);
    }
  }
  if (!anexos.length) {
    await enviar(contatoId, `Não consegui abrir ${qual}. Pode mandar de novo ou escrever o pedido?`);
    return null;
  }
  let l: LeituraAnexo;
  try {
    l = await lerAnexoDoComprador(anexos, legenda);
  } catch (erro) {
    await registrar(db, { agente: "Interpretador", acao: `Não conseguiu ler ${qual} do comprador.`, motivo: erro instanceof Error ? erro.message : String(erro) });
    await enviar(contatoId, TEXTO_FALHA_IA);
    return null;
  }
  if (!l.texto && !legenda) {
    await enviar(contatoId, `Não consegui entender ${qual}. Pode mandar de novo ou escrever o pedido?`);
    return null;
  }
  return l;
}

/** Guarda no rastro do pedido o que foi lido do anexo e, se for print de loja, avisa o preço visto. */
async function anotarLeitura(pedidoId: number, contatoId: string, l: LeituraAnexo) {
  const a = l.anuncio;
  await registrar(db, {
    agente: "Interpretador",
    acao: l.tipo === "audio" ? "Transcreveu o áudio do comprador." : l.tipo === "print_loja" ? "Leu o print do anúncio mandado pelo comprador." : "Leu a imagem mandada pelo comprador.",
    motivo: l.texto ? l.texto.slice(0, 300) : "Sem pedido legível no anexo.",
    pedidoId,
    dados: { leitura: l },
  });
  if (a?.preco) {
    const onde = [a.loja, a.vendedor].filter(Boolean).join(", ");
    await enviar(
      contatoId,
      `No print: ${a.titulo}, R$ ${a.preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${a.unidade ? ` por ${a.unidade}` : ""}${onde ? ` (${onde})` : ""}. Anotei no pedido.`,
      { pedidoId },
    );
  }
}
