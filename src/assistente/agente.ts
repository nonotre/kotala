// O turno do Assistente: cartão de estado + histórico + ferramentas de leitura, num laço curto de
// chamadas ao Gemini. Ele responde perguntas, oferece botões de ação (os mesmos `dado` do fluxo) e
// links para as telas, ou devolve "encaminhar" para o fluxo de pedidos de hoje cuidar da mensagem.
// Nada aqui escreve no banco: por isso o turno pode ser repetido em outro modelo quando a cota estoura.

import { generateText, hasToolCall, isStepCount, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { formatarBRL } from "../agentes/comparador/index.ts";
import { timeoutMs } from "../nucleo/ia/config.ts";
import { executarAgente } from "../nucleo/ia/index.ts";
import { INSTRUCOES, regrasDeCompra, textoDoCartao } from "./instrucoes.ts";
import { botaoLink, type Botao, type CartaoEstado, type ChamadaFerramenta, type Consultas, type ContextoAssistente, type EntradaAssistente, type OpcoesAssistente, type RespostaAssistente } from "./tipos.ts";
import { citadosPeloComprador, coletar, linkInternoValido, validarResposta, type Conhecidos } from "./validador.ts";

const MAX_PASSOS = 6;
const MAX_ACOES = 4;
const MAX_LINKS = 3;
const MAX_HISTORICO = 12;

/**
 * Mensagem longa (várias perguntas ou um pedido complicado) começa no modelo forte. Fora isso, o forte
 * só entra quando a resposta do rápido é reprovada na conferência: na avaliação de 08/11/2026, o
 * 3.5-flash-lite acertou 31/35 em 1,7 s e o 3.8-flash 30/35 em 6,6 s (docs/frente-3-harness.md).
 */
export function pedeModeloForte(texto: string): boolean {
  return texto.length > 280;
}

type EstadoTurno = {
  ctx: ContextoAssistente;
  consultas: Consultas;
  /** Tudo o que as ferramentas devolveram: base do validador. */
  dados: unknown[];
  botoesAcao: Botao[];
  botoesLink: Botao[];
  chamadas: ChamadaFerramenta[];
};

const ACOES = [
  "confirmar_pedido",
  "corrigir_pedido",
  "cancelar_pedido",
  "aprovar_oferta",
  "escolher_outra_proposta",
  // Negociar, buscar mais e cotar de novo mandam mensagem a fornecedores: só pelo menu de motivos de "reprovar", como no fluxo.
  "reprovar",
  "desistir_do_item",
  "repetir_compra",
  "cotar_em_vez_de_repetir",
] as const;
type Acao = (typeof ACOES)[number];

/** Ação → botão do fluxo de hoje (fluxo/comprador.ts e fluxo/decisao.ts), conferindo estado e dono. */
async function montarAcao(e: EstadoTurno, a: { acao: Acao; pedidoId: number; itemId?: number; ofertaId?: string }): Promise<{ ok: true; botao: Botao } | { ok: false; erro: string }> {
  const d = await e.consultas.detalhePedido(e.ctx, a.pedidoId);
  if (!d) return { ok: false, erro: `Pedido ${a.pedidoId} não existe.` };
  e.dados.push(d);
  if (!d.daConversa) {
    const doItem = d.itens.find((i) => i.itemId === a.itemId);
    const href = doItem ? `/pedidos/${d.pedidoId}/decisao#item-${doItem.itemId}` : d.href;
    if (e.botoesLink.length < MAX_LINKS && !e.botoesLink.some((b) => b.dado.endsWith(href))) e.botoesLink.push(botaoLink(`Abrir o pedido ${d.pedidoId}`, href));
    return { ok: false, erro: "Este pedido é de outro comprador, então o botão não vale aqui. Já pus o botão que abre a tela do pedido, onde ele pode decidir com confirmação. Explique isso ao comprador em linguagem simples." };
  }
  const id = d.pedidoId;
  if (a.acao === "confirmar_pedido" || a.acao === "corrigir_pedido") {
    if (d.estado !== "aguardando_confirmacao") return { ok: false, erro: `O pedido ${id} não está esperando confirmação (estado: ${d.estado}).` };
    return { ok: true, botao: a.acao === "confirmar_pedido" ? { rotulo: `Confirmar o pedido ${id}`, dado: `pedido:${id}:confirmar` } : { rotulo: `Corrigir o pedido ${id}`, dado: `pedido:${id}:corrigir` } };
  }
  if (a.acao === "cancelar_pedido") {
    // Depois de confirmado, cancelar o pedido inteiro pode cortar item já comprado sem avisar o fornecedor:
    // aí só pela tela, item por item (desistir_do_item no mapa).
    if (!["interpretando", "aguardando_confirmacao"].includes(d.estado)) return { ok: false, erro: `O pedido ${id} já está em cotação ou terminou: cancelar o pedido inteiro só antes de confirmar. Para um item esperando decisão, use desistir_do_item; para o resto, mande o link da tela do pedido.` };
    return { ok: true, botao: { rotulo: `Cancelar o pedido ${id}`, dado: `pedido:${id}:cancelar` } };
  }
  const item = d.itens.find((i) => i.itemId === a.itemId);
  if (!item) return { ok: false, erro: `Informe o itemId de um item do pedido ${id}: ${d.itens.map((i) => `${i.itemId} (${i.descricao})`).join(", ")}.` };
  const iid = item.itemId;
  if (a.acao === "repetir_compra" || a.acao === "cotar_em_vez_de_repetir") {
    if (item.estado !== "aguardando_recompra") return { ok: false, erro: `O item ${iid} não está esperando a escolha de repetir a compra.` };
    return { ok: true, botao: a.acao === "repetir_compra" ? { rotulo: "Repetir a última compra", dado: `item:${iid}:repetir` } : { rotulo: "Cotar de novo", dado: `item:${iid}:cotar_novo` } };
  }
  if (item.estado !== "aguardando_decisao") return { ok: false, erro: `O item ${iid} não está esperando decisão (estado: ${item.estado}).` };
  switch (a.acao) {
    case "aprovar_oferta": {
      const mapa = await e.consultas.mapaCotacao(e.ctx, iid);
      if (mapa) e.dados.push(mapa);
      const o = mapa?.validas.find((v) => v.ofertaId === a.ofertaId);
      if (!o) return { ok: false, erro: `Oferta inválida. Propostas válidas do item ${iid}: ${(mapa?.validas ?? []).map((v) => `${v.ofertaId} (${v.fornecedor})`).join(", ") || "nenhuma"}.` };
      const custo = o.custoTotal !== null ? ` · ${formatarBRL(o.custoTotal)}` : "";
      return { ok: true, botao: { rotulo: `Aprovar ${o.fornecedor}${o.simulado ? " (simulado)" : ""}${custo}`, dado: `item:${iid}:aprovar:${o.ofertaId}` } };
    }
    case "escolher_outra_proposta":
      return { ok: true, botao: { rotulo: "Escolher outra proposta", dado: `item:${iid}:outras` } };
    case "reprovar":
      return { ok: true, botao: { rotulo: "Reprovar ou negociar (escolher o motivo)", dado: `item:${iid}:motivos` } };
    case "desistir_do_item":
      return { ok: true, botao: { rotulo: "Desistir deste item", dado: `item:${iid}:cancelar` } };
  }
  return { ok: false, erro: "Ação desconhecida." };
}

/** Link pedido pelo modelo: rota da lista fechada e ids que existem. */
async function conferirLink(e: EstadoTurno, href: string): Promise<string | null> {
  const { rotaPermitida } = await import("./tipos.ts");
  if (!rotaPermitida(href)) return "Rota fora da lista. Use o href que veio dos dados.";
  const p = /^\/pedidos\/(\d+)/.exec(href);
  if (p) {
    const d = await e.consultas.detalhePedido(e.ctx, Number(p[1]));
    if (!d) return `Pedido ${p[1]} não existe.`;
    e.dados.push(d);
  }
  const f = /^\/fornecedores\/([0-9a-f-]{36})$/.exec(href);
  if (f) {
    const lista = await e.consultas.fornecedores(e.ctx, { id: f[1] });
    if (!lista.length) return "Fornecedor não existe.";
    e.dados.push(lista);
  }
  return null;
}

function ferramentas(e: EstadoTurno) {
  /** Toda ferramenta passa por aqui: mede, guarda o resultado para o validador e nunca lança. */
  const medir = <A>(nome: string, fn: (args: A) => Promise<unknown>) => async (args: A) => {
    const t0 = performance.now();
    try {
      const r = await fn(args);
      e.dados.push(r);
      e.chamadas.push({ nome, args, ok: true, ms: Math.round(performance.now() - t0) });
      return r ?? { erro: "Não encontrado." };
    } catch (erro) {
      e.chamadas.push({ nome, args, ok: false, ms: Math.round(performance.now() - t0) });
      return { erro: erro instanceof Error ? erro.message : String(erro) };
    }
  };
  const { ctx, consultas: c } = e;
  return {
    listar_pendencias: tool({
      description: "Lista o que espera o comprador agora (pedidos a confirmar, mapas a decidir, recompras, itens sem proposta), obra parada primeiro.",
      inputSchema: z.object({}),
      execute: medir("listar_pendencias", () => c.pendencias(ctx)),
    }),
    buscar_pedidos: tool({
      description: "Procura pedidos por texto (item, setor, fornecedor, número do pedido) e/ou situação. Mais recentes primeiro.",
      inputSchema: z.object({
        texto: z.string().optional().describe("Palavra do item, setor, fornecedor, ou o número do pedido"),
        estado: z.enum(["aberto", "aguardando_voce", "cotando", "concluido", "cancelado", "todos"]).optional(),
      }),
      execute: medir("buscar_pedidos", (a: { texto?: string; estado?: "aberto" | "aguardando_voce" | "cotando" | "concluido" | "cancelado" | "todos" }) => c.buscarPedidos(ctx, { ...a, limite: 10 })),
    }),
    detalhe_pedido: tool({
      description: "Detalhe de um pedido: itens e situação de cada um, fornecedores consultados, entrega, prazo, o que o assistente assumiu.",
      inputSchema: z.object({ pedidoId: z.number().int() }),
      execute: medir("detalhe_pedido", (a: { pedidoId: number }) => c.detalhePedido(ctx, a.pedidoId)),
    }),
    mapa_cotacao: tool({
      description: "Mapa de cotação de um item: propostas válidas com custo total, prazo e nota; propostas cortadas e por quê; recomendação; referência pública da internet.",
      inputSchema: z.object({ itemId: z.number().int() }),
      execute: medir("mapa_cotacao", (a: { itemId: number }) => c.mapaCotacao(ctx, a.itemId)),
    }),
    linha_do_tempo: tool({
      description: "O que aconteceu com um pedido, em ordem: quem fez o quê e por quê. Use para 'por que demorou', 'o que houve'.",
      inputSchema: z.object({ pedidoId: z.number().int() }),
      execute: medir("linha_do_tempo", (a: { pedidoId: number }) => c.linhaDoTempo(ctx, a.pedidoId, 15)),
    }),
    fornecedores: tool({
      description: "Fornecedor por nome, id ou categoria (quem vende; um fornecedor pode ter várias categorias): confiança (nível, pontos, motivos, alertas), homologação, bloqueio, categorias, compras feitas. Sem filtro, lista os mais confiáveis primeiro.",
      inputSchema: z.object({
        nome: z.string().optional(),
        id: z.string().optional(),
        categoria: z.string().optional().describe("Categoria de material, como vem em `categorias` ou no item (ex.: Hidráulica, Cimentícios)"),
      }),
      execute: medir("fornecedores", (a: { nome?: string; id?: string; categoria?: string }) => c.fornecedores(ctx, a)),
    }),
    categorias: tool({
      description: "Categorias de material que a empresa compra, com quantos itens e quantos fornecedores cada uma tem. Use para 'o que vocês cotam?' e para achar o nome certo da categoria.",
      inputSchema: z.object({}),
      execute: medir("categorias", () => c.categorias(ctx)),
    }),
    historico_compras: tool({
      description: "Compras confirmadas de um item: fornecedor, preço por unidade, data, se o prazo foi cumprido.",
      inputSchema: z.object({ texto: z.string().describe("Nome do item, por exemplo 'cimento cp2'") }),
      execute: medir("historico_compras", (a: { texto: string }) => c.historicoCompras(ctx, a.texto)),
    }),
    economia: tool({
      description: "Economia nas compras confirmadas do período, sempre dizendo contra o que compara.",
      inputSchema: z.object({ dias: z.number().int().optional().describe("Período em dias; padrão 30") }),
      execute: medir("economia", (a: { dias?: number }) => c.economia(ctx, a.dias ?? 30)),
    }),
    regras_de_compra: tool({
      description: "Regras de compra da empresa: como a nota é calculada, custo total, portões, preço retido, mínimo de propostas, aprovação, reprovação, prazos, recompra, verificação de fornecedor.",
      inputSchema: z.object({}),
      execute: medir("regras_de_compra", async () => regrasDeCompra()),
    }),
    propor_acao: tool({
      description:
        "Mostra ao comprador um botão de ação do fluxo. Nada acontece até ele tocar; aprovar ainda pede confirmação. Ações de item exigem pedidoId e itemId; aprovar_oferta exige também ofertaId (do mapa_cotacao).",
      inputSchema: z.object({ acao: z.enum(ACOES), pedidoId: z.number().int(), itemId: z.number().int().optional(), ofertaId: z.string().optional() }),
      execute: medir("propor_acao", async (a: { acao: Acao; pedidoId: number; itemId?: number; ofertaId?: string }) => {
        if (e.botoesAcao.length >= MAX_ACOES) return { erro: `No máximo ${MAX_ACOES} botões de ação por resposta.` };
        const r = await montarAcao(e, a);
        if (!r.ok) return { erro: r.erro };
        if (!e.botoesAcao.some((b) => b.dado === r.botao.dado)) e.botoesAcao.push(r.botao);
        return { ok: true, botao: r.botao.rotulo };
      }),
    }),
    botao_link: tool({
      description: "Mostra um botão que abre uma tela do sistema. Use o href que veio dos dados (ex.: /pedidos/12/decisao#item-34, /avisos, /economia).",
      inputSchema: z.object({ rotulo: z.string().max(40), href: z.string() }),
      execute: medir("botao_link", async (a: { rotulo: string; href: string }) => {
        if (e.botoesLink.length >= MAX_LINKS) return { erro: `No máximo ${MAX_LINKS} links por resposta.` };
        const erro = await conferirLink(e, a.href);
        if (erro) return { erro };
        if (!e.botoesLink.some((b) => b.dado.endsWith(a.href))) e.botoesLink.push(botaoLink(a.rotulo, a.href));
        return { ok: true };
      }),
    }),
    // Sem execute: chamar esta ferramenta encerra o turno e a mensagem vai ao fluxo de pedidos.
    encaminhar_ao_fluxo: tool({
      description: "Entrega a mensagem ao fluxo de pedidos: pedido novo de material, correção ou confirmação do pedido em confirmação, resposta a dúvida de fornecedor.",
      inputSchema: z.object({ motivo: z.enum(["pedido_novo", "correcao", "confirmacao", "resposta_fornecedor"]) }),
    }),
  };
}

type ResultadoTurno = {
  encaminhar: string | null;
  texto: string;
  passos: number;
  uso: { inputTokens?: number; outputTokens?: number };
};

async function turno(entrada: EntradaAssistente, cartao: CartaoEstado, consultas: Consultas, forte: boolean, modelos: string[] | undefined) {
  const e: EstadoTurno = { ctx: entrada.ctx, consultas, dados: [cartao], botoesAcao: [], botoesLink: [], chamadas: [] };
  const mensagens: ModelMessage[] = [
    ...entrada.historico.slice(-MAX_HISTORICO).map((m): ModelMessage => (m.papel === "comprador" ? { role: "user", content: m.texto } : { role: "assistant", content: m.texto })),
    { role: "user", content: entrada.texto },
  ];
  const instrucoes = INSTRUCOES + textoDoCartao(cartao, entrada.ctx.agora);
  const r = await executarAgente(
    { papel: forte ? "conversa_forte" : "conversa", modelos, prompt: `[sistema]\n${instrucoes}\n\n[user]\n${entrada.texto}`, contexto: { agente: "Assistente" } },
    async (modelo) => {
      // O turno pode ser repetido em outro modelo: recomeça limpo.
      e.dados = [cartao];
      e.botoesAcao = [];
      e.botoesLink = [];
      e.chamadas = [];
      const g = await generateText({
        model: modelo,
        instructions: instrucoes,
        messages: mensagens,
        tools: ferramentas(e),
        stopWhen: [isStepCount(MAX_PASSOS), hasToolCall("encaminhar_ao_fluxo")],
        // No último passo, só texto: o turno sempre termina com uma resposta.
        prepareStep: ({ stepNumber }) => (stepNumber >= MAX_PASSOS - 1 ? { toolChoice: "none" as const } : {}),
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
        maxRetries: 1,
        // Turno com vários passos: um pouco mais que uma chamada simples; travou, passa ao próximo modelo.
        timeout: { totalMs: Math.round(timeoutMs() * 1.5) },
      });
      const encaminhar = g.steps.flatMap((s) => s.toolCalls).find((t) => t.toolName === "encaminhar_ao_fluxo");
      const valor: ResultadoTurno = {
        encaminhar: encaminhar ? String((encaminhar.input as { motivo?: string }).motivo ?? "pedido_novo") : null,
        texto: g.text.trim(),
        passos: g.steps.length,
        uso: { inputTokens: g.usage.inputTokens, outputTokens: g.usage.outputTokens },
      };
      return { valor, uso: g.usage };
    },
  );
  return { ...r, e };
}

/**
 * O turno falou de um pedido só (consultou detalhe, mapa ou linha do tempo) e não ofereceu botão:
 * põe o link da tela dele. Mapa esperando decisão abre direto a aba de decisão.
 */
function linkDoAssunto(e: EstadoTurno): Botao | null {
  const vistos = new Map<number, string>();
  for (const d of e.dados.slice(1)) {
    const x = d as { pedidoId?: unknown; itemId?: unknown; href?: unknown; estado?: unknown; validas?: unknown };
    if (typeof x?.pedidoId !== "number" || typeof x.href !== "string") continue;
    const decidir = Array.isArray(x.validas) && x.estado === "aguardando_decisao" && typeof x.itemId === "number";
    if (!vistos.has(x.pedidoId) || decidir) vistos.set(x.pedidoId, decidir ? `/pedidos/${x.pedidoId}/decisao#item-${x.itemId as number}` : x.href);
  }
  if (vistos.size !== 1) return null;
  const [pedidoId, href] = [...vistos][0]!;
  return botaoLink(href.includes("/decisao") ? `Decidir no pedido ${pedidoId}` : `Abrir o pedido ${pedidoId}`, href);
}

/** Texto seguro quando a resposta não passou na conferência nem no modelo forte. */
function textoSeguro(e: EstadoTurno, c: Conhecidos): { texto: string; botoes: Botao[] } {
  const links = e.botoesLink.filter((b) => linkInternoValido(b.dado.slice(b.dado.indexOf(":") + 1), c));
  for (const d of e.dados.flat()) {
    if (links.length >= MAX_LINKS) break;
    const x = d as { href?: unknown; pedidoId?: unknown };
    if (typeof x?.href === "string" && typeof x.pedidoId === "number" && !links.some((b) => b.dado.endsWith(x.href as string))) links.push(botaoLink(`Abrir o pedido ${x.pedidoId}`, x.href));
  }
  if (!links.length) return { texto: "Não consegui conferir essa resposta com os dados do sistema, então prefiro não arriscar. Pode perguntar de outro jeito, ou ver em [Pedidos](/pedidos).", botoes: [] };
  return { texto: "Não consegui conferir todos os números dessa resposta, então prefiro não arriscar. Veja direto na tela:", botoes: links };
}

export async function responder(entrada: EntradaAssistente, opcoes: OpcoesAssistente = {}): Promise<RespostaAssistente> {
  const t0 = performance.now();
  const consultas = opcoes.consultas ?? (await import("./consultas.ts")).consultasDoBanco;
  const cartao = await consultas.cartaoDeEstado(entrada.ctx);
  const comecaForte = !opcoes.semEscalar && pedeModeloForte(entrada.texto);
  const modelosDe = (forte: boolean) => (forte ? opcoes.modelos?.forte : opcoes.modelos?.conversa);

  let forte = comecaForte;
  let r = await turno(entrada, cartao, consultas, forte, modelosDe(forte));
  let tokens = { entrada: 0, saida: 0 };
  const somar = (u?: { inputTokens?: number; outputTokens?: number }) => {
    tokens = { entrada: tokens.entrada + (u?.inputTokens ?? 0), saida: tokens.saida + (u?.outputTokens ?? 0) };
  };

  for (let tentativa = 0; ; tentativa++) {
    const { valor } = r;
    somar(valor.uso);
    if (valor.encaminhar) {
      return { tipo: "encaminhar", motivo: valor.encaminhar, ferramentas: r.e.chamadas, modelo: r.modelo, ms: Math.round(performance.now() - t0) };
    }
    if (!r.e.botoesAcao.length && !r.e.botoesLink.length) {
      const link = linkDoAssunto(r.e);
      if (link) r.e.botoesLink.push(link);
    }
    const botoes = [...r.e.botoesAcao, ...r.e.botoesLink];
    // As falas do sistema no histórico também são fonte (o mapa e a aprovação trazem subtotal e valor final).
    // Do comprador, só os números de pedido que ele citou: valor dito por ele não vira verdade.
    const conhecidos = coletar([...r.e.dados, ...entrada.historico.filter((m) => m.papel === "assistente").map((m) => m.texto)]);
    citadosPeloComprador(conhecidos, [...entrada.historico.filter((m) => m.papel === "comprador").map((m) => m.texto), entrada.texto]);
    const v = validarResposta(valor.texto, botoes, conhecidos);
    // Às vezes o modelo termina no passo da ferramenta, sem texto: "Não entendi" ao lado de um botão de
    // aprovar seria pior que nada. Conta como reprovada (tenta no forte; depois, texto seguro sem ação).
    if (!valor.texto && (r.e.chamadas.length || botoes.length)) {
      v.problemas.push("resposta sem texto depois das ferramentas");
      v.ok = false;
    }
    if (!valor.texto && v.ok) v.texto = "Não entendi. Pode dizer de outro jeito?";
    // Reprovou no modelo rápido: uma segunda chance no forte.
    if (!v.ok && !forte && !opcoes.semEscalar && tentativa === 0) {
      forte = true;
      try {
        r = await turno(entrada, cartao, consultas, true, modelosDe(true));
      } catch (erro) {
        // Forte sem cota ou fora do ar: fica com a resposta do rápido, que cai no texto seguro abaixo.
        console.error("[assistente] modelo forte falhou", erro);
        const s2 = textoSeguro(r.e, conhecidos);
        return { tipo: "resposta", texto: s2.texto, botoes: s2.botoes, ferramentas: r.e.chamadas, modelo: r.modelo, escalou: true, validacao: { ok: false, problemas: v.problemas }, tokens, ms: Math.round(performance.now() - t0) };
      }
      continue;
    }
    const seguro = v.ok ? null : textoSeguro(r.e, conhecidos);
    return {
      tipo: "resposta",
      texto: seguro?.texto ?? v.texto,
      botoes: seguro?.botoes ?? botoes,
      ferramentas: r.e.chamadas,
      modelo: r.modelo,
      escalou: forte,
      validacao: { ok: v.ok, problemas: v.problemas },
      tokens,
      ms: Math.round(performance.now() - t0),
    };
  }
}
