// Conversa com o comprador: abre o pedido, chama o Interpretador, pergunta
// "Entendi assim, confirma?" e trata confirmação, correção e cancelamento.
// Áudio, foto, print de loja e PDF viram texto antes (R1b), em lerAnexos.
// S e Q3: a triagem do guardrail roda antes da IA, a mensagem nova é interpretada
// antes de abrir o pedido e a resposta depende da classe (pedido, ambíguo,
// controlado, proibido, fora do escopo, consulta, injeção, ofensa).

import { cadastrarItensNovos } from "../agentes/interpretador/catalogo.ts";
import { repassarRespostaDoComprador } from "../agentes/cotador/index.ts";
import { casarComBase, especificacaoEmTexto, itemDaBase, rotuloOpcao } from "../agentes/interpretador/base-itens.ts";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { lerAnexoDoComprador, textoDoPedidoComAnexo, type LeituraAnexo } from "../agentes/interpretador/anexos.ts";
import { chaveDoItem, interpretar, palavrasEmComum, type Interpretacao } from "../agentes/interpretador/index.ts";
import {
  deveAvisarGestor,
  posRegras,
  precisaModeloForte,
  respostaControlados,
  respostaDaClasse,
  ROTULO_CONTESTAR,
  TEXTO_DADO_PESSOAL,
  TEXTO_RESPOSTA_FIXA,
  TEXTO_SERVICO,
  TEXTO_SO_COM_NOTA,
  triagem,
  TRIAGEM_NEUTRA,
  type Classe,
  type Decisao,
  type ItemControlado,
  type Triagem,
} from "../agentes/guardrail/index.ts";
import { avisarGestor, insistenciaDo, registrarCaso, trecho } from "../agentes/guardrail/rastro.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato as tContato, evento, itemPedido, pedido } from "../nucleo/db/schema.ts";
import type { AnexoIa } from "../nucleo/ia/index.ts";
import { baixarAnexo, enviar, vincularMensagem, type Anexo, type Botao, type Canal, type MensagemRecebida } from "../nucleo/mensagens/index.ts";
import {
  abrirPedido,
  aoVarrer,
  avancarPedido,
  definirItens,
  TransicaoConcorrente,
  TransicaoInvalida,
} from "../nucleo/orquestrador/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { EMPRESA, JANELA_CONFIRMACAO_MIN } from "../config.ts";
import { aoBotaoDoComprador } from "./decisao.ts";
import { atributosFaltando, exemplosDoNicho } from "../dominio/categorias.ts";
import { dias, fmtNumero, MOTIVOS_CANCELAMENTO, nomePedido, quantidade, quantidadeDe, type MotivoCancelamento } from "../texto.ts";

/** Exemplo do nicho da empresa (EMPRESA_NICHO); sem nicho, o padrão neutro. */
export function textoBoasVindas(): string {
  const exemplo = exemplosDoNicho().pedidos[0] ?? "50 resmas de papel A4 e 20 pares de luva para o escritório até sexta";
  return (
    "Olá! Sou o assistente de cotações. Mande o que precisa comprar, do seu jeito, por exemplo: " +
    `"${exemplo}". ` +
    "Eu entendo o pedido, confirmo com você e busco fornecedores."
  );
}

export const AVISO_PRIVACIDADE =
  "Aviso: sou um assistente automatizado. Guardo as mensagens desta conversa para cotar seus pedidos. " +
  "Não mande dados pessoais que não sejam necessários. Para não receber mais mensagens, escreva PARAR.";

const TEXTO_FALHA_IA = "Não consegui ler seu pedido agora. Pode mandar de novo em instantes?";

/** Mostra o aviso curto de privacidade (R5) uma vez por contato. Também usado pelo Assistente. */
export async function garantirAvisoPrivacidade(contato: Pick<MensagemRecebida["contato"], "id" | "avisoPrivacidadeEm">) {
  if (contato.avisoPrivacidadeEm) return;
  await db.update(tContato).set({ avisoPrivacidadeEm: new Date() }).where(eq(tContato.id, contato.id));
  await enviar(contato.id, AVISO_PRIVACIDADE);
}

/** Resposta de uma consulta ("como está o pedido 12?"): texto e, se houver, botões do fluxo. */
export type RespostaConsulta = { texto: string; botoes?: Botao[] };
type RespondedorConsulta = (c: { contatoId: string; canal: Canal; texto: string }) => Promise<RespostaConsulta | null>;
let respondedorConsulta: RespondedorConsulta | null = null;

/**
 * Quem responde as consultas que o Interpretador classifica (classe "consulta"). O Assistente da
 * Frente 3 se registra aqui ao ligar; sem ele (ASSISTENTE=desligado), vale a resposta curta de antes.
 */
export function definirRespondedorDeConsulta(fn: RespondedorConsulta | null) {
  respondedorConsulta = fn;
}

export { plural } from "../texto.ts";
const quantidadeTexto = quantidade;

const CONFIRMACAO = /^(sim|ok|okay|confirm[oa]|confirmado|pode( seguir| cotar)?|isso|certo|fechado|beleza|blz|manda)[!.\s]*$/i;
const SAUDACAO = /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem\??|obrigad[oa]|valeu|ok|blz|beleza)[!.\s]*$/i;
/** "/start", "\start" (com a barra invertida, como no pedido 10) e "start" valem igual; o mesmo para ajuda. */
export const INICIO = /^[/\\]?start(\s|$)|^[/\\]?ajuda[!.?\s]*$/i;

// ---------- Botões ----------

type Acao = "confirmar" | "corrigir" | "cancelar";
const dadoBotao = (pedidoId: number, acao: Acao) => `pedido:${pedidoId}:${acao}`;

function lerBotao(dado: string): { pedidoId: number; acao: Acao; motivo?: MotivoCancelamento } | null {
  const m = /^pedido:(\d+):(confirmar|corrigir|cancelar)(?:_([a-z_]+))?$/.exec(dado);
  if (!m) return null;
  const motivo = m[3] && m[3] in MOTIVOS_CANCELAMENTO ? (m[3] as MotivoCancelamento) : undefined;
  return { pedidoId: Number(m[1]), acao: m[2] as Acao, motivo };
}

// ---------- Texto da confirmação ----------

type ItemResumo = { descricao: string; quantidade: string | number; unidade: string; aceitaSimilar: boolean; itemChave?: string | null; especificacao?: Record<string, string> };

