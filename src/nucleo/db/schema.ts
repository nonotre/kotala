// N1: modelo de dados. Todo o resto lê e escreve aqui.
// Valores em reais ficam em numeric (string no TypeScript) para não perder centavos.

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ESTADOS_ITEM, ESTADOS_PEDIDO } from "../orquestrador/estados.ts";

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();
const atualizadoEm = () =>
  timestamp("atualizado_em", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const reais = (nome: string) => numeric(nome, { precision: 14, scale: 2 });

// ---------- Enums ----------

export const CANAIS = ["telegram", "whatsapp", "email", "web", "voz", "simulado"] as const;
export type Canal = (typeof CANAIS)[number];

export const canalEnum = pgEnum("canal", CANAIS);
export const papelContatoEnum = pgEnum("papel_contato", ["comprador", "fornecedor"]);
export const origemFornecedorEnum = pgEnum("origem_fornecedor", ["real", "simulado"]);
export const estadoPedidoEnum = pgEnum("estado_pedido", ESTADOS_PEDIDO);
export const estadoItemEnum = pgEnum("estado_item", ESTADOS_ITEM);
export const urgenciaEnum = pgEnum("urgencia", ["normal", "urgente", "obra_parada"]);
export const modoEntregaEnum = pgEnum("modo_entrega", ["entrega", "retirada"]);
export const situacaoCotacaoEnum = pgEnum("situacao_cotacao", [
  "aguardando",
  "respondeu",
  "sem_resposta",
  "parou",
  "desistiu",
  "encerrada",
]);
export const classificacaoEnum = pgEnum("classificacao_resposta", ["proposta", "duvida", "parar", "outro"]);
export const origemFreteEnum = pgEnum("origem_frete", ["informado", "estimado", "nao_se_aplica"]);
export const formatoOfertaEnum = pgEnum("formato_oferta", ["texto", "pdf", "foto", "voz", "busca"]);
export const direcaoEnum = pgEnum("direcao_mensagem", ["entrada", "saida"]);
export const situacaoEnvioEnum = pgEnum("situacao_envio", ["recebida", "enviada", "bloqueada_parar", "falhou"]);

// ---------- Fornecedor ----------

export const fornecedor = pgTable("fornecedor", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Chave estável dos simulados ("sim-perto"), para o seed não duplicar. */
  chave: text("chave").unique(),
  nome: text("nome").notNull(),
  cnpj: text("cnpj"),
  origem: origemFornecedorEnum("origem").notNull(),
  /** Q8: CNPJ ativo ou presença conferida, com link da fonte. */
  verificado: boolean("verificado").notNull().default(false),
  /** Julgamento do Q8 (pontos, nível, motivos, CNPJ consultado). */
  verificacao: jsonb("verificacao").$type<Record<string, unknown>>(),
  /** X2: aprovação formal, diferente de verificado. */
  homologado: boolean("homologado").notNull().default(false),
  fonte: text("fonte"),
  regiao: text("regiao"),
  cep: text("cep"),
  /** PARAR vale para o fornecedor em todos os canais. */
  parouEm: timestamp("parou_em", { withTimezone: true }),
  criadoEm: criadoEm(),
});

// ---------- Contato: quem fala com o sistema, em qual canal ----------

