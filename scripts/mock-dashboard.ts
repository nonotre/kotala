// Dados FICTÍCIOS para alimentar o dashboard e a memória de fornecedores (X2).
// Tudo aqui é inventado: fornecedores, compradores, pedidos, propostas e compras.
// Só roda num banco cujo nome tenha "mock", e o APAGA inteiro antes de semear.
//
//   DATABASE_URL=postgres://…/kotala_mock node --env-file=.env scripts/mock-dashboard.ts
//
// Segue a regra nova de negociação: depois de toda proposta, o assistente tenta
// negociar (contraproposta aberta). Uns fornecedores baixam, outros mantêm.
// Os mapas são calculados com o comparador de verdade (comparar), e a memória é
// conferida no fim com acharRecompra, como o fluxo faria.

import { sql } from "drizzle-orm";
import { conexao, db } from "../src/nucleo/db/cliente.ts";
import { contato, cotacao, fornecedor, historicoCompra, itemPedido, mapaCotacao, mensagem, oferta, pedido, usoIa } from "../src/nucleo/db/schema.ts";
import type { EstadoItem, EstadoPedido } from "../src/nucleo/orquestrador/estados.ts";
import { baseDeItens, especificacaoEmTexto, type ItemBase } from "../src/agentes/interpretador/base-itens.ts";
import { comparar, formatarBRL, type OfertaComparavel } from "../src/agentes/comparador/calculo.ts";
import { acharRecompra, DIAS_RECOMPRA } from "../src/agentes/memoria/index.ts";

// ---------- Trava ----------

const banco = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!banco.includes("mock")) {
  console.error(`Recusado: o banco "${banco}" não tem "mock" no nome. Este script apaga tudo antes de semear.`);
  process.exit(1);
}

// ---------- Sorteio reprodutível ----------

let semente = 20261107;
const sorte = () => {
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a: number, b: number) => a + sorte() * (b - a);
const inteiro = (a: number, b: number) => Math.floor(entre(a, b + 1));
const um = <T>(xs: readonly T[]) => xs[Math.floor(sorte() * xs.length)]!;
const alguns = <T>(xs: readonly T[], n: number) => [...xs].sort(() => sorte() - 0.5).slice(0, n);
const chance = (p: number) => sorte() < p;
const centavos = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => centavos(v).toFixed(2);

const AGORA = Date.now();
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const em = (ms: number) => new Date(ms);

// ---------- Catálogo fictício ----------

/** Preço unitário de referência (inventado) e faixa de quantidade, por código da base de itens da Ester. */
const PRECOS: Record<string, { preco: number; qtd: [number, number] }> = {
  "ITM-001": { preco: 18, qtd: [20, 120] },
  "ITM-004": { preco: 380, qtd: [2, 12] },
  "ITM-005": { preco: 590, qtd: [2, 8] },
  "ITM-010": { preco: 46, qtd: [10, 60] },
  "ITM-011": { preco: 32, qtd: [10, 60] },
  "ITM-013": { preco: 41, qtd: [10, 40] },
  "ITM-017": { preco: 165, qtd: [3, 20] },
  "ITM-018": { preco: 155, qtd: [3, 20] },
  "ITM-021": { preco: 37, qtd: [40, 300] },
  "ITM-022": { preco: 44, qtd: [20, 150] },
  "ITM-023": { preco: 28, qtd: [20, 120] },
  "ITM-024": { preco: 52, qtd: [30, 200] },
  "ITM-026": { preco: 210, qtd: [5, 30] },
  "ITM-027": { preco: 19, qtd: [5, 40] },
  "ITM-029": { preco: 38, qtd: [10, 50] },
  "ITM-030": { preco: 17, qtd: [20, 100] },
  "ITM-033": { preco: 289, qtd: [3, 25] },
  "ITM-034": { preco: 96, qtd: [5, 30] },
  "ITM-035": { preco: 29, qtd: [20, 120] },
  "ITM-036": { preco: 118, qtd: [10, 50] },
};