export function textoConfirmacao(p: {
  id: number;
  setor?: string | null;
  entregas?: string | null;
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
  const linhas = [`${nomePedido(p, p.itens)}. Entendi assim:`, ""];
  p.itens.forEach((it, i) => {
    const nome = Number(it.quantidade) > 0 ? quantidadeDe(it.quantidade, it.unidade, it.descricao) : `? ${it.unidade} de ${it.descricao}`;
    // Item da base: mostra o código e as duas primeiras especificações técnicas.
    const espec = it.itemChave?.startsWith("ITM-") && it.especificacao ? Object.values(it.especificacao).slice(0, 2).join(", ") : "";
    linhas.push(`${i + 1}. ${nome}${espec ? ` (${espec})` : ""}${it.aceitaSimilar ? " (aceita similar)" : ""}`);
  });
  linhas.push("");
  const entrega = p.modoEntrega === "retirada" ? "Retirada na loja" : `Entrega: ${p.destino ?? "não informado"}${p.cep ? `, CEP ${p.cep}` : ""}`;
  linhas.push(entrega);
  if (p.janelaRecebimento) linhas.push(`Recebe: ${p.janelaRecebimento}`);
  linhas.push(`Setor: ${p.setor ?? "não informado"}`);
  const prazo = p.prazoTexto
    ? `${p.prazoTexto}${p.prazoMaxDias !== null ? ` (${dias(p.prazoMaxDias)})` : ""}`
    : "não informado";
  linhas.push(`Prazo: ${prazo}`);
  if (p.entregas) linhas.push(`Entregas: ${p.entregas}`);
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

/** O que a IA leu, já com as pós-regras do guardrail. */
type Lida = { d: Decisao; meta: { modelo: string; rota: string; caiuNaReserva: boolean; forte: boolean } };

/**
 * Lê com o Interpretador e aplica as pós-regras (S). I4: com sinal sensível ou
 * risco que a lista não confirma, refaz a leitura com o modelo forte.
 */
async function lerComGuardrail(entrada: Parameters<typeof interpretar>[0], pedidoId: number | undefined, t: Triagem): Promise<Lida> {
  let r = await interpretar(entrada, { pedidoId });
  let forte = false;
  if (precisaModeloForte(t, r.valor)) {
    try {
      r = await interpretar(entrada, { pedidoId, papel: "forte" });
      forte = true;
    } catch (erro) {
      console.error("[comprador] modelo forte", erro); // fica a leitura do rápido
    }
  }
  return { d: posRegras(r.valor, t), meta: { modelo: r.modelo, rota: r.rota, caiuNaReserva: r.caiuNaReserva, forte } };
}

/** Ambíguo que o comprador já confirmou (Sim ou opção): segue como pedido. */
function comoPedido(l: Lida): Lida {
  const i = l.d.interpretacao;
  return { ...l, d: { ...l.d, interpretacao: { ...i, classe: "pedido", subtipo: null, opcoes: [], ehPedido: i.itens.length > 0 } } };
}

export async function interpretarEResponder(pedidoId: number, opcoes: { lida?: Lida; triagem?: Triagem } = {}) {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
  if (!p) return;

  // Na correção, a IA recebe o que já estava entendido e aplica só a última mensagem.
  const atuais = p.correcoes.length ? await db.select().from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId)).orderBy(asc(itemPedido.ordem)) : [];
  const atual = atuais.length
    ? {
        itens: atuais.map((it) => ({ descricao: it.descricao, quantidade: Number(it.quantidade), unidade: it.unidade, especificacao: it.especificacao })),
        destino: p.destino,
        cep: p.cep,
        setor: p.setor,
        prazoTexto: p.prazoTexto,
        entregas: p.entregas,
      }
    : undefined;
  let lida = opcoes.lida;
  if (!lida) {
    try {
      lida = await lerComGuardrail({ textoOriginal: p.textoOriginal, correcoes: p.correcoes, atual }, pedidoId, opcoes.triagem ?? TRIAGEM_NEUTRA);
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
  }

  const i: Interpretacao = lida.d.interpretacao;
  const anteriores = atuais;
  // O texto que acabou de chegar: a última correção, ou a mensagem que abriu o pedido.
  const textoNovo = p.correcoes.at(-1) ?? p.textoOriginal;

  // Correção que a IA não leu como pedido (ou que apagou todos os itens) nunca cancela o pedido:
  // descarta a correção e mostra de novo o que já estava entendido. Correção proibida, fora do
  // escopo, consulta ou tentativa de mudar as regras tem a resposta da classe (S).
  if (!i.ehPedido && p.correcoes.length && anteriores.length) {
    const correcoes = p.correcoes.slice(0, -1);
    const classe = i.classe;
    const daClasse = classe !== "pedido" && classe !== "ambiguo" && classe !== "controlado";
    let antes = "Não entendi essa correção, então o pedido continua como estava. Diga o que mudar, por exemplo \"quantidade: 10\" ou \"setor: manutenção\".\n\n";
    if (daClasse) {
      const r = await responderClasse(p.compradorId, textoNovo, lida, { pedidoId, enviarResposta: false });
      antes = `${r}\n\nO pedido ${pedidoId} continua como estava.\n\n`;
    }
    try {
      await avancarPedido(
        pedidoId,
        "interpretado",
        {
          agente: "Interpretador",
          acao: "Não entendeu a correção; manteve o pedido como estava.",
          motivo: daClasse ? `Correção descartada (${classe}${i.subtipo ? `, ${i.subtipo}` : ""}).` : `Correção sem item legível: "${trecho(textoNovo)}".`,
        },
        { correcoes },
      );
    } catch (erro) {
      ignorarCorrida(erro);
      return;
    }
    await mostrarConfirmacao(pedidoId, antes);
    return;
  }
  // A IA relê o pedido inteiro a cada correção e às vezes perde a quantidade já dita:
  // item sem quantidade que já tinha uma mantém a anterior.
  if (p.correcoes.length) {
    for (const [n, it] of i.itens.entries()) {
      if (it.quantidade > 0) continue;
      const mesmo = anteriores.find((a) => a.itemChave === chaveDoItem(it.descricao) || a.descricao.toLowerCase() === it.descricao.toLowerCase()) ?? (i.itens.length === anteriores.length ? anteriores[n] : undefined);
      if (mesmo && Number(mesmo.quantidade) > 0) {
        it.quantidade = Number(mesmo.quantidade);
        if (it.unidade === "unidade" && mesmo.unidade) it.unidade = mesmo.unidade;
        i.faltando = i.faltando.filter((f) => !(/quant/i.test(f) && palavrasEmComum(f, it.descricao)));
      }
    }
  }

  // S: item controlado sai do pedido e vai a uma pessoa; o resto segue. Na correção,
  // só avisa o item que a própria correção trouxe (a IA relê o pedido inteiro).
  const controladosNovos = p.correcoes.length ? lida.d.controlados.filter((c) => palavrasEmComum(textoNovo, c.descricao)) : lida.d.controlados;
  if (controladosNovos.length) await encaminharControlados(p.compradorId, controladosNovos, { pedidoId, outrosSeguem: i.ehPedido, texto: textoNovo });
  if (i.ehPedido) {
    // Condição irregular ("sem nota") é tirada; o item é cotado com nota.
    if (i.condicaoIrregular && (!p.correcoes.length || triagem(textoNovo).condicaoIrregular)) {
      await avisarCondicaoIrregular(p.compradorId, i.condicaoIrregular, textoNovo, pedidoId);
    }
    if (i.condicaoIrregular) i.suposicoes = [...i.suposicoes, "Cotação com nota fiscal"];
    // Pedido junto com tentativa de mudar as regras ou ofensa: cota só o pedido, sem comentar.
    const novaTentativa = i.tentouMudarRegras && (!p.correcoes.length || Boolean(opcoes.triagem?.injecao));
    if (novaTentativa) await registrarCaso({ contatoId: p.compradorId, classe: "injecao", acao: "Tentou mudar as regras junto com o pedido.", motivo: "Cotou só o pedido, sem seguir a instrução.", texto: textoNovo, pedidoId });
    if (i.hostil && !p.correcoes.length) await registrarCaso({ contatoId: p.compradorId, classe: "ofensa", acao: "Mensagem hostil junto com o pedido.", motivo: "Seguiu o pedido sem comentar.", texto: textoNovo, pedidoId });
  }

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
      motivo: `A mensagem não tinha pedido de compra (${i.classe}).`,
    }).catch(ignorarCorrida);
    // O item controlado já teve o aviso acima; as outras classes têm a resposta delas.
    if (i.classe !== "controlado") {
      const r = i.classe === "pedido" || i.classe === "ambiguo" ? textoBoasVindas() : await responderClasse(p.compradorId, textoNovo, lida, { enviarResposta: false });
      await enviar(p.compradorId, r || textoBoasVindas());
    }
    return;
  }

  // Regra da área de compras: toda solicitação discriminada por setor, perguntado logo no pedido.
  if (i.ehPedido && !i.setor && !p.setor && !i.faltando.some((f) => /setor/i.test(f))) {
    i.faltando = ["Para qual setor é este pedido?", ...i.faltando];
  }
  // E6: casa cada item com a base; com uma correspondência, ganha código e especificação técnica.
  const daBase: string[] = [];
  const itens = await definirItens(
    db,
    pedidoId,
    i.itens.map((it) => {
      const espec = Object.fromEntries(it.especificacao.map((e) => [e.nome, e.valor]));
      const c = casarComBase(it.descricao, espec);
      if (c.tipo === "unico") daBase.push(`${c.item.id} ${c.item.descricao}`);
      return {
        descricao: c.tipo === "unico" ? c.item.descricao : it.descricao,
        quantidade: it.quantidade,
        unidade: it.unidade,
        itemChave: c.tipo === "unico" ? c.item.id : chaveDoItem(it.descricao),
        especificacao: c.tipo === "unico" ? { ...especificacaoEmTexto(c.item), ...espec } : espec,
        // Q2: sem marca exigida e sem o comprador dizer, vale o equivalente técnico.
        aceitaSimilar: it.aceitaSimilar ?? !it.marcaExigida,
      };
    }),
  );
  if (daBase.length) i.suposicoes = [...i.suposicoes, `Da base de itens: ${daBase.join("; ")}`];

  // Q4: atributo obrigatório da categoria que o pedido não diz. Pergunta uma vez, no máximo 3 perguntas no total.
  const atributos = p.perguntasFeitas === 0 ? atributosPerguntados(itens, i.faltando.length) : [];
  i.faltando = [...i.faltando, ...atributos.map((a) => a.pergunta)];
  const perguntar = i.faltando.length > 0 && p.perguntasFeitas === 0;

  const alteracoes = {
    destino: i.destino,
    cep: i.cep,
    modoEntrega: i.modoEntrega,
    janelaRecebimento: i.janelaRecebimento,
    prazoTexto: i.prazoTexto,
    prazoMaxDias: i.prazoDias,
    urgencia: i.urgencia,
    setor: i.setor ?? p.setor,
    entregas: i.entregas ?? p.entregas,
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
        dados: { interpretacao: i, controlados: lida.d.controlados, ...lida.meta },
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
    setor: i.setor ?? p.setor,
    entregas: i.entregas ?? p.entregas,
    prazoTexto: i.prazoTexto,
    prazoMaxDias: i.prazoDias,
    urgencia: i.urgencia,
    modoEntrega: i.modoEntrega,
    janelaRecebimento: i.janelaRecebimento,
    suposicoes: i.suposicoes,
    perguntas: perguntar ? i.faltando : [],
  });
  const escolha = escolhasDaBase(pedidoId, itens);
  // Q5: pedido de foto ou print com marca vista: pergunta se a marca é exigida.
  const deImagem = /\[(Foto|Print de loja)\]/.test([p.textoOriginal, ...p.correcoes].join("\n"));
  const marcas = deImagem ? perguntasDeMarca(pedidoId, i.itens) : { texto: "", botoes: [] };
  const botoesAtributo = botoesDeAtributos(pedidoId, atributos);
  await enviar(p.compradorId, texto + escolha.texto + marcas.texto, { pedidoId, botoes: [...botoesAtributo, ...marcas.botoes, ...escolha.botoes, ...botoesConfirmacao(pedidoId, perguntar)] });
}