export const contato = pgTable(
  "contato",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canal: canalEnum("canal").notNull(),
    /** Id da conversa no canal (chat_id do Telegram, número, e-mail...). */
    endereco: text("endereco").notNull(),
    papel: papelContatoEnum("papel").notNull(),
    fornecedorId: uuid("fornecedor_id").references(() => fornecedor.id),
    nome: text("nome"),
    /** Aviso curto de privacidade já mostrado (R5). */
    avisoPrivacidadeEm: timestamp("aviso_privacidade_em", { withTimezone: true }),
    parouEm: timestamp("parou_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("contato_canal_endereco").on(t.canal, t.endereco)],
);

// ---------- Pedido e itens ----------

export const pedido = pgTable("pedido", {
  /** Número que aparece na tela: "Pedido 1042". */
  id: serial("id").primaryKey(),
  estado: estadoPedidoEnum("estado").notNull().default("interpretando"),
  canalOrigem: canalEnum("canal_origem").notNull(),
  compradorId: uuid("comprador_id")
    .notNull()
    .references(() => contato.id),
  textoOriginal: text("texto_original").notNull(),
  destino: text("destino"),
  cep: text("cep"),
  modoEntrega: modoEntregaEnum("modo_entrega"),
  janelaRecebimento: text("janela_recebimento"),
  /** Prazo como o comprador falou e em dias, para o portão "dentro do prazo". */
  prazoTexto: text("prazo_texto"),
  prazoMaxDias: integer("prazo_max_dias"),
  urgencia: urgenciaEnum("urgencia").notNull().default("normal"),
  /** Perguntas sobre o que o R2 não conseguiu tirar do texto. */
  faltando: jsonb("faltando").$type<string[]>().notNull().default([]),
  /** O que o R2 assumiu sem o comprador dizer ("saco de 50 kg"), mostrado na confirmação. */
  suposicoes: jsonb("suposicoes").$type<string[]>().notNull().default([]),
  /** Respostas e correções do comprador antes de confirmar, em ordem. */
  correcoes: jsonb("correcoes").$type<string[]>().notNull().default([]),
  /** Rodadas de pergunta já feitas: no máximo uma (R2). */
  perguntasFeitas: integer("perguntas_feitas").notNull().default(0),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const itemPedido = pgTable(
  "item_pedido",
  {
    id: serial("id").primaryKey(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id),
    /** Ordem na fila: cota-se um item por vez. */
    ordem: integer("ordem").notNull(),
    estado: estadoItemEnum("estado").notNull().default("na_fila"),
    /** Texto normalizado pelo R2 ("Cimento CP II 50 kg"). */
    descricao: text("descricao").notNull(),
    /** Chave estável para memória e recompra (X2): "cimento-cp2-50kg". */
    itemChave: text("item_chave"),
    quantidade: numeric("quantidade", { precision: 14, scale: 3 }).notNull(),
    unidade: text("unidade").notNull(),
    especificacao: jsonb("especificacao").$type<Record<string, string>>().notNull().default({}),
    aceitaSimilar: boolean("aceita_similar").notNull().default(false),
    /** Q4: quando a cotação encerra e a comparação segue com quem respondeu. */
    prazoRespostasEm: timestamp("prazo_respostas_em", { withTimezone: true }),
    lembreteEm: timestamp("lembrete_em", { withTimezone: true }),
    rodada: integer("rodada").notNull().default(1),
    fornecedorEscolhidoId: uuid("fornecedor_escolhido_id").references(() => fornecedor.id),
    ofertaEscolhidaId: uuid("oferta_escolhida_id"),
    /** Q2: observação quando segue com menos de 3 propostas válidas. */
    justificativaMenosDeTres: text("justificativa_menos_de_tres"),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    uniqueIndex("item_pedido_ordem").on(t.pedidoId, t.ordem),
    index("item_pedido_estado").on(t.estado),
  ],
);

// ---------- Cotação enviada a cada fornecedor ----------

export const cotacao = pgTable(
  "cotacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemPedidoId: integer("item_pedido_id")
      .notNull()
      .references(() => itemPedido.id),
    fornecedorId: uuid("fornecedor_id")
      .notNull()
      .references(() => fornecedor.id),
    contatoId: uuid("contato_id").references(() => contato.id),
    rodada: integer("rodada").notNull().default(1),
    situacao: situacaoCotacaoEnum("situacao").notNull().default("aguardando"),
    enviadaEm: timestamp("enviada_em", { withTimezone: true }),
    lembreteEm: timestamp("lembrete_em", { withTimezone: true }),
    respondeuEm: timestamp("respondeu_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("cotacao_item_fornecedor_rodada").on(t.itemPedidoId, t.fornecedorId, t.rodada)],
);

// ---------- Oferta ----------

export const oferta = pgTable("oferta", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemPedidoId: integer("item_pedido_id")
    .notNull()
    .references(() => itemPedido.id),
  fornecedorId: uuid("fornecedor_id")
    .notNull()
    .references(() => fornecedor.id),
  cotacaoId: uuid("cotacao_id").references(() => cotacao.id),
  rodada: integer("rodada").notNull().default(1),
  /** O que o fornecedor ofereceu, como ofereceu. */
  itemOferecido: text("item_oferecido").notNull(),
  itemExato: boolean("item_exato").notNull(),
  /** Embalagens diferentes (3 × 500 g contra 2 × 1 kg): o mapa compara o total. */
  embalagem: text("embalagem"),
  quantidadeOfertada: numeric("quantidade_ofertada", { precision: 14, scale: 3 }),
  unidadeOfertada: text("unidade_ofertada"),
  precoUnitario: reais("preco_unitario"),
  totalProduto: reais("total_produto"),
  frete: reais("frete"),
  origemFrete: origemFreteEnum("origem_frete"),
  prazoDias: integer("prazo_dias"),
  validadeDias: integer("validade_dias"),
  pagamento: text("pagamento"),
  /** 0 é antecipado ou à vista. */
  prazoPagamentoDias: integer("prazo_pagamento_dias"),
  /** Impostos e taxas não embutidos no preço; null quando não informou. */
  impostosNaoInclusos: text("impostos_nao_inclusos"),
  impostosValor: reais("impostos_valor"),
  entregaNoLocal: boolean("entrega_no_local"),
  formato: formatoOfertaEnum("formato").notNull(),
  /** Sem link de fonte, oferta de busca não entra (R3). */
  fonte: text("fonte"),
  mensagemId: uuid("mensagem_id"),
  /** R8: preço suspeito confirmado pelo fornecedor. */
  precoConfirmado: boolean("preco_confirmado").notNull().default(false),
  /** Saída crua do extrator, para auditoria. */
  extraido: jsonb("extraido"),
  criadoEm: criadoEm(),
});

// ---------- Mensagens (N4): toda mensagem de todo canal, no mesmo formato ----------

export type Anexo = {
  tipo: "pdf" | "foto" | "audio" | "outro";
  mediaType: string;
  /** Id do arquivo no canal (file_id do Telegram) ou caminho local. */
  ref: string;
  nome?: string;
  tamanho?: number;
};

export const mensagem = pgTable(
  "mensagem",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canal: canalEnum("canal").notNull(),
    direcao: direcaoEnum("direcao").notNull(),
    contatoId: uuid("contato_id")
      .notNull()
      .references(() => contato.id),
    pedidoId: integer("pedido_id").references(() => pedido.id),
    itemPedidoId: integer("item_pedido_id").references(() => itemPedido.id),
    texto: text("texto").notNull().default(""),
    anexos: jsonb("anexos").$type<Anexo[]>().notNull().default([]),
    /** Botões oferecidos na mensagem de saída. */
    botoes: jsonb("botoes").$type<{ rotulo: string; dado: string }[]>(),
    /** Id da mensagem no canal, para não processar duas vezes. */
    idExterno: text("id_externo"),
    situacao: situacaoEnvioEnum("situacao").notNull(),
    erro: text("erro"),
    criadoEm: criadoEm(),
  },
  (t) => [
    // O id da mensagem no Telegram é por conversa: a chave inclui o contato.
    uniqueIndex("mensagem_entrada_id_externo")
      .on(t.canal, t.contatoId, t.idExterno)
      .where(sql`${t.direcao} = 'entrada' and ${t.idExterno} is not null`),
    index("mensagem_contato").on(t.contatoId, t.criadoEm),
  ],
);

// ---------- Registro (N5 e N6): o que cada agente fez e por quê ----------

export const evento = pgTable(
  "evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pedidoId: integer("pedido_id").references(() => pedido.id),
    itemPedidoId: integer("item_pedido_id").references(() => itemPedido.id),
    agente: text("agente").notNull(),
    acao: text("acao").notNull(),
    motivo: text("motivo").notNull(),
    /** Preenchidos quando o evento é uma transição de estado. */
    deEstado: text("de_estado"),
    paraEstado: text("para_estado"),
    fornecedorIds: jsonb("fornecedor_ids").$type<string[]>(),
    dados: jsonb("dados"),
    criadoEm: criadoEm(),
  },
  (t) => [index("evento_pedido").on(t.pedidoId, t.criadoEm)],
);

// ---------- Uso de IA: tokens, modelo e se caiu na reserva ----------

export const usoIa = pgTable("uso_ia", {
  id: uuid("id").primaryKey().defaultRandom(),
  papel: text("papel").notNull(),
  rota: text("rota").notNull(),
  modelo: text("modelo").notNull(),
  ok: boolean("ok").notNull(),
  tentativa: integer("tentativa").notNull(),
  tokensEntrada: integer("tokens_entrada"),
  tokensSaida: integer("tokens_saida"),
  duracaoMs: integer("duracao_ms").notNull(),
  erro: text("erro"),
  pedidoId: integer("pedido_id"),
  itemPedidoId: integer("item_pedido_id"),
  criadoEm: criadoEm(),
});

// ---------- Histórico de compras (X2), base para memória e recompra ----------

export const historicoCompra = pgTable("historico_compra", {
  id: uuid("id").primaryKey().defaultRandom(),
  fornecedorId: uuid("fornecedor_id")
    .notNull()
    .references(() => fornecedor.id),
  itemChave: text("item_chave").notNull(),
  descricao: text("descricao").notNull(),
  precoUnitario: reais("preco_unitario").notNull(),
  quantidade: numeric("quantidade", { precision: 14, scale: 3 }).notNull(),
  frete: reais("frete"),
  data: timestamp("data", { withTimezone: true }).notNull(),
  prazoPrometidoDias: integer("prazo_prometido_dias"),
  prazoCumprido: boolean("prazo_cumprido"),
  experiencia: text("experiencia"),
  /** Histórico inicial é sempre simulado e aparece assim na tela. */
  simulado: boolean("simulado").notNull(),
  itemPedidoId: integer("item_pedido_id").references(() => itemPedido.id),
  criadoEm: criadoEm(),
});

// ---------- Mapa de cotação (Q1): resultado do Comparador, por rodada ----------

export const mapaCotacao = pgTable(
  "mapa_cotacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemPedidoId: integer("item_pedido_id")
      .notNull()
      .references(() => itemPedido.id),
    rodada: integer("rodada").notNull(),
    /** Comparação completa (linhas, portões, notas, pesos, alertas), calculada em código. */
    dados: jsonb("dados").notNull(),
    /** Justificativa redigida pela IA (ou template), sem números novos. */
    recomendacao: text("recomendacao").notNull(),
    ofertaRecomendadaId: uuid("oferta_recomendada_id"),
    criadoEm: criadoEm(),
  },
  (t) => [index("mapa_item").on(t.itemPedidoId, t.criadoEm)],
);