/** Setores fictícios e as categorias que costumam pedir. */
const SETORES: Record<string, string[]> = {
  Obras: ["Cimentícios", "Agregados", "Aço e ferragens estruturais", "Madeira"],
  "Manutenção predial": ["Hidráulica", "Tintas", "Ferragens", "Elétrico"],
  Elétrica: ["Elétrico", "Iluminação"],
  Hidráulica: ["Hidráulica"],
  "Segurança do trabalho": ["EPI"],
  Acabamento: ["Tintas", "Cimentícios", "Isolamento térmico"],
  Almoxarifado: ["Ferragens", "EPI", "Madeira"],
};
/** Peso de cada setor no sorteio: Obras pede mais. */
const PESO_SETOR: [string, number][] = [["Obras", 5], ["Manutenção predial", 3], ["Elétrica", 2], ["Hidráulica", 2], ["Segurança do trabalho", 1], ["Acabamento", 2], ["Almoxarifado", 1]];

type FornecedorMock = { chave: string; nome: string; regiao: string; categorias: string[]; fator: number; desconto: number; homologado?: boolean; bloqueado?: string };

/** Fornecedores inventados. `fator` mexe no preço; `desconto` é a chance de baixar quando o assistente negocia. */
const FORNECEDORES: FornecedorMock[] = [
  { chave: "mock-ararinha", nome: "Depósito Ararinha (fictício)", regiao: "Zona Norte", categorias: ["Cimentícios", "Agregados", "Madeira"], fator: 0.97, desconto: 0.7, homologado: true },
  { chave: "mock-boa-obra", nome: "Casa Boa Obra (fictício)", regiao: "Centro", categorias: ["Cimentícios", "Agregados", "Aço e ferragens estruturais", "Ferragens"], fator: 1.03, desconto: 0.8 },
  { chave: "mock-cobre-fio", nome: "Cobre & Fio Materiais Elétricos (fictício)", regiao: "Zona Leste", categorias: ["Elétrico", "Iluminação"], fator: 0.99, desconto: 0.6, homologado: true },
  { chave: "mock-luz-forte", nome: "Luz Forte Distribuidora (fictício)", regiao: "Zona Sul", categorias: ["Elétrico", "Iluminação"], fator: 1.06, desconto: 0.75 },
  { chave: "mock-cano-certo", nome: "Cano Certo Hidráulica (fictício)", regiao: "Zona Oeste", categorias: ["Hidráulica"], fator: 0.98, desconto: 0.55 },
  { chave: "mock-aguas-claras", nome: "Águas Claras Tubos (fictício)", regiao: "Zona Norte", categorias: ["Hidráulica", "Ferragens"], fator: 1.05, desconto: 0.8 },
  { chave: "mock-protege", nome: "Protege EPI (fictício)", regiao: "Centro", categorias: ["EPI"], fator: 1.0, desconto: 0.65, homologado: true },
  { chave: "mock-cor-viva", nome: "Tintas Cor Viva (fictício)", regiao: "Zona Sul", categorias: ["Tintas", "Isolamento térmico"], fator: 1.02, desconto: 0.7 },
  { chave: "mock-ferro-forte", nome: "Ferro Forte Aços (fictício)", regiao: "Zona Leste", categorias: ["Aço e ferragens estruturais", "Ferragens"], fator: 0.96, desconto: 0.5 },
  { chave: "mock-madeireira-ipe", nome: "Madeireira Ipê Amarelo (fictício)", regiao: "Zona Oeste", categorias: ["Madeira", "Isolamento térmico"], fator: 1.01, desconto: 0.7 },
  { chave: "mock-tudo-ja", nome: "Mega Tudo Já Materiais (fictício)", regiao: "Grande SP", categorias: ["Cimentícios", "Agregados", "Tintas", "EPI", "Ferragens", "Hidráulica", "Elétrico"], fator: 1.09, desconto: 0.85 },
  { chave: "mock-atrasildo", nome: "Atrasildo Materiais (fictício)", regiao: "Zona Leste", categorias: ["Cimentícios", "Agregados", "Hidráulica"], fator: 0.93, desconto: 0.6, bloqueado: "Atrasou a entrega duas vezes sem avisar (fictício)." },
];

const COMPRADORES = ["Marina Obras (fictícia)", "Rui Manutenção (fictício)", "Sônia Almoxarifado (fictícia)"];
const PAGAMENTOS: [string, number][] = [["à vista no PIX", 0], ["boleto 28 dias", 28], ["boleto 30/60 dias", 45], ["boleto 21 dias", 21]];