const MAX_PERGUNTAS = 3;
type AtributoPerguntado = { ordem: number; chave: string; rotulo: string; pergunta: string; opcoes?: string[] };

/** Q4: o que a categoria exige e o item não diz, até caber em MAX_PERGUNTAS junto com as perguntas que já existem. */
export function atributosPerguntados(
  itens: { ordem: number; descricao: string; unidade: string; quantidade: string | number; especificacao: Record<string, string> }[],
  jaPerguntadas: number,
): AtributoPerguntado[] {
  const r: AtributoPerguntado[] = [];
  for (const it of itens) {
    // A unidade já é perguntada pelo Interpretador (regraDeUnidade).
    for (const a of atributosFaltando({ ...it, quantidade: Number(it.quantidade) }).filter((x) => x.chave !== "unidade")) {
      if (jaPerguntadas + r.length >= MAX_PERGUNTAS) return r;
      r.push({ ordem: it.ordem, chave: a.chave, rotulo: a.rotulo, pergunta: `${it.descricao}: ${a.pergunta}`, ...(a.opcoes ? { opcoes: a.opcoes } : {}) });
    }
  }
  return r;
}

/** Botões das respostas conhecidas ("1: Pó ABC"); sem opções, a pergunta fica só em texto. Máximo de 6 botões. */
function botoesDeAtributos(pedidoId: number, atributos: AtributoPerguntado[]): Botao[] {
  const botoes: Botao[] = [];
  for (const a of atributos) {
    a.opcoes?.forEach((o, n) => {
      if (botoes.length < 6) botoes.push({ rotulo: `${a.ordem}: ${o}`.slice(0, 40), dado: `pedido:${pedidoId}:attr:${a.ordem}:${a.chave}:${n}` });
    });
  }
  return botoes;
}

