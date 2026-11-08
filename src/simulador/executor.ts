// 3.5: roda um cenário de ponta a ponta no banco de teste e junta o rastro.
// O comprador fala pelo canal web (sem o Assistente: o fluxo puro), os fornecedores de
// mentira respondem pelo canal "simulado" seguindo o roteiro de cada persona, e o
// varredor de prazos roda de verdade, com prazos de segundos.
//
// Quem importa este arquivo já precisa ter apontado DATABASE_URL para o banco de teste
// (scripts/simulador.ts faz isso antes de importar).

import { and, asc, eq, sql } from "drizzle-orm";
import { db, conexao } from "../nucleo/db/cliente.ts";
import { contato, cotacao, evento, fornecedor, itemPedido, mapaCotacao, pedido } from "../nucleo/db/schema.ts";
import { aoRegistrarUso, gerarTexto } from "../nucleo/ia/index.ts";
import { receber, registrarCanal, type AdaptadorCanal, type OpcoesEnvio } from "../nucleo/mensagens/index.ts";
import { iniciarVarredor } from "../nucleo/orquestrador/index.ts";
import type { EstadoItem } from "../nucleo/orquestrador/estados.ts";
import type { Comparacao } from "../agentes/comparador/calculo.ts";
import { carregarCatalogo } from "../agentes/interpretador/catalogo.ts";
import { ambienteIaFalsa, iaFalsa, limparIaFalsa, registrarInterpretacao, registrarLeitura, semResposta } from "./ia-falsa.ts";
import { instalarTravaDeRede, zerarContadoresDeRede } from "./rede.ts";
import type { Cenario, CompradorIa, ContextoFala, Gatilho, ItemDaConversa, ItemRastro, MensagemRastro, PersonaCenario, Rastro } from "./cenarios/tipos.ts";

export type OpcoesSimulador = {
  /** IA real (Gemini) no Interpretador, no Extrator e nos outros agentes. Sem isto, a IA falsa responde. */
  ia: boolean;
  /** Intervalo do varredor de prazos, em ms. */
  varredorMs?: number;
  /** Imprime a conversa enquanto roda. */
  verboso?: boolean;
};

/** Padrões de toda rodada: prazos de segundos, busca sem rede, nada pago. O cenário pode sobrescrever. */
export const AMBIENTE_PADRAO: Record<string, string> = {
  PRAZO_MODO: "demo",
  PRAZO_RESPOSTAS_SEG: "20",
  ESPERA_MIN_DESCONTO_SEG: "3",
  MAX_FORNECEDORES: "8",
  BUSCA_MODO: "snapshot",
  SERPER_API_KEY: "",
  PORTAL_TRANSPARENCIA_CHAVE: "",
  SIM_SEM_REDE: "1",
  // A IA falsa espera um pouco, como a real, para as corridas entre mensagens aparecerem.
  SIM_IA_LATENCIA_MS: "300",
};

const TABELAS =
  "item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor, cache_busca";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nunca roda fora de um banco de teste: o nome do banco precisa ter "teste". */