// ---------- Limpa o banco mock ----------

const tabelas = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
const nomes = [...tabelas].map((t) => `"${t.tablename}"`).join(", ");
if (nomes) await db.execute(sql.raw(`truncate ${nomes} restart identity cascade`));
console.log(`Banco ${banco} limpo.`);

// ---------- Fornecedores, contatos e compradores ----------

const base = new Map(baseDeItens().map((i) => [i.id, i]));
const itensUsados = Object.keys(PRECOS).map((id) => base.get(id)).filter((i): i is ItemBase => !!i);
if (itensUsados.length < Object.keys(PRECOS).length) console.warn("Aviso: faltam itens da base (src/dados/itens.json); seguem só os encontrados.");

const forn = new Map<string, FornecedorMock & { id: string; contatoId: string }>();
for (const f of FORNECEDORES) {
  const [linha] = await db
    .insert(fornecedor)
    .values({
      chave: f.chave,
      nome: f.nome,
      origem: "simulado",
      regiao: f.regiao,
      homologado: !!f.homologado,
      fonte: "Base fictícia (mock do dashboard)",
      criadoEm: em(AGORA - 120 * DIA),
    })
    .returning({ id: fornecedor.id });
  const [ct] = await db
    .insert(contato)
    .values({ canal: "simulado", endereco: `${f.chave}`, papel: "fornecedor", fornecedorId: linha!.id, nome: f.nome, criadoEm: em(AGORA - 120 * DIA) })
    .returning({ id: contato.id });
  forn.set(f.chave, { ...f, id: linha!.id, contatoId: ct!.id });
}
const compradores: string[] = [];
for (const [i, nome] of COMPRADORES.entries()) {
  const [ct] = await db.insert(contato).values({ canal: "simulado", endereco: `mock-comprador-${i + 1}`, papel: "comprador", nome, criadoEm: em(AGORA - 120 * DIA) }).returning({ id: contato.id });
  compradores.push(ct!.id);
}

const vendem = (categoria: string) => [...forn.values()].filter((f) => f.categorias.includes(categoria));

// ---------- Contadores ----------

let nMensagens = 0;
let nOfertas = 0;
let nNegociadas = 0;
let nHistorico = 0;
const msg = async (v: { direcao: "entrada" | "saida"; contatoId: string; texto: string; quando: number; pedidoId?: number; itemPedidoId?: number }) => {
  nMensagens++;
  await db.insert(mensagem).values({ canal: "simulado", direcao: v.direcao, contatoId: v.contatoId, texto: v.texto, pedidoId: v.pedidoId, itemPedidoId: v.itemPedidoId, situacao: v.direcao === "entrada" ? "recebida" : "enviada", criadoEm: em(v.quando) });
};
const ia = async (papel: string, quando: number, pedidoId: number, itemPedidoId?: number) =>
  db.insert(usoIa).values({ papel, rota: "mock", modelo: "mock (fictício)", ok: chance(0.96), tentativa: 1, tokensEntrada: inteiro(600, 2400), tokensSaida: inteiro(80, 500), duracaoMs: inteiro(700, 4200), pedidoId, itemPedidoId, criadoEm: em(quando) });

// ---------- Pedidos ----------

/** Sorteia o setor pelo peso. */
function setor(): string {
  const total = PESO_SETOR.reduce((t, [, p]) => t + p, 0);
  let r = sorte() * total;
  for (const [s, p] of PESO_SETOR) if ((r -= p) < 0) return s;
  return "Obras";
}

/** Estado do pedido pela idade: os antigos já fecharam; os de hoje ainda estão começando. */
function estadoPedido(diasAtras: number): EstadoPedido {
  if (chance(0.07)) return "cancelado";
  if (diasAtras < 3) return chance(0.4) ? "aguardando_confirmacao" : "em_andamento";
  if (diasAtras < 14) return chance(0.5) ? "em_andamento" : "concluido";
  if (chance(0.06)) return "aguardando_confirmacao"; // esquecido: vira atraso
  return chance(0.9) ? "concluido" : "em_andamento";
}