/** Q4: resposta por botão. Entra na especificação do item e vira correção, para valer se o pedido for relido. */
async function escolherAtributo(pedidoId: number, ordem: number, chave: string, indice: number, compradorId: string) {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
  if (!p || p.compradorId !== compradorId) return;
  if (p.estado !== "aguardando_confirmacao") {
    await enviar(compradorId, `O pedido ${pedidoId} não está esperando confirmação.`, { pedidoId });
    return;
  }
  const [it] = await db.select().from(itemPedido).where(and(eq(itemPedido.pedidoId, pedidoId), eq(itemPedido.ordem, ordem)));
  if (!it) return;
  const a = atributosFaltando({ descricao: it.descricao, unidade: it.unidade, quantidade: Number(it.quantidade), especificacao: it.especificacao }).find((x) => x.chave === chave);
  const valor = a?.opcoes?.[indice];
  if (!a || !valor) return;
  await db.update(itemPedido).set({ especificacao: { ...it.especificacao, [a.rotulo]: valor } }).where(eq(itemPedido.id, it.id));
  await db.update(pedido).set({ correcoes: [...p.correcoes, `Item ${ordem}: ${a.rotulo}: ${valor}.`] }).where(eq(pedido.id, pedidoId));
  await registrar(db, { agente: "Comprador", acao: `Informou ${a.rotulo}: ${valor} no item ${ordem}.`, motivo: "Resposta à pergunta do atributo obrigatório da categoria.", pedidoId, itemPedidoId: it.id });
  await mostrarConfirmacao(pedidoId);
}

/** Q5: "Cotar só a marca X ou aceita similar?", em dois botões por item. */
function perguntasDeMarca(pedidoId: number, itens: Interpretacao["itens"]) {
  const botoes: Botao[] = [];
  const linhas: string[] = [];
  itens.forEach((it, n) => {
    if (!it.marca || it.marcaExigida || it.aceitaSimilar !== null || botoes.length >= 4) return;
    const ordem = n + 1;
    linhas.push(`Item ${ordem}: cotar só a marca ${it.marca} ou aceita similar?`);
    botoes.push(
      { rotulo: `${ordem}: só ${it.marca}`.slice(0, 40), dado: `pedido:${pedidoId}:marca:${ordem}:so` },
      { rotulo: `${ordem}: aceita similar`, dado: `pedido:${pedidoId}:marca:${ordem}:similar` },
    );
  });
  return { botoes, texto: linhas.length ? `\n\n${linhas.join("\n")}` : "" };
}

/** Q5: resposta à pergunta da marca. Vira correção, para valer também se o pedido for relido. */
async function escolherMarca(pedidoId: number, ordem: number, escolha: "so" | "similar", compradorId: string) {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
  if (!p || p.compradorId !== compradorId) return;
  if (p.estado !== "aguardando_confirmacao") {
    await enviar(compradorId, `O pedido ${pedidoId} não está esperando confirmação.`, { pedidoId });
    return;
  }
  const [it] = await db.select().from(itemPedido).where(and(eq(itemPedido.pedidoId, pedidoId), eq(itemPedido.ordem, ordem)));
  if (!it) return;
  const marca = Object.entries(it.especificacao).find(([k]) => /^marca$/i.test(k.trim()))?.[1] ?? "da imagem";
  const so = escolha === "so";
  const frase = so ? `Item ${ordem}: só a marca ${marca}.` : `Item ${ordem}: aceita similar à marca ${marca}.`;
  await db.update(itemPedido).set({ aceitaSimilar: !so }).where(eq(itemPedido.id, it.id));
  await db.update(pedido).set({ correcoes: [...p.correcoes, frase] }).where(eq(pedido.id, pedidoId));
  await registrar(db, { agente: "Comprador", acao: so ? `Exigiu a marca ${marca} no item ${ordem}.` : `Aceitou similar à marca ${marca} no item ${ordem}.`, motivo: "Resposta à pergunta da marca vista na imagem.", pedidoId, itemPedidoId: it.id });
  await mostrarConfirmacao(pedidoId);
}

/** E6: itens com variações na base viram botões ("1: 50 mm", "1: 25 mm"). */
function escolhasDaBase(pedidoId: number, itens: { ordem: number; descricao: string; itemChave: string | null; especificacao: Record<string, string> }[]) {
  const botoes: Botao[] = [];
  const linhas: string[] = [];
  for (const it of itens) {
    if (it.itemChave?.startsWith("ITM-")) continue;
    const c = casarComBase(it.descricao, it.especificacao);
    if (c.tipo !== "varios") continue;
    linhas.push(`Item ${it.ordem}: qual destes? Escolha abaixo ou confirme assim mesmo.`);
    for (const o of c.opcoes) botoes.push({ rotulo: `${it.ordem}: ${rotuloOpcao(o, c.opcoes)}`, dado: `pedido:${pedidoId}:base:${it.ordem}:${o.id}` });
    if (botoes.length >= 6) break;
  }
  return { botoes, texto: linhas.length ? `\n\n${linhas.join("\n")}` : "" };
}

/** Comprador escolheu a variação de um item na base: atualiza e mostra a confirmação de novo. */
async function escolherDaBase(pedidoId: number, ordem: number, idBase: string, compradorId: string) {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
  const b = itemDaBase(idBase);
  if (!p || p.compradorId !== compradorId || !b) return;
  if (p.estado !== "aguardando_confirmacao") {
    await enviar(compradorId, `O pedido ${pedidoId} não está esperando confirmação.`, { pedidoId });
    return;
  }
  const [it] = await db.select().from(itemPedido).where(and(eq(itemPedido.pedidoId, pedidoId), eq(itemPedido.ordem, ordem)));
  if (!it) return;
  await db
    .update(itemPedido)
    .set({ descricao: b.descricao, itemChave: b.id, especificacao: { ...it.especificacao, ...especificacaoEmTexto(b) } })
    .where(eq(itemPedido.id, it.id));
  await registrar(db, { agente: "Comprador", acao: `Escolheu ${b.id} (${b.descricao}) para o item ${ordem}.`, motivo: "Escolha na base de itens.", pedidoId, itemPedidoId: it.id });
  await mostrarConfirmacao(pedidoId);
}