// ---------- Busca real (R3) ----------

export const metodoColetaEnum = pgEnum("metodo_coleta", ["vtex_api", "jsonld", "ia_trecho", "serper_shopping"]);

/** Preço público coletado na internet, com fonte e data. Referência, não proposta. */
export const referenciaPreco = pgTable(
  "referencia_preco",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemPedidoId: integer("item_pedido_id")
      .notNull()
      .references(() => itemPedido.id),
    fornecedorId: uuid("fornecedor_id").references(() => fornecedor.id),
    loja: text("loja").notNull(),
    titulo: text("titulo").notNull(),
    /** Sem link de fonte, não entra. */
    url: text("url").notNull(),
    metodo: metodoColetaEnum("metodo").notNull(),
    /** Preço como a loja mostra, pela unidade dela. */
    precoFonte: reais("preco_fonte").notNull(),
    unidadeFonte: text("unidade_fonte"),
    /** Preço convertido para a unidade do pedido, quando a conversão é segura. */
    precoUnitario: reais("preco_unitario"),
    conversao: text("conversao"),
    disponivel: boolean("disponivel"),
    /** Frete real para o CEP (simulação da loja), quando houver. */
    frete: reais("frete"),
    fretePrazoDias: integer("frete_prazo_dias"),
    entregaNoCep: boolean("entrega_no_cep"),
    regiaoDoPreco: text("regiao_do_preco"),
    /** Trecho da página que contém o preço, conferido no código. */
    trecho: text("trecho"),
    aceita: boolean("aceita").notNull(),
    motivoCorte: text("motivo_corte"),
    confianca: integer("confianca").notNull(),
    coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index("referencia_item").on(t.itemPedidoId)],
);