/** Onde para um item de pedido em andamento. */
const ABERTOS: EstadoItem[] = ["na_fila", "cotando", "aguardando_decisao", "pedido_enviado", "confirmado"];

const TOTAL_PEDIDOS = 64;
const datas = Array.from({ length: TOTAL_PEDIDOS }, () => AGORA - entre(0.2, DIAS_RECOMPRA - 1) * DIA).sort((a, b) => a - b);
/** Compras confirmadas já gravadas, para o comparador saber quem é "conhecido". */
const historicoAte = new Map<string, number>();

for (const criado of datas) {
  const diasAtras = (AGORA - criado) / DIA;
  const st = setor();
  const estado = estadoPedido(diasAtras);
  const prazoMax = um([7, 10, 10, 15, 15, 20, 30]);
  const comprador = um(compradores);
  const categoriasDoSetor = SETORES[st]!;
  const candidatos = itensUsados.filter((i) => categoriasDoSetor.includes(i.categoria));
  const itens = alguns(candidatos.length ? candidatos : itensUsados, inteiro(1, Math.min(3, candidatos.length || 1)));
  const qtds = itens.map((i) => {
    const [a, b] = PRECOS[i.id]!.qtd;
    return Math.round(entre(a, b) / 5) * 5 || a;
  });
  const texto = `Preciso para o setor ${st}: ${itens.map((i, k) => `${qtds[k]} ${i.unidade_compra} de ${i.descricao}`).join("; ")}. Prazo de ${prazoMax} dias.`;

  const [p] = await db
    .insert(pedido)
    .values({
      estado,
      canalOrigem: "simulado",
      compradorId: comprador,
      textoOriginal: texto,
      destino: "Obra fictícia, Rua das Amostras, 100",
      cep: "01310-100",
      modoEntrega: "entrega",
      setor: st,
      prazoTexto: `${prazoMax} dias`,
      prazoMaxDias: prazoMax,
      urgencia: chance(0.1) ? "urgente" : "normal",
      motivoCancelamento: estado === "cancelado" ? um(["O solicitante desistiu da compra (fictício).", "Compra feita por outro setor (fictício).", "Obra adiada (fictício)."]) : null,
      criadoEm: em(criado),
      atualizadoEm: em(criado),
    })
    .returning({ id: pedido.id });
  const pedidoId = p!.id;
  await msg({ direcao: "entrada", contatoId: comprador, texto, quando: criado, pedidoId });
  await ia("interpretador", criado + MIN, pedidoId);
  await msg({ direcao: "saida", contatoId: comprador, texto: `Pedido ${pedidoId}: entendi assim, confirma?`, quando: criado + 2 * MIN, pedidoId });

  let fimPedido = criado;
  for (const [ordem, base_] of itens.entries()) {
    const qtd = qtds[ordem]!;
    // Estado do item a partir do estado do pedido.
    let estadoItem: EstadoItem;
    if (estado === "cancelado") estadoItem = "cancelado";
    else if (estado === "aguardando_confirmacao") estadoItem = "na_fila";
    else if (estado === "concluido") estadoItem = chance(0.06) ? "sem_proposta" : "confirmado";
    else estadoItem = ordem === 0 ? um(ABERTOS.slice(1)) : um(ABERTOS);

    const [it] = await db
      .insert(itemPedido)
      .values({
        pedidoId,
        ordem: ordem + 1,
        estado: estadoItem,
        descricao: base_.descricao,
        itemChave: base_.id,
        quantidade: String(qtd),
        unidade: base_.unidade_compra,
        especificacao: especificacaoEmTexto(base_),
        criadoEm: em(criado),
        atualizadoEm: em(criado),
      })
      .returning({ id: itemPedido.id });
    const itemId = it!.id;
    const temMapa: EstadoItem[] = ["aguardando_decisao", "aprovado", "pedido_enviado", "confirmado"];
    const cotou = temMapa.includes(estadoItem) || estadoItem === "cotando";
    if (!cotou) continue;

    // Rodada 1: pedido de cotação aos fornecedores da categoria (o bloqueado só até ser bloqueado).
    const t0 = criado + inteiro(10, 60) * MIN;
    const consultados = alguns(vendem(base_.categoria).filter((f) => !f.bloqueado || diasAtras > 30), inteiro(3, 5));
    const ref = PRECOS[base_.id]!.preco;
    type Proposta = { fornecedor: (typeof consultados)[number]; cotacaoId: string; ofertaId: string; unit: number; frete: number; prazo: number; pagamento: [string, number]; quando: number; rodada: number; anterior: number | null };
    const r1: Proposta[] = [];
    for (const f of consultados) {
      const [c] = await db
        .insert(cotacao)
        .values({ itemPedidoId: itemId, fornecedorId: f.id, contatoId: f.contatoId, rodada: 1, situacao: "aguardando", enviadaEm: em(t0), criadoEm: em(t0) })
        .returning({ id: cotacao.id });
      await msg({ direcao: "saida", contatoId: f.contatoId, texto: `Cotação: ${qtd} ${base_.unidade_compra} de ${base_.descricao}. Preço, frete, prazo e pagamento?`, quando: t0, itemPedidoId: itemId });
      if (estadoItem === "cotando" && chance(0.5)) continue; // ainda não respondeu
      if (chance(0.12)) {
        await db.update(cotacao).set({ situacao: "sem_resposta" }).where(sql`${cotacao.id} = ${c!.id}`);
        continue;
      }
      const quando = t0 + inteiro(1, 20) * HORA;
      const unit = centavos(ref * f.fator * entre(0.94, 1.14));
      const frete = chance(0.15) ? 0 : centavos(entre(40, 260));
      const prazo = chance(0.1) ? prazoMax + inteiro(2, 6) : inteiro(2, Math.min(12, prazoMax));
      const pagamento = um(PAGAMENTOS);
      const [o] = await db
        .insert(oferta)
        .values({
          itemPedidoId: itemId, fornecedorId: f.id, cotacaoId: c!.id, rodada: 1, itemOferecido: base_.descricao, itemExato: true,
          precoUnitario: reais(unit), totalProduto: reais(unit * qtd), frete: reais(frete), origemFrete: "informado", prazoDias: prazo, validadeDias: 7,
          pagamento: pagamento[0], prazoPagamentoDias: pagamento[1], impostosValor: "0", entregaNoLocal: true, formato: "texto", criadoEm: em(quando),
        })
        .returning({ id: oferta.id });
      nOfertas++;
      await db.update(cotacao).set({ situacao: "respondeu", respondeuEm: em(quando) }).where(sql`${cotacao.id} = ${c!.id}`);
      await msg({ direcao: "entrada", contatoId: f.contatoId, texto: `${formatarBRL(unit)} por ${base_.unidade_compra}, frete ${formatarBRL(frete)}, entrega em ${prazo} dias, ${pagamento[0]}.`, quando, itemPedidoId: itemId });
      await ia("extrator", quando + MIN, pedidoId, itemId);
      r1.push({ fornecedor: f, cotacaoId: c!.id, ofertaId: o!.id, unit, frete, prazo, pagamento, quando, rodada: 1, anterior: null });
    }
    if (estadoItem === "cotando" || !r1.length) {
      if (temMapa.includes(estadoItem) && !r1.length) await db.update(itemPedido).set({ estado: "sem_proposta" }).where(sql`${itemPedido.id} = ${itemId}`);
      continue;
    }

    const paraComparar = (ps: Proposta[]): OfertaComparavel[] =>
      ps.map((x) => ({
        id: x.ofertaId, fornecedorId: x.fornecedor.id, fornecedorNome: x.fornecedor.nome, simulado: true, verificado: false, homologado: !!x.fornecedor.homologado,
        conhecido: (historicoAte.get(x.fornecedor.id) ?? Infinity) < x.quando, itemOferecido: base_.descricao, itemExato: true,
        precoUnitario: x.unit, totalProduto: centavos(x.unit * qtd), frete: x.frete, impostosValor: 0, impostosNaoInclusos: null, prazoDias: x.prazo, validadeDias: 7,
        pagamento: x.pagamento[0], prazoPagamentoDias: x.pagamento[1], entregaNoLocal: true, precoConfirmado: false, rodada: x.rodada, produtoAnterior: x.anterior,
      }));
    const itemCmp = { quantidade: qtd, aceitaSimilar: false, prazoMaxDias: prazoMax, modoEntrega: "entrega" as const, urgencia: "normal" as const };

    const mapa1 = comparar(itemCmp, paraComparar(r1), ref);
    const tMapa1 = Math.max(...r1.map((x) => x.quando)) + 15 * MIN;
    await db.insert(mapaCotacao).values({ itemPedidoId: itemId, rodada: 1, dados: mapa1, recomendacao: "Mapa da primeira rodada (fictício). Antes de fechar, o assistente negocia com quem respondeu.", ofertaRecomendadaId: mapa1.vencedora?.oferta.id ?? null, criadoEm: em(tMapa1) });

    // Rodada 2: negociação aberta com todo fornecedor que mandou proposta válida.
    const validos = new Set(mapa1.validas.map((l) => l.oferta.fornecedorId));
    const finais: Proposta[] = [];
    for (const x of r1) {
      if (!validos.has(x.fornecedor.id)) {
        finais.push(x);
        continue;
      }
      const tNeg = tMapa1 + inteiro(1, 10) * MIN;
      const [c2] = await db
        .insert(cotacao)
        .values({ itemPedidoId: itemId, fornecedorId: x.fornecedor.id, contatoId: x.fornecedor.contatoId, rodada: 2, situacao: "aguardando", enviadaEm: em(tNeg), criadoEm: em(tNeg) })
        .returning({ id: cotacao.id });
      await msg({ direcao: "saida", contatoId: x.fornecedor.contatoId, texto: "Obrigado pela proposta! Antes de fechar: consegue melhorar o preço ou as condições? Se preferir manter, ela continua valendo.", quando: tNeg, itemPedidoId: itemId });
      await ia("negociador", tNeg - MIN, pedidoId, itemId);
      const quando = tNeg + inteiro(1, 8) * HORA;
      if (chance(x.fornecedor.desconto)) {
        const unit = centavos(x.unit * (1 - entre(0.02, 0.12)));
        const melhorouPrazo = chance(0.25) ? Math.max(1, x.prazo - inteiro(1, 3)) : x.prazo;
        const [o2] = await db
          .insert(oferta)
          .values({
            itemPedidoId: itemId, fornecedorId: x.fornecedor.id, cotacaoId: c2!.id, rodada: 2, itemOferecido: base_.descricao, itemExato: true,
            precoUnitario: reais(unit), totalProduto: reais(unit * qtd), frete: reais(x.frete), origemFrete: "informado", prazoDias: melhorouPrazo, validadeDias: 7,
            pagamento: x.pagamento[0], prazoPagamentoDias: x.pagamento[1], impostosValor: "0", entregaNoLocal: true, formato: "texto", criadoEm: em(quando),
          })
          .returning({ id: oferta.id });
        nOfertas++;
        nNegociadas++;
        await db.update(cotacao).set({ situacao: "respondeu", respondeuEm: em(quando) }).where(sql`${cotacao.id} = ${c2!.id}`);
        await msg({ direcao: "entrada", contatoId: x.fornecedor.contatoId, texto: `Consigo fazer ${formatarBRL(unit)} por ${base_.unidade_compra}${melhorouPrazo < x.prazo ? ` e entrego em ${melhorouPrazo} dias` : ""}.`, quando, itemPedidoId: itemId });
        finais.push({ ...x, cotacaoId: c2!.id, ofertaId: o2!.id, unit, prazo: melhorouPrazo, quando, rodada: 2, anterior: centavos(x.unit * qtd) });
      } else {
        await db.update(cotacao).set({ situacao: chance(0.5) ? "respondeu" : "sem_resposta", respondeuEm: em(quando) }).where(sql`${cotacao.id} = ${c2!.id}`);
        if (chance(0.5)) await msg({ direcao: "entrada", contatoId: x.fornecedor.contatoId, texto: "Esse já é o melhor preço, mantenho a proposta.", quando, itemPedidoId: itemId });
        finais.push(x);
      }
    }

    const mapa2 = comparar(itemCmp, paraComparar(finais), ref);
    const tMapa2 = Math.max(...finais.map((x) => x.quando)) + 15 * MIN;
    const vencedora = mapa2.vencedora;
    const recomendacao = vencedora
      ? `Recomendo ${vencedora.oferta.fornecedorNome}: total ${formatarBRL(vencedora.custo!)}, entrega em ${vencedora.oferta.prazoDias} dias, nota ${vencedora.nota}. (fictício)`
      : "Nenhuma proposta válida. (fictício)";
    await db.insert(mapaCotacao).values({ itemPedidoId: itemId, rodada: 2, dados: mapa2, recomendacao, ofertaRecomendadaId: vencedora?.oferta.id ?? null, criadoEm: em(tMapa2) });
    await ia("comparador", tMapa2 - MIN, pedidoId, itemId);
    await msg({ direcao: "saida", contatoId: comprador, texto: `Pedido ${pedidoId}: mapa de ${base_.descricao} pronto. ${recomendacao}`, quando: tMapa2, pedidoId, itemPedidoId: itemId });

    if (!vencedora) {
      await db.update(itemPedido).set({ estado: "sem_proposta", rodada: 2, atualizadoEm: em(tMapa2) }).where(sql`${itemPedido.id} = ${itemId}`);
      continue;
    }
    const escolhida = finais.find((x) => x.ofertaId === vencedora.oferta.id)!;
    const decidido = estadoItem !== "aguardando_decisao";
    const tAprova = tMapa2 + inteiro(10, 240) * MIN;
    const tConfirma = tAprova + inteiro(1, 30) * HORA;
    let fim = decidido ? (estadoItem === "confirmado" ? tConfirma : tAprova) : tMapa2;
    // Não deixa o futuro vazar: quem ainda não chegou lá fica um passo antes.
    if (fim > AGORA) fim = AGORA - inteiro(1, 30) * MIN;
    await db
      .update(itemPedido)
      .set({ rodada: 2, fornecedorEscolhidoId: decidido ? escolhida.fornecedor.id : null, ofertaEscolhidaId: decidido ? escolhida.ofertaId : null, atualizadoEm: em(fim) })
      .where(sql`${itemPedido.id} = ${itemId}`);
    fimPedido = Math.max(fimPedido, fim);

    if (estadoItem === "confirmado") {
      await msg({ direcao: "saida", contatoId: escolhida.fornecedor.contatoId, texto: `Pedido de compra: ${qtd} ${base_.unidade_compra} de ${base_.descricao}. Pode confirmar o fornecimento?`, quando: tAprova, itemPedidoId: itemId });
      await msg({ direcao: "entrada", contatoId: escolhida.fornecedor.contatoId, texto: "Confirmo.", quando: fim, itemPedidoId: itemId });
      // Memória (X2): o que o fluxo grava quando o vencedor confirma, mais o desfecho da entrega.
      const entregaEm = fim + escolhida.prazo * DIA;
      const avaliado = entregaEm < AGORA;
      const atrasou = escolhida.fornecedor.bloqueado ? true : avaliado && chance(0.1);
      await db.insert(historicoCompra).values({
        fornecedorId: escolhida.fornecedor.id,
        itemChave: base_.id,
        descricao: base_.descricao,
        precoUnitario: reais(escolhida.unit),
        quantidade: String(qtd),
        frete: reais(escolhida.frete),
        data: em(fim),
        prazoPrometidoDias: escolhida.prazo,
        prazoCumprido: avaliado || escolhida.fornecedor.bloqueado ? !atrasou : null,
        experiencia: atrasou ? `Entregou ${inteiro(2, 6)} dias depois do combinado e não avisou (fictício).` : avaliado && chance(0.2) ? "Entrega no prazo, material conferido (fictício)." : null,
        simulado: true,
        itemPedidoId: itemId,
        criadoEm: em(fim),
      });
      nHistorico++;
      if (!historicoAte.has(escolhida.fornecedor.id)) historicoAte.set(escolhida.fornecedor.id, fim);
    }
  }
  await db.update(pedido).set({ atualizadoEm: em(fimPedido) }).where(sql`${pedido.id} = ${pedidoId}`);
}