/** Mostra de novo a confirmação do pedido como está no banco (sem chamar a IA). */
async function mostrarConfirmacao(pedidoId: number, antes = "") {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
  if (!p) return;
  const itens = await db.select().from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId)).orderBy(asc(itemPedido.ordem));
  const texto = textoConfirmacao({
    id: pedidoId,
    itens: itens.map((x) => ({ ...x })),
    destino: p.destino,
    cep: p.cep,
    setor: p.setor,
    entregas: p.entregas,
    prazoTexto: p.prazoTexto,
    prazoMaxDias: p.prazoMaxDias,
    urgencia: p.urgencia,
    modoEntrega: p.modoEntrega,
    janelaRecebimento: p.janelaRecebimento,
    suposicoes: p.suposicoes,
    perguntas: [],
  });
  const escolha = escolhasDaBase(pedidoId, itens);
  await enviar(p.compradorId, antes + texto + escolha.texto, { pedidoId, botoes: [...escolha.botoes, ...botoesConfirmacao(pedidoId, false)] });
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
  // Nunca cota sem quantidade: pergunta antes de seguir.
  const semQuantidade = itens.filter((it) => !(Number(it.quantidade) > 0));
  if (semQuantidade.length) {
    await enviar(
      compradorId,
      `Antes de cotar, falta a quantidade de: ${semQuantidade.map((it) => it.descricao).join(", ")}. Quantos ${semQuantidade.length === 1 ? `(em ${semQuantidade[0]!.unidade})` : ""}?`,
      { pedidoId },
    );
    return;
  }
  const [primeiro, ...resto] = itens;
  // A mensagem sai antes da transição: a busca dispara outras mensagens logo em seguida.
  const [pc] = await db.select({ setor: pedido.setor }).from(pedido).where(eq(pedido.id, pedidoId));
  const linhas = [`${nomePedido({ id: pedidoId, setor: pc?.setor }, itens)}: confirmado.`];
  if (primeiro) linhas.push(`Vou buscar fornecedores para ${quantidadeTexto(primeiro.quantidade, primeiro.unidade)} de ${primeiro.descricao}.`);
  if (resto.length) linhas.push(`${resto.length === 1 ? "O outro item fica" : `Os outros ${resto.length} itens ficam`} na fila.`);
  linhas.push("Aviso você a cada novidade.");
  await enviar(compradorId, linhas.join(" "), { pedidoId });
  // Item que não estava na base vira item cadastrado, com código, antes de a busca começar.
  await cadastrarItensNovos(pedidoId).catch((e) => console.error("[catálogo]", e));
  try {
    await avancarPedido(pedidoId, "comprador_confirmou", { agente: "Comprador", motivo: "Confirmou o pedido." });
  } catch (erro) {
    ignorarCorrida(erro);
  }
}

async function cancelar(pedidoId: number, compradorId: string, motivo?: MotivoCancelamento) {
  // Todo cancelamento tem justificativa: sem motivo, pergunta antes.
  if (!motivo) {
    await enviar(compradorId, `Por que cancelar o pedido ${pedidoId}?`, {
      pedidoId,
      botoes: (Object.keys(MOTIVOS_CANCELAMENTO) as MotivoCancelamento[]).map((k) => ({ rotulo: MOTIVOS_CANCELAMENTO[k], dado: `pedido:${pedidoId}:cancelar_${k}` })),
    });
    return;
  }
  try {
    await avancarPedido(
      pedidoId,
      "cancelar",
      { agente: "Comprador", acao: "Cancelou o pedido.", motivo: `Motivo: ${MOTIVOS_CANCELAMENTO[motivo]}.` },
      { motivoCancelamento: MOTIVOS_CANCELAMENTO[motivo] },
    );
    await enviar(compradorId, `Pedido ${pedidoId} cancelado (${MOTIVOS_CANCELAMENTO[motivo].toLowerCase()}).`, { pedidoId });
  } catch (erro) {
    if (!(erro instanceof TransicaoInvalida)) throw erro;
    await enviar(compradorId, `O pedido ${pedidoId} já terminou e não pode mais ser cancelado.`, { pedidoId });
  }
}

/** Última atividade do pedido em aberto: a mudança mais recente ou o lembrete. */
const ultimaAtividade = (p: { atualizadoEm: Date; lembreteConfirmacaoEm: Date | null }) =>
  Math.max(p.atualizadoEm.getTime(), p.lembreteConfirmacaoEm?.getTime() ?? 0);

/**
 * Pedido do comprador ainda antes da confirmação: a próxima mensagem dele é correção.
 * Vale por JANELA_CONFIRMACAO_MIN desde a última atividade (o lembrete renova a janela).
 * Depois disso, uma mensagem nova abre outro pedido em vez de virar correção de um pedido velho.
 */
async function pedidoPendente(compradorId: string, agora = Date.now()) {
  const [p] = await db
    .select()
    .from(pedido)
    .where(and(eq(pedido.compradorId, compradorId), inArray(pedido.estado, ["interpretando", "aguardando_confirmacao"])))
    .orderBy(desc(pedido.id))
    .limit(1);
  if (p && agora - ultimaAtividade(p) > JANELA_CONFIRMACAO_MIN() * 60_000) return { ...p, vencido: true as const };
  return p ? { ...p, vencido: false as const } : undefined;
}

/** Pedido parado em "confirma?" há uma janela inteira: um lembrete, uma vez. */
export async function lembrarConfirmacoes(agora: Date) {
  const limite = new Date(agora.getTime() - JANELA_CONFIRMACAO_MIN() * 60_000);
  const parados = await db
    .select()
    .from(pedido)
    .where(and(eq(pedido.estado, "aguardando_confirmacao"), isNull(pedido.lembreteConfirmacaoEm), lte(pedido.atualizadoEm, limite)));
  for (const p of parados) {
    const marcou = await db
      .update(pedido)
      .set({ lembreteConfirmacaoEm: agora })
      .where(and(eq(pedido.id, p.id), isNull(pedido.lembreteConfirmacaoEm)))
      .returning({ id: pedido.id });
    if (!marcou.length) continue;
    const itens = await db.select({ descricao: itemPedido.descricao }).from(itemPedido).where(eq(itemPedido.pedidoId, p.id)).orderBy(asc(itemPedido.ordem));
    await enviar(
      p.compradorId,
      `${nomePedido(p, itens)} ainda espera sua confirmação. Nada é cotado antes disso. Confirma, corrige ou cancela? Na próxima hora, o que você escrever completa este pedido; depois, abre um pedido novo.`,
      { pedidoId: p.id, tipo: "aviso", botoes: botoesConfirmacao(p.id, false) },
    );
    await registrar(db, { agente: "Acompanhamento do pedido", acao: `Lembrou o comprador de confirmar o pedido ${p.id}.`, motivo: `Pedido parado em "confirma?" há ${JANELA_CONFIRMACAO_MIN()} min.`, pedidoId: p.id });
  }
}

export function ligarComprador() {
  aoVarrer(lembrarConfirmacoes);
}

// ---------- Guardrail: respostas por classe (S) ----------

const ACAO_DA_CLASSE: Partial<Record<Classe, string>> = {
  proibido: "Pedido proibido bloqueado.",
  fora_do_escopo: "Fora do escopo.",
  consulta: "Consulta sobre pedidos, respondida curto.",
  injecao: "Tentou mudar as regras.",
  ofensa: "Mensagem ofensiva.",
};

const SUBTIPO_SEM_TRECHO = new Set(["sexual", "sexual_menor"]);

/**
 * Responde (ou devolve o texto da resposta) para proibido, fora do escopo,
 * consulta, injeção e ofensa: registra o caso, conta a insistência e avisa o
 * gestor quando a regra pede. Recusa leva o botão "Era uma compra da empresa".
 */
