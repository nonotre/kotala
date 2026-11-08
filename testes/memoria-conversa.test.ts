// I5: memória na conversa do comprador ("o mesmo de ontem", "mesmo endereço", "aquele fornecedor").
// Testes puros, sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
import type { Interpretacao } from "../src/agentes/interpretador/index.ts";
import type { PedidoRecente } from "../src/agentes/interpretador/memoria-conversa.ts";
const m = await import("../src/agentes/interpretador/memoria-conversa.ts");

const AGORA = new Date("2026-11-08T15:00:00-03:00");
const dias = (n: number) => new Date(AGORA.getTime() - n * 24 * 3600_000);

const ontem: PedidoRecente = {
  id: 21,
  criadoEm: dias(1),
  estado: "concluido",
  destino: "Obra da Rua Augusta, 100",
  cep: "01305-000",
  modoEntrega: "entrega",
  setor: "estrutura",
  pagamento: "pix",
  itens: [
    { descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", especificacao: { Tipo: "CP II" } },
    { descricao: "Areia média", quantidade: 2, unidade: "m³", especificacao: {} },
  ],
  compras: [{ item: "Cimento CP II 50 kg", fornecedor: "Depósito Aurora", precoUnitario: 38.5, data: dias(1) }],
};
const semanaPassada: PedidoRecente = { ...ontem, id: 15, criadoEm: dias(8), destino: "Escritório central", setor: "manutenção", itens: [{ descricao: "Lâmpada LED 9 W", quantidade: 30, unidade: "unidade", especificacao: {} }], compras: [] };
const hoje: PedidoRecente = { ...ontem, id: 25, criadoEm: dias(0.1), estado: "cancelado", itens: [{ descricao: "Tinta acrílica", quantidade: 3, unidade: "lata", especificacao: {} }], compras: [] };
const memoria = { pedidos: [hoje, ontem, semanaPassada] };

const vazio = (extra: Partial<Interpretacao> = {}): Interpretacao => ({
  classe: "ambiguo",
  subtipo: null,
  motivo: "",
  opcoes: ["Material de obra", "Escritório"],
  tentouMudarRegras: false,
  hostil: false,
  condicaoIrregular: null,
  itens: [],
  destino: null,
  cep: null,
  modoEntrega: null,
  janelaRecebimento: null,
  prazoTexto: null,
  prazoDias: null,
  urgencia: "normal",
  setor: null,
  pagamento: null,
  entregas: null,
  faltando: ["Quais itens você precisa?"],
  suposicoes: [],
  ehPedido: false,
  ...extra,
});

test("só olha a memória quando a mensagem cita algo anterior", () => {
  for (const t of ["manda o mesmo de ontem", "repete o último pedido", "40 sacos de cimento pro mesmo endereço", "compra daquele fornecedor", "igual ao pedido 21", "o de sempre"]) assert.ok(m.citaAlgoAnterior(t), t);
  for (const t of ["40 sacos de cimento CP II", "10 resmas de papel A4 até sexta", "como está a cotação?"]) assert.ok(!m.citaAlgoAnterior(t), t);
});

test("pedido referido: número, ontem, semana passada; senão o mais recente que não foi cancelado", () => {
  assert.equal(m.pedidoReferido("igual ao pedido 15", memoria.pedidos, AGORA)?.id, 15);
  assert.equal(m.pedidoReferido("o mesmo de ontem", memoria.pedidos, AGORA)?.id, 21);
  assert.equal(m.pedidoReferido("aquele da semana passada", memoria.pedidos, AGORA)?.id, 15);
  assert.equal(m.pedidoReferido("repete o último", memoria.pedidos, AGORA)?.id, 21);
  assert.equal(m.pedidoReferido("o mesmo de anteontem", memoria.pedidos, AGORA), null);
  assert.equal(m.pedidoReferido("pedido 99", memoria.pedidos, AGORA), null);
});

test("'o mesmo de ontem' sem item: itens, destino e setor do pedido de ontem, com suposição", () => {
  const r = m.aplicarMemoria(vazio(), "manda o mesmo de ontem", memoria, AGORA);
  assert.equal(r.usou, 21);
  const i = r.interpretacao;
  assert.equal(i.classe, "pedido");
  assert.ok(i.ehPedido);
  assert.deepEqual(i.itens.map((x) => [x.descricao, x.quantidade, x.unidade]), [["Cimento CP II 50 kg", 40, "saco"], ["Areia média", 2, "m³"]]);
  assert.deepEqual(i.itens[0]!.especificacao, [{ nome: "Tipo", valor: "CP II" }]);
  assert.equal(i.destino, "Obra da Rua Augusta, 100");
  assert.equal(i.setor, "estrutura");
  assert.equal(i.pagamento, "pix");
  assert.deepEqual(i.opcoes, []);
  assert.deepEqual(i.faltando, []);
  assert.match(i.suposicoes.join(" | "), /Mesmos itens do pedido 21/);
});

test("'mesmo endereço' só completa o destino; os itens novos ficam", () => {
  const lido = vazio({ classe: "pedido", opcoes: [], faltando: [], itens: [{ descricao: "Brita 1", quantidade: 3, unidade: "m³", especificacao: [], marca: null, marcaExigida: false, aceitaSimilar: null, risco: "nenhum", motivoRisco: null }] });
  const r = m.aplicarMemoria(lido, "3 m³ de brita 1 pro mesmo endereço", memoria, AGORA);
  assert.equal(r.usou, 21);
  assert.equal(r.interpretacao.itens.length, 1);
  assert.equal(r.interpretacao.destino, "Obra da Rua Augusta, 100");
  assert.equal(r.interpretacao.setor, null);
  assert.match(r.interpretacao.suposicoes.join(), /Mesmo endereço do pedido 21/);
});

test("item citado sem quantidade que estava no pedido referido ganha a quantidade de lá", () => {
  const lido = vazio({ classe: "pedido", opcoes: [], faltando: ["Quantos sacos de Cimento CP II?"], itens: [{ descricao: "Cimento CP II", quantidade: 0, unidade: "unidade", especificacao: [], marca: null, marcaExigida: false, aceitaSimilar: null, risco: "nenhum", motivoRisco: null }] });
  const r = m.aplicarMemoria(lido, "mais daquele cimento de ontem", memoria, AGORA);
  assert.equal(r.interpretacao.itens[0]!.quantidade, 40);
  assert.equal(r.interpretacao.itens[0]!.unidade, "saco");
  assert.deepEqual(r.interpretacao.faltando, []);
});

test("'aquele fornecedor' anota quem foi; consulta e destino já dito não mudam", () => {
  const lido = vazio({ classe: "pedido", opcoes: [], faltando: [], destino: "Filial Centro", itens: [{ descricao: "Cimento CP II 50 kg", quantidade: 10, unidade: "saco", especificacao: [], marca: null, marcaExigida: false, aceitaSimilar: null, risco: "nenhum", motivoRisco: null }] });
  const r = m.aplicarMemoria(lido, "10 sacos de cimento daquele fornecedor, mesmo endereço não, manda pra filial", memoria, AGORA);
  assert.equal(r.interpretacao.destino, "Filial Centro");
  assert.match(r.interpretacao.suposicoes.join(), /Fornecedor citado: Depósito Aurora/);
  const consulta = vazio({ classe: "consulta" });
  assert.equal(m.aplicarMemoria(consulta, "o pedido de ontem já chegou?", memoria, AGORA).usou, null);
  // Sem nada a completar, a leitura volta igual.
  const nada = m.aplicarMemoria(lido, "o mesmo de anteontem", memoria, AGORA);
  assert.equal(nada.usou, null);
  assert.equal(nada.interpretacao, lido);
});

test("bloco da memória no prompt: compacto, com o que foi comprado e de quem", () => {
  const t = m.textoMemoria({ pedidos: [ontem] });
  const j = JSON.parse(t) as { pedido: number; destino: string; comprado: { fornecedor: string }[] }[];
  assert.equal(j[0]!.pedido, 21);
  assert.equal(j[0]!.destino, "Obra da Rua Augusta, 100");
  assert.equal(j[0]!.comprado[0]!.fornecedor, "Depósito Aurora");
  assert.doesNotMatch(t, /38[.,]5/); // o preço não vai ao Interpretador: não serve para ler o pedido
});