export function conferirBancoDeTeste(url = process.env.DATABASE_URL ?? "") {
  let nome = "";
  try {
    nome = new URL(url).pathname.replace(/^\//, "");
  } catch {
    // URL ilegível: cai na recusa abaixo.
  }
  if (!/teste/i.test(nome)) throw new Error(`O simulador só roda em banco de teste (o nome precisa ter "teste"); DATABASE_URL aponta para "${nome || url}".`);
  return nome;
}

// ---------- Estado da rodada (um cenário por vez) ----------

type Rodada = {
  cenario: Cenario;
  inicio: number;
  mensagens: MensagemRastro[];
  personas: Map<string, PersonaCenario>;
  usados: Map<string, Set<number>>;
  ultimoItem: Map<string, ItemDaConversa>;
  timers: Set<ReturnType<typeof setTimeout>>;
  erros: string[];
  usoIa: { chamadas: number; falhas: number };
  verboso: boolean;
  seq: number;
};

let rodada: Rodada | null = null;
let preparado: { ia: boolean; pararVarredor: () => void; trava: ReturnType<typeof instalarTravaDeRede> } | null = null;

const ENDERECO_COMPRADOR = "sim-comprador";

function anotar(m: Omit<MensagemRastro, "em">) {
  if (!rodada) return;
  const r = { ...m, em: Date.now() - rodada.inicio };
  rodada.mensagens.push(r);
  if (rodada.verboso) {
    const seta = m.direcao === "saida" ? "→" : "←";
    const botoes = m.botoes?.length ? `  [${m.botoes.map((b) => b.rotulo).join("] [")}]` : "";
    console.log(`  ${(r.em / 1000).toFixed(1).padStart(6)}s ${seta} ${m.com.padEnd(14)} ${m.tipo ? `[${m.tipo}] ` : ""}${m.texto.replace(/\s+/g, " ").slice(0, 160)}${botoes}`);
  }
}

async function itemDaConversa(itemPedidoId: number | undefined): Promise<ItemDaConversa | null> {
  if (!itemPedidoId) return null;
  const [i] = await db
    .select({ id: itemPedido.id, descricao: itemPedido.descricao, quantidade: itemPedido.quantidade, unidade: itemPedido.unidade, rodada: itemPedido.rodada })
    .from(itemPedido)
    .where(eq(itemPedido.id, itemPedidoId));
  return i ? { ...i, quantidade: Number(i.quantidade) } : null;
}

function agendar(ms: number, fn: () => Promise<void>) {
  const r = rodada;
  if (!r) return;
  const t = setTimeout(() => {
    r.timers.delete(t);
    if (rodada !== r) return; // o cenário acabou
    fn().catch((e) => r.erros.push(`persona: ${e instanceof Error ? e.message : String(e)}`));
  }, ms);
  r.timers.add(t);
}

/** Acha o próximo gatilho do roteiro para a mensagem recebida e agenda as falas, em sequência. */
async function reagir(p: PersonaCenario, texto: string, opcoes: OpcoesEnvio) {
  const r = rodada!;
  const usados = r.usados.get(p.chave) ?? new Set<number>();
  r.usados.set(p.chave, usados);
  const tipo = opcoes.tipo ?? "sem_tipo";
  const idx = p.roteiro.findIndex((g: Gatilho, i) => (g.sempre || !usados.has(i)) && g.ao === tipo && (!g.texto || g.texto.test(texto)));
  if (idx < 0) return;
  usados.add(idx);
  const item = (await itemDaConversa(opcoes.itemPedidoId)) ?? r.ultimoItem.get(p.chave) ?? null;
  if (!item) return;
  r.ultimoItem.set(p.chave, item);
  const ctx: ContextoFala = { item, persona: p, recebida: { texto, tipo: opcoes.tipo, botoes: opcoes.botoes } };
  let atraso = 0;
  for (const fala of p.roteiro[idx]!.falas) {
    atraso += Math.max(0.3, fala.atrasoSeg) * 1000;
    agendar(atraso, async () => {
      // O item pode ter mudado de rodada até aqui (negociação): relê.
      const atual = (await itemDaConversa(item.id)) ?? item;
      const e = fala.escrever({ ...ctx, item: atual });
      if (!e) return;
      if (e.leitura) registrarLeitura(e.texto, e.leitura);
      anotar({ com: p.chave, direcao: "entrada", texto: e.botao ? `[botão ${e.botao}]` : e.texto });
      await receber({ canal: "simulado", endereco: p.chave, idExterno: `cen-${Date.now()}-${++r.seq}`, texto: e.texto, botao: e.botao });
    });
  }
}

const adaptadorFornecedores: AdaptadorCanal = {
  canal: "simulado",
  async enviar(endereco, texto, opcoes) {
    if (rodada) {
      anotar({ com: endereco, direcao: "saida", texto, tipo: opcoes.tipo, botoes: opcoes.botoes });
      const p = rodada.personas.get(endereco);
      if (p) reagir(p, texto, opcoes).catch((e) => rodada?.erros.push(`reagir: ${e instanceof Error ? e.message : String(e)}`));
    }
    return { idExterno: `cen-out-${Date.now()}` };
  },
};

const adaptadorComprador: AdaptadorCanal = {
  canal: "web",
  async enviar(_endereco, texto, opcoes) {
    anotar({ com: "comprador", direcao: "saida", texto, tipo: opcoes.tipo, botoes: opcoes.botoes });
    return { idExterno: `cen-web-${Date.now()}` };
  },
};

/**
 * Uma vez por processo: ambiente, trava de rede (com a IA falsa ou o Gemini liberado),
 * migrações, fluxos e varredor.
 */
export async function prepararSimulador(o: OpcoesSimulador) {
  if (preparado) return preparado;
  conferirBancoDeTeste();
  for (const [k, v] of Object.entries(AMBIENTE_PADRAO)) process.env[k] = v;
  if (!o.ia) ambienteIaFalsa();
  const trava = instalarTravaDeRede(o.ia ? { permitirGemini: true } : { iaFalsa });
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  // O núcleo grava o uso de IA em uso_ia ao ser importado; os fluxos ligam os agentes aos estados.
  await import("../nucleo/index.ts");
  const { ligarFluxos } = await import("../fluxo/index.ts");
  registrarCanal(adaptadorFornecedores);
  registrarCanal(adaptadorComprador);
  ligarFluxos();
  aoRegistrarUso((u) => {
    if (!rodada) return;
    rodada.usoIa.chamadas++;
    if (!u.ok) rodada.usoIa.falhas++;
  });
  const pararVarredor = iniciarVarredor(o.varredorMs ?? 1000);
  preparado = { ia: o.ia, pararVarredor, trava };
  return preparado;
}

export async function encerrarSimulador() {
  preparado?.pararVarredor();
  preparado = null;
  await esperar(300);
  await conexao.end();
}

async function limparBanco() {
  await conexao.unsafe(`truncate ${TABELAS} restart identity cascade`);
  await carregarCatalogo();
}

async function semearFornecedores(personas: PersonaCenario[]) {
  for (const p of personas) {
    const [f] = await db.insert(fornecedor).values({ chave: p.chave, nome: p.nome, origem: "simulado", regiao: "Cenário do simulador", fonte: "Simulador (cenário)" }).returning({ id: fornecedor.id });
    await db.insert(contato).values({ canal: "simulado", endereco: p.chave, papel: "fornecedor", fornecedorId: f!.id, nome: p.nome, avisoPrivacidadeEm: new Date() });
  }
}

async function contatoComprador() {
  const [c] = await db.select().from(contato).where(and(eq(contato.canal, "web"), eq(contato.endereco, ENDERECO_COMPRADOR)));
  return c ?? null;
}

async function itensDoPedido() {
  const c = await contatoComprador();
  if (!c) return { pedido: null, itens: [] as ItemRastro[] };
  const [p] = await db.select({ id: pedido.id, estado: pedido.estado, urgencia: pedido.urgencia }).from(pedido).where(eq(pedido.compradorId, c.id)).orderBy(sql`${pedido.id} desc`).limit(1);
  if (!p) return { pedido: null, itens: [] };
  const itens = await db
    .select({ id: itemPedido.id, descricao: itemPedido.descricao, quantidade: itemPedido.quantidade, unidade: itemPedido.unidade, estado: itemPedido.estado, rodada: itemPedido.rodada })
    .from(itemPedido)
    .where(eq(itemPedido.pedidoId, p.id))
    .orderBy(asc(itemPedido.ordem));
  return { pedido: p, itens: itens.map((i) => ({ ...i, quantidade: Number(i.quantidade) })) };
}

async function aguardar(cond: () => Promise<boolean>, timeoutSeg: number): Promise<boolean> {
  const fim = Date.now() + timeoutSeg * 1000;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await esperar(400);
  }
  return cond();
}