async function responderClasse(
  contatoId: string,
  texto: string,
  c: { d: { interpretacao: Pick<Interpretacao, "classe" | "subtipo" | "motivo">; porLista: boolean; outrosItens: number }; meta?: Lida["meta"] },
  opcoes: { pedidoId?: number; enviarResposta?: boolean } = {},
): Promise<string> {
  const i = c.d.interpretacao;
  const classe = i.classe;
  const ins = await insistenciaDo(contatoId);
  const vez = classe === "proibido" ? ins.proibido + 1 : classe === "injecao" ? ins.injecao + 1 : classe === "fora_do_escopo" ? ins.foraSeguidas + 1 : classe === "ofensa" ? ins.ofensa + 1 : 1;
  const semTrecho = SUBTIPO_SEM_TRECHO.has(i.subtipo ?? "");
  const ev = await registrarCaso({
    contatoId,
    classe,
    subtipo: i.subtipo,
    acao: ACAO_DA_CLASSE[classe] ?? `Mensagem da classe ${classe}.`,
    motivo: i.motivo || (c.d.porLista ? "Lista dura." : "Classe dada pela leitura."),
    texto: semTrecho ? undefined : texto,
    pedidoId: opcoes.pedidoId,
    dados: { vez, porLista: c.d.porLista, ...c.meta },
  });
  if (deveAvisarGestor(classe, i.subtipo, vez)) {
    await avisarGestor({
      chave: `${classe}:${i.subtipo ?? ""}:${contatoId}`,
      texto: `${ACAO_DA_CLASSE[classe] ?? classe}${i.subtipo ? ` (${i.subtipo})` : ""}, ${vez}ª vez em 24 h, contato ${contatoId}${semTrecho ? "" : `: "${trecho(texto)}"`}`,
      contatoId,
      pedidoId: opcoes.pedidoId,
    });
  }
  let resposta = respostaDaClasse({ classe, subtipo: i.subtipo, vez, empresa: EMPRESA.nome, comOutrosItens: c.d.outrosItens > 0 });
  let botoesConsulta: Botao[] | undefined;
  if (classe === "consulta") {
    const r = await responderConsulta(contatoId, texto);
    resposta = r?.texto ?? (await textoConsulta(contatoId, texto, resposta));
    botoesConsulta = r?.botoes;
  }
  if (opcoes.enviarResposta !== false && resposta) {
    const botoes = classe === "proibido" ? [{ rotulo: ROTULO_CONTESTAR, dado: `g:${ev.id}:contestar` }] : botoesConsulta;
    await enviar(contatoId, resposta, { pedidoId: opcoes.pedidoId, botoes });
  }
  return resposta;
}

/** Consulta pelo Assistente, quando ligado. Falha dele não derruba a resposta: cai no texto curto. */
async function responderConsulta(contatoId: string, texto: string): Promise<RespostaConsulta | null> {
  if (!respondedorConsulta) return null;
  const [c] = await db.select({ canal: tContato.canal }).from(tContato).where(eq(tContato.id, contatoId));
  try {
    return await respondedorConsulta({ contatoId, canal: c?.canal ?? "web", texto });
  } catch (erro) {
    console.error("[comprador] consulta pelo Assistente", erro);
    return null;
  }
}

/** Consulta sem o Assistente: só o estado do pedido citado (ou do último). */
async function textoConsulta(contatoId: string, texto: string, padrao: string): Promise<string> {
  const n = /\bpedido\s*(?:n[º°o.]?\s*)?(\d+)/i.exec(texto)?.[1];
  const [p] = n
    ? await db.select().from(pedido).where(and(eq(pedido.id, Number(n)), eq(pedido.compradorId, contatoId)))
    : await db.select().from(pedido).where(eq(pedido.compradorId, contatoId)).orderBy(desc(pedido.id)).limit(1);
  if (!p) return padrao;
  const estado = { interpretando: "em leitura", aguardando_confirmacao: "esperando sua confirmação", em_andamento: "em cotação", concluido: "concluído", cancelado: "cancelado" }[p.estado];
  return `Ainda não consigo responder isso por aqui. O pedido ${p.id} está ${estado}; os detalhes ficam na tela de pedidos.`;
}

/** Item controlado: não cota, encaminha ao gestor (um aviso por item em 24 h) e registra. */
async function encaminharControlados(contatoId: string, itens: readonly ItemControlado[], o: { pedidoId?: number; outrosSeguem: boolean; texto: string }) {
  let avisado = false;
  for (const c of itens) {
    await registrarCaso({
      contatoId,
      classe: "controlado",
      subtipo: c.grupo,
      acao: "Item controlado encaminhado.",
      motivo: `${c.descricao}: ${c.grupo}${c.orgao ? ` (${c.orgao})` : ""}. Não foi cotado.`,
      texto: o.texto,
      pedidoId: o.pedidoId,
      dados: { item: c.descricao, orgao: c.orgao },
    });
    const foi = await avisarGestor({
      chave: `controlado:${contatoId}:${c.descricao.toLowerCase()}`,
      texto: `Pedido de item controlado: ${c.descricao} (${c.grupo}${c.orgao ? `; ${c.orgao}` : ""}), contato ${contatoId}${o.pedidoId ? `, pedido ${o.pedidoId}` : ""}. A compra exige autorização e um responsável.`,
      contatoId,
      pedidoId: o.pedidoId,
    });
    avisado ||= foi;
  }
  await enviar(contatoId, respostaControlados(itens, avisado, o.outrosSeguem), { pedidoId: o.pedidoId });
}

/** "Sem nota" e afins: tira a condição, avisa o comprador e conta para a insistência. */
async function avisarCondicaoIrregular(contatoId: string, condicao: string, texto: string, pedidoId: number) {
  const ins = await insistenciaDo(contatoId);
  const vez = ins.condicao + 1;
  await registrarCaso({ contatoId, classe: "condicao_irregular", subtipo: condicao, acao: "Condição irregular ignorada.", motivo: `"${condicao}": o pedido segue com nota fiscal.`, texto, pedidoId, dados: { vez } });
  if (deveAvisarGestor("condicao_irregular", condicao, vez)) {
    await avisarGestor({ chave: `condicao:${contatoId}`, texto: `Pediu de novo condição irregular ("${condicao}"), ${vez}ª vez em 24 h, contato ${contatoId}, pedido ${pedidoId}.`, contatoId, pedidoId });
  }
  await enviar(contatoId, TEXTO_SO_COM_NOTA, { pedidoId });
}

/**
 * Q3: mensagem nova, sem pedido em aberto. Interpreta antes de abrir o pedido,
 * para não deixar pedido cancelado no quadro, e responde por classe (S).
 */