// Fornecedor bloqueado: entra na lista de bloqueio há 20 dias.
const bloqueado = [...forn.values()].find((f) => f.bloqueado)!;
await db.update(fornecedor).set({ bloqueadoEm: em(AGORA - 20 * DIA), motivoBloqueio: bloqueado.bloqueado }).where(sql`${fornecedor.id} = ${bloqueado.id}`);

// Compra antiga (fora da janela de 90 dias): a memória não pode usá-la para recompra.
const antigo = forn.get("mock-madeireira-ipe")!;
await db.insert(historicoCompra).values({
  fornecedorId: antigo.id, itemChave: "ITM-MOCK-ANTIGO", descricao: "Caibro de eucalipto 5 x 6 cm (fictício)", precoUnitario: "21.90", quantidade: "80", frete: "90.00",
  data: em(AGORA - 120 * DIA), prazoPrometidoDias: 5, prazoCumprido: true, simulado: true, criadoEm: em(AGORA - 120 * DIA),
});
nHistorico++;

// ---------- Resumo ----------

const [r] = await db.execute<{ pedidos: number; itens: number; confirmados: number; cotacoes: number }>(sql`
  select (select count(*)::int from pedido) pedidos, (select count(*)::int from item_pedido) itens,
         (select count(*)::int from item_pedido where estado = 'confirmado') confirmados, (select count(*)::int from cotacao) cotacoes`);