/**
 * 3.3: a IA faz o papel do comprador (uma chamada por mensagem, papel "rapido"). Só na rodada com IA
 * real; na determinística, ou se a chamada falhar, vale a reserva escrita no cenário.
 */
async function falaDoComprador(c: CompradorIa, reserva: string): Promise<string> {
  if (!preparado?.ia) return reserva;
  const conversa = rodada!.mensagens
    .filter((m) => m.com === "comprador")
    .slice(-6)
    .map((m) => `${m.direcao === "saida" ? "Assistente" : "Você"}: ${m.texto.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  try {
    const r = await gerarTexto({
      papel: "rapido",
      sistema:
        "Você faz o papel de um comprador de uma empresa brasileira, escrevendo para o assistente de cotações pelo chat. " +
        "Escreva só a próxima mensagem do comprador, do jeito dele (curta, informal, como no WhatsApp), sem aspas e sem explicar nada. " +
        "Não invente itens nem quantidades além do objetivo.",
      prompt: `Quem você é: ${c.quem}\nO que você quer: ${c.objetivo}${conversa ? `\n\nConversa até aqui:\n${conversa}` : ""}\n\nSua próxima mensagem:`,
      contexto: { agente: "Comprador simulado" },
    });
    const texto = r.valor.trim().replace(/^["“]|["”]$/g, "");
    return texto || reserva;
  } catch (erro) {
    rodada?.erros.push(`comprador por IA: ${erro instanceof Error ? erro.message : String(erro)}`);
    return reserva;
  }
}

async function executarPassos(c: Cenario, falhos: string[]) {
  const r = rodada!;
  const clicados = new Set<string>();
  let n = 0;
  for (const passo of c.passos) {
    if ("diz" in passo || "comprador" in passo) {
      const texto = "diz" in passo ? passo.diz : await falaDoComprador(passo.comprador, passo.reserva);
      if (passo.interpretacao) registrarInterpretacao(texto, passo.interpretacao);
      anotar({ com: "comprador", direcao: "entrada", texto });
      await receber({ canal: "web", endereco: ENDERECO_COMPRADOR, idExterno: `cen-c-${++n}`, texto });
    } else if ("clica" in passo) {
      let alvo: { dado: string; rotulo: string; chave: string } | null = null;
      const achou = await aguardar(async () => {
        for (let i = r.mensagens.length - 1; i >= 0; i--) {
          const m = r.mensagens[i]!;
          if (m.com !== "comprador" || m.direcao !== "saida") continue;
          const b = m.botoes?.find((x) => passo.clica.test(x.rotulo));
          if (b && !clicados.has(`${i}:${b.dado}`)) {
            alvo = { dado: b.dado, rotulo: b.rotulo, chave: `${i}:${b.dado}` };
            return true;
          }
        }
        return false;
      }, passo.timeoutSeg ?? 60);
      if (!achou || !alvo) {
        falhos.push(`botão ${passo.clica} não apareceu`);
        return;
      }
      const a = alvo as { dado: string; rotulo: string; chave: string };
      clicados.add(a.chave);
      anotar({ com: "comprador", direcao: "entrada", texto: `[toca "${a.rotulo}"]` });
      await receber({ canal: "web", endereco: ENDERECO_COMPRADOR, idExterno: `cen-c-${++n}`, texto: "", botao: a.dado });
    } else if ("espera" in passo) {
      const estados = Array.isArray(passo.espera) ? passo.espera : [passo.espera];
      const ok = await aguardar(async () => estados.includes(((await itensDoPedido()).itens[0]?.estado ?? "") as EstadoItem), passo.timeoutSeg ?? 90);
      if (!ok) {
        falhos.push(`item não chegou a ${estados.join("/")} (está em ${(await itensDoPedido()).itens[0]?.estado ?? "nenhum"})`);
        return;
      }
    } else if ("esperaEvento" in passo) {
      const ok = await aguardar(async () => {
        const evs = await db.select({ acao: evento.acao }).from(evento);
        return evs.some((e) => passo.esperaEvento.test(e.acao));
      }, passo.timeoutSeg ?? 90);
      if (!ok) {
        falhos.push(`evento ${passo.esperaEvento} não aconteceu`);
        return;
      }
    } else {
      await esperar(passo.dorme * 1000);
    }
  }
}

/** Espera `seg` segundos sem mensagem nova (no máximo `maxSeg`). */
async function calma(seg: number, maxSeg = 40) {
  const fim = Date.now() + maxSeg * 1000;
  let visto = rodada!.mensagens.length;
  let desde = Date.now();
  while (Date.now() < fim) {
    await esperar(300);
    if (rodada!.mensagens.length !== visto) {
      visto = rodada!.mensagens.length;
      desde = Date.now();
    } else if (Date.now() - desde >= seg * 1000) return;
  }
}

async function lerRastro(c: Cenario, falhos: string[]): Promise<Rastro> {
  const r = rodada!;
  const { pedido: p, itens } = await itensDoPedido();
  const chaves = new Map((await db.select({ id: fornecedor.id, chave: fornecedor.chave }).from(fornecedor)).map((f) => [f.id, f.chave ?? f.id]));
  const chave = (id: string) => chaves.get(id) ?? id;
  const eventos = (await db.select().from(evento).orderBy(asc(evento.criadoEm))).map((e) => ({
    agente: e.agente,
    acao: e.acao,
    motivo: e.motivo,
    dados: (e.dados ?? null) as Record<string, unknown> | null,
    fornecedores: (e.fornecedorIds ?? []).map(chave),
    itemPedidoId: e.itemPedidoId,
    paraEstado: e.paraEstado,
    em: e.criadoEm.getTime() - r.inicio,
  }));
  const linha = (l: Comparacao["validas"][number]) => ({
    fornecedor: chave(l.oferta.fornecedorId),
    custo: l.custo,
    alertas: l.alertas,
    motivos: l.motivos,
    negociacao: l.negociacao ?? null,
    aConfirmar: !!l.aConfirmar,
  });
  const mapas = (await db.select().from(mapaCotacao).orderBy(asc(mapaCotacao.criadoEm))).map((m) => {
    const d = m.dados as Comparacao;
    return {
      itemPedidoId: m.itemPedidoId,
      rodada: m.rodada,
      validas: d.validas.map(linha),
      cortadas: d.cortadas.map(linha),
      recomendada: d.vencedora ? chave(d.vencedora.oferta.fornecedorId) : null,
      em: m.criadoEm.getTime() - r.inicio,
    };
  });
  const cotacoes = (await db.select({ f: cotacao.fornecedorId, situacao: cotacao.situacao, rodada: cotacao.rodada }).from(cotacao).orderBy(asc(cotacao.rodada))).map((x) => ({
    fornecedor: chave(x.f),
    situacao: x.situacao,
    rodada: x.rodada,
  }));
  const contatos = (await db.select({ f: contato.fornecedorId, parouEm: contato.parouEm }).from(contato).where(eq(contato.papel, "fornecedor"))).map((x) => ({
    fornecedor: x.f ? chave(x.f) : "?",
    ativo: !x.parouEm,
  }));
  const t = preparado!.trava;
  return {
    cenario: c.chave,
    pedidoId: p?.id ?? null,
    pedidoEstado: p?.estado ?? null,
    pedidoUrgencia: p?.urgencia ?? null,
    itens,
    mensagens: [...r.mensagens],
    eventos,
    mapas,
    cotacoes,
    contatos,
    verdades: Object.fromEntries(c.fornecedores.map((f) => [f.chave, f.verdade])),
    rede: { bloqueadas: t.bloqueadas.map((b) => b.url), geminiReais: t.geminiReais, geminiFalsas: t.geminiFalsas },
    iaSemResposta: [...semResposta],
    usoIa: { ...r.usoIa },
    passosFalhos: falhos,
    erros: [...r.erros],
    duracaoMs: Date.now() - r.inicio,
  };
}

/** Roda um cenário inteiro: limpa o banco, semeia, executa os passos, espera a calma e lê o rastro. */
export async function rodarCenario(c: Cenario, o: OpcoesSimulador): Promise<Rastro> {
  await prepararSimulador(o);
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(c.ambiente ?? {})) {
    antes[k] = process.env[k];
    process.env[k] = v;
  }
  await limparBanco();
  limparIaFalsa();
  zerarContadoresDeRede();
  rodada = {
    cenario: c,
    inicio: Date.now(),
    mensagens: [],
    personas: new Map(c.fornecedores.map((p) => [p.chave, p])),
    usados: new Map(),
    ultimoItem: new Map(),
    timers: new Set(),
    erros: [],
    usoIa: { chamadas: 0, falhas: 0 },
    verboso: !!o.verboso,
    seq: 0,
  };
  const falhos: string[] = [];
  try {
    await semearFornecedores(c.fornecedores);
    await executarPassos(c, falhos);
    await calma(c.calmaSeg ?? 2.5);
    return await lerRastro(c, falhos);
  } catch (erro) {
    rodada.erros.push(`executor: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`);
    return await lerRastro(c, falhos);
  } finally {
    for (const t of rodada.timers) clearTimeout(t);
    rodada = null;
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // Deixa terminar o que o fluxo ainda estava gravando antes do próximo truncate.
    await esperar(800);
  }
}