async function novaMensagem(m: {
  contatoId: string;
  canal: MensagemRecebida["contato"]["canal"];
  mensagemId?: string;
  texto: string;
  leitura: LeituraAnexo | null;
  t: Triagem;
  achado?: { id: number; vencido: boolean };
  /** Já houve uma pergunta de esclarecimento: não pergunta de novo. */
  jaPerguntou?: boolean;
}) {
  let lida: Lida;
  try {
    lida = await lerComGuardrail({ textoOriginal: m.texto }, undefined, m.t);
  } catch (erro) {
    await registrar(db, { agente: "Interpretador", acao: "Não conseguiu ler a mensagem do comprador.", motivo: erro instanceof Error ? erro.message : String(erro) });
    await enviar(m.contatoId, TEXTO_FALHA_IA);
    return;
  }
  const i = lida.d.interpretacao;
  if (i.classe === "ambiguo" && !(m.jaPerguntou && i.itens.length && i.subtipo !== "servico")) {
    return perguntarAmbiguo(m.contatoId, m.texto, lida, Boolean(m.jaPerguntou));
  }
  if (i.classe === "controlado") return encaminharControlados(m.contatoId, lida.d.controlados, { outrosSeguem: false, texto: m.texto });
  if (i.classe !== "pedido" && i.classe !== "ambiguo") {
    await responderClasse(m.contatoId, m.texto, lida);
    return;
  }
  if (!i.itens.length && !lida.d.controlados.length) {
    await enviar(m.contatoId, textoBoasVindas());
    return;
  }
  await abrirEInterpretar({ ...m, lida: i.classe === "ambiguo" ? comoPedido(lida) : lida });
}

/** Abre o pedido já com a leitura feita (sem chamar a IA de novo) e mostra a confirmação. */
async function abrirEInterpretar(m: { contatoId: string; canal: MensagemRecebida["contato"]["canal"]; mensagemId?: string; texto: string; leitura: LeituraAnexo | null; t: Triagem; achado?: { id: number; vencido: boolean }; lida: Lida }) {
  const novo = await abrirPedido({ compradorId: m.contatoId, canalOrigem: m.canal, textoOriginal: m.texto });
  if (m.mensagemId) await vincularMensagem(m.mensagemId, { pedidoId: novo.id });
  if (m.achado?.vencido) {
    await enviar(m.contatoId, `Abri um pedido novo. O pedido ${m.achado.id} continua esperando confirmação; os botões dele ainda valem.`, { pedidoId: novo.id });
  }
  if (m.leitura) await anotarLeitura(novo.id, m.contatoId, m.leitura);
  await interpretarEResponder(novo.id, { lida: m.lida, triagem: m.t });
}

/**
 * Ambíguo: pergunta antes de abrir o pedido. Só o nome do produto vira
 * "Quer que eu cote X?" (Sim e Não); sem item claro, até 4 opções em botões;
 * serviço tem a resposta de que ainda cotamos só produtos.
 */
async function perguntarAmbiguo(contatoId: string, texto: string, lida: Lida, jaPerguntou: boolean) {
  const i = lida.d.interpretacao;
  if (i.subtipo === "servico") {
    await registrarCaso({ contatoId, classe: "ambiguo", subtipo: "servico", acao: "Pedido de serviço: ainda cotamos só produtos.", motivo: i.motivo, texto });
    await enviar(contatoId, TEXTO_SERVICO);
    return;
  }
  const comItens = i.itens.length > 0;
  const opcoes = comItens || jaPerguntou ? [] : i.opcoes;
  const nomes = i.itens.map((it) => it.descricao).join(", ");
  const pergunta = comItens
    ? i.subtipo === "confirmar_item" && i.faltando[0]
      ? i.faltando[0]
      : `Quer que eu cote "${nomes}"?`
    : opcoes.length
      ? `${i.faltando[0] ?? "Do que precisa?"} Escolha abaixo ou mande o item e a quantidade.`
      : "Ainda não entendi o que precisa comprar. Mande o item e a quantidade, por exemplo \"10 caixas de clipes de papel\".";
  const ev = await registrarCaso({
    contatoId,
    classe: "ambiguo",
    subtipo: i.subtipo,
    acao: "Pediu esclarecimento antes de abrir o pedido.",
    motivo: i.motivo || pergunta,
    texto,
    dados: { texto: texto.slice(0, 2000), opcoes, pergunta, interpretacao: comItens ? i : undefined, meta: lida.meta },
  });
  const botoes: Botao[] = comItens
    ? [
        { rotulo: "Sim", dado: `g:${ev.id}:sim` },
        { rotulo: "Não", dado: `g:${ev.id}:nao` },
      ]
    : opcoes.map((o, n) => ({ rotulo: o, dado: `g:${ev.id}:o${n}` }));
  await enviar(contatoId, pergunta, { botoes: botoes.length ? botoes : undefined });
}

/** Botões do guardrail: g:<evento>:sim|nao|o<n>|contestar. */
async function aoBotaoGuardrail(c: MensagemRecebida["contato"], eventoId: string, acao: string) {
  const [ev] = await db.select().from(evento).where(and(eq(evento.id, eventoId), eq(evento.agente, "Guardrail")));
  const dados = (ev?.dados ?? {}) as { contatoId?: string; texto?: string; opcoes?: string[]; interpretacao?: Interpretacao; meta?: Lida["meta"]; classe?: string; subtipo?: string | null };
  if (!ev || dados.contatoId !== c.id) return; // botão de outra pessoa ou velho: ignora
  // Um clique por pergunta: o segundo não abre outro pedido.
  const [respondido] = await db
    .select({ id: evento.id })
    .from(evento)
    .where(and(eq(evento.agente, "Guardrail"), sql`${evento.dados}->>'respostaDe' = ${eventoId}`))
    .limit(1);
  if (respondido) {
    await enviar(c.id, "Essa pergunta já foi respondida.");
    return;
  }
  const responder = (o: string) => registrarCaso({ contatoId: c.id, classe: "resposta", acao: `Comprador respondeu: ${o}.`, motivo: `Resposta à pergunta do guardrail.`, dados: { respostaDe: eventoId } });

  if (acao === "contestar") {
    await responder("era uma compra da empresa");
    await avisarGestor({ chave: `contestou:${eventoId}`, texto: `O comprador contestou uma recusa (${dados.classe ?? "?"}${dados.subtipo ? `, ${dados.subtipo}` : ""}) e diz que era uma compra da empresa. Revise o caso no rastro (evento ${eventoId}).`, contatoId: c.id });
    await enviar(c.id, "Anotei. O gestor de compras vai revisar este caso.");
    return;
  }
  if (acao === "nao") {
    await responder("não");
    await enviar(c.id, "Tudo bem, não cotei nada. Quando precisar, mande o item e a quantidade.");
    return;
  }
  const texto = dados.texto ?? "";
  if (acao === "sim" && dados.interpretacao && texto) {
    await responder("sim");
    const i = dados.interpretacao;
    const lida: Lida = { d: { interpretacao: i, controlados: [], porLista: false, outrosItens: 0 }, meta: dados.meta ?? { modelo: "", rota: "", caiuNaReserva: false, forte: false } };
    await abrirEInterpretar({ contatoId: c.id, canal: c.canal, texto, leitura: null, t: triagem(texto), lida: comoPedido(lida) });
    return;
  }
  const n = /^o(\d)$/.exec(acao);
  const opcao = n ? dados.opcoes?.[Number(n[1])] : undefined;
  if (opcao && texto) {
    await responder(opcao);
    const novoTexto = `${texto}\n${opcao}`;
    await novaMensagem({ contatoId: c.id, canal: c.canal, texto: novoTexto, leitura: null, t: triagem(novoTexto), jaPerguntou: true });
  }
}