console.log(`Semeado: ${r!.pedidos} pedidos, ${r!.itens} itens (${r!.confirmados} confirmados), ${r!.cotacoes} cotações, ${nOfertas} propostas (${nNegociadas} baixaram na negociação), ${nHistorico} compras na memória, ${nMensagens} mensagens.`);

// ---------- Conferência da memória de fornecedores (X2) ----------

console.log("\nMemória de fornecedores (acharRecompra), item por item:");
let falhas = 0;
const conferir = (ok: boolean, texto: string) => {
  console.log(`  ${ok ? "ok " : "ERRO"} ${texto}`);
  if (!ok) falhas++;
};
const historico = await db.select().from(historicoCompra);
const porItem = new Map<string, typeof historico>();
for (const h of historico) porItem.set(h.itemChave, [...(porItem.get(h.itemChave) ?? []), h]);

for (const [chave, hs] of [...porItem].sort()) {
  const desc = hs[0]!.descricao;
  const rec = await acharRecompra({ itemChave: chave, descricao: desc });
  const elegiveis = hs
    .filter((h) => h.data.getTime() >= AGORA - DIAS_RECOMPRA * DIA && h.prazoCumprido !== false && h.fornecedorId !== bloqueado.id)
    .sort((a, b) => b.data.getTime() - a.data.getTime());
  const esperado = elegiveis[0] ?? null;
  if (!esperado) {
    conferir(rec === null, `${chave} ${desc}: sem compra elegível nos últimos ${DIAS_RECOMPRA} dias → cota de novo`);
    continue;
  }
  conferir(
    rec?.historicoId === esperado.id,
    `${chave} ${desc}: recompra com ${rec?.fornecedorNome ?? "—"} a ${rec ? formatarBRL(rec.precoUnitario) : "—"} em ${rec?.data.toLocaleDateString("pt-BR") ?? "—"} (${rec?.comprasNoPeriodo ?? 0}× no período)`,
  );
  if (rec) {
    conferir(rec.fornecedorId !== bloqueado.id, `   não sugere o bloqueado (${bloqueado.nome})`);
    conferir(rec.prazoCumprido !== false, "   não sugere compra que atrasou");
  }
}

const doBloqueado = historico.filter((h) => h.fornecedorId === bloqueado.id);
console.log(`\n${bloqueado.nome}: ${doBloqueado.length} compras na memória, todas com atraso registrado; bloqueado há 20 dias.`);
const [conf] = await db.execute<{ nome: string; compras: number; cumpridos: number; avaliados: number }>(sql`
  select f.nome, count(*)::int compras, count(*) filter (where h.prazo_cumprido)::int cumpridos, count(h.prazo_cumprido)::int avaliados
  from historico_compra h join fornecedor f on f.id = h.fornecedor_id group by f.nome order by compras desc limit 1`);
if (conf) console.log(`Quem mais vendeu: ${conf.nome}, ${conf.compras} compras, ${conf.cumpridos}/${conf.avaliados} prazos cumpridos (entra na confiança do Q8).`);

console.log(falhas ? `\n${falhas} conferência(s) falharam.` : "\nMemória conferida: todas as recompras batem com o histórico.");
await conexao.end();
process.exit(falhas ? 1 : 0);