/** Respostas de APIs de busca guardadas: evita gastar crédito com a mesma consulta. */
export const cacheBusca = pgTable(
  "cache_busca",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provedor: text("provedor").notNull(),
    consulta: text("consulta").notNull(),
    resposta: jsonb("resposta").notNull(),
    /** true quando a chamada gastou crédito pago (Serper). */
    pago: boolean("pago").notNull().default(false),
    criadoEm: criadoEm(),
  },
  (t) => [index("cache_busca_consulta").on(t.provedor, t.consulta, t.criadoEm)],
);

// ---------- Sanções (Q8): CEIS e CNEP do Portal da Transparência, só empresas ----------

export const sancao = pgTable(
  "sancao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cadastro: text("cadastro").notNull(), // CEIS ou CNEP
    cnpj: text("cnpj").notNull(),
    /** 8 primeiros dígitos: a mesma empresa, em qualquer unidade. */
    raiz: text("raiz").notNull(),
    nome: text("nome").notNull(),
    categoria: text("categoria"),
    orgao: text("orgao"),
    uf: text("uf"),
    esfera: text("esfera"),
    abrangencia: text("abrangencia"),
    inicio: text("inicio"),
    fim: text("fim"),
    /** Data do arquivo do Portal da Transparência. */
    base: text("base").notNull(),
    carregadoEm: timestamp("carregado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sancao_cnpj").on(t.cnpj), index("sancao_raiz").on(t.raiz)],
);