export type OpcoesMensagemComprador = {
  /**
   * Quem chamou já sabe que a mensagem não responde à dúvida de fornecedor pendente (o Assistente
   * leu como pedido novo, correção ou confirmação): não repassa ao fornecedor.
   */
  naoEhRespostaFornecedor?: boolean;
};

export async function aoMensagemDoComprador({ contato, mensagemId, entrada }: MensagemRecebida, opcoes: OpcoesMensagemComprador = {}) {
  if (entrada.botao) {
    const g = /^g:([0-9a-f-]{36}):(sim|nao|o\d|contestar)$/.exec(entrada.botao);
    if (g) return aoBotaoGuardrail(contato, g[1]!, g[2]!);
    const base = /^pedido:(\d+):base:(\d+):(ITM-\d+)$/.exec(entrada.botao);
    if (base) {
      await vincularMensagem(mensagemId, { pedidoId: Number(base[1]) });
      return escolherDaBase(Number(base[1]), Number(base[2]), base[3]!, contato.id);
    }
    const marca = /^pedido:(\d+):marca:(\d+):(so|similar)$/.exec(entrada.botao);
    if (marca) {
      await vincularMensagem(mensagemId, { pedidoId: Number(marca[1]) });
      return escolherMarca(Number(marca[1]), Number(marca[2]), marca[3] as "so" | "similar", contato.id);
    }
    const attr = /^pedido:(\d+):attr:(\d+):([a-z_]+):(\d+)$/.exec(entrada.botao);
    if (attr) {
      await vincularMensagem(mensagemId, { pedidoId: Number(attr[1]) });
      return escolherAtributo(Number(attr[1]), Number(attr[2]), attr[3]!, Number(attr[4]), contato.id);
    }
    const ref = /^(pedido|item):(\d+):/.exec(entrada.botao);
    if (ref) await vincularMensagem(mensagemId, ref[1] === "pedido" ? { pedidoId: Number(ref[2]) } : { itemPedidoId: Number(ref[2]) });
    if (await aoBotaoDoComprador(contato, entrada.botao)) return;
    const b = lerBotao(entrada.botao);
    if (!b) return;
    const [p] = await db.select({ compradorId: pedido.compradorId }).from(pedido).where(eq(pedido.id, b.pedidoId));
    if (!p || p.compradorId !== contato.id) return; // botão de pedido de outra pessoa: ignora
    if (b.acao === "confirmar") return confirmar(b.pedidoId, contato.id);
    if (b.acao === "cancelar") return cancelar(b.pedidoId, contato.id, b.motivo);
    return void (await enviar(contato.id, "O que devo mudar? Escreva do seu jeito.", { pedidoId: b.pedidoId }));
  }

  let texto = entrada.texto.trim();
  if (INICIO.test(texto)) {
    if (!contato.avisoPrivacidadeEm) {
      await db.update(tContato).set({ avisoPrivacidadeEm: new Date() }).where(eq(tContato.id, contato.id));
      await enviar(contato.id, AVISO_PRIVACIDADE);
    }
    await enviar(contato.id, textoBoasVindas());
    return;
  }
  // R1b: áudio, foto, print ou PDF viram texto de pedido.
  let leitura: LeituraAnexo | null = null;
  const arquivos = (entrada.anexos ?? []).filter((a) => a.tipo !== "outro");
  if (arquivos.length) {
    leitura = await lerAnexos(contato.id, mensagemId, entrada.canal, arquivos, texto);
    if (!leitura) return;
    // S: imagem imprópria não é descrita nem vira pedido.
    if (leitura.impropria) {
      await responderClasse(contato.id, "", { d: { interpretacao: { classe: "proibido", subtipo: "sexual", motivo: "Imagem imprópria no anexo." }, porLista: false, outrosItens: 0 } });
      return;
    }
    texto = textoDoPedidoComAnexo(texto, leitura);
  }
  if (!texto) {
    await enviar(contato.id, "Pode escrever o pedido, mandar um áudio, uma foto do produto ou o print do anúncio?");
    return;
  }

  await garantirAvisoPrivacidade(contato);

  // S, barreira 1: triagem em código, antes da IA e antes de repassar ao fornecedor.
  const t = triagem(texto);
  texto = t.texto; // dado pessoal mascarado daqui em diante
  if (t.dadoPessoal.length) await enviar(contato.id, TEXTO_DADO_PESSOAL);
  if (t.bloqueio) {
    const interpretacao = { classe: "proibido" as const, subtipo: t.bloqueio.subtipo, motivo: `Lista dura: ${t.bloqueio.subtipo}.` };
    await responderClasse(contato.id, texto, { d: { interpretacao, porLista: true, outrosItens: 0 } });
    return;
  }
  const ins = await insistenciaDo(contato.id);
  if (ins.respostaFixa) {
    // 3ª tentativa proibida ou de injeção na última hora: resposta fixa, sem IA.
    await registrarCaso({ contatoId: contato.id, classe: "resposta_fixa", acao: "Respondeu fixo, sem IA.", motivo: "Insistência: 3 ou mais tentativas proibidas ou de injeção em 24 h, a última há menos de 1 h.", texto });
    await enviar(contato.id, TEXTO_RESPOSTA_FIXA);
    return;
  }
  if (t.foraDoEscopo && ins.foraSeguidas >= 3) {
    // Fora do escopo seguido, com cara de código ou longo demais: resposta fixa, sem gastar IA.
    const interpretacao = { classe: "fora_do_escopo" as const, subtipo: t.foraDoEscopo, motivo: "Fora do escopo repetido, sem IA." };
    await responderClasse(contato.id, texto, { d: { interpretacao, porLista: true, outrosItens: 0 } });
    return;
  }

  // Dúvida de fornecedor esperando o comprador: esta mensagem é a resposta.
  if (!opcoes.naoEhRespostaFornecedor && (await repassarRespostaDoComprador(contato.id, texto))) return;

  const achado = await pedidoPendente(contato.id);
  // Pedido velho (fora da janela) continua aberto, mas não captura mensagem nova como correção.
  const pendente = achado && (!achado.vencido || CONFIRMACAO.test(texto)) ? achado : undefined;
  if (!pendente && SAUDACAO.test(texto)) {
    await enviar(contato.id, textoBoasVindas());
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
    await interpretarEResponder(pendente.id, { triagem: t });
    return;
  }

  await novaMensagem({ contatoId: contato.id, canal: contato.canal, mensagemId, texto, leitura, t, achado });
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
