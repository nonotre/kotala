import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colunaDoItem,
  diagramaMermaid,
  ESTADOS_ITEM,
  FINAIS_ITEM,
  proximoEstadoItem,
  proximoEstadoPedido,
  TRANSICOES_ITEM,
} from "../src/nucleo/orquestrador/estados.ts";

test("caminho feliz do item até confirmado", () => {
  const passos = [
    ["na_fila", "iniciar_busca", "buscando"],
    ["buscando", "busca_concluida", "cotando"],
    ["cotando", "encerrar_cotacao", "comparando"],
    ["comparando", "mapa_pronto", "aguardando_decisao"],
    ["aguardando_decisao", "aprovar", "aprovado"],
    ["aprovado", "pedido_enviado", "pedido_enviado"],
    ["pedido_enviado", "fornecedor_confirmou", "confirmado"],
  ] as const;
  for (const [de, ev, para] of passos) assert.equal(proximoEstadoItem(de, ev), para);
});

test("a IA não pula a aprovação", () => {
  assert.equal(proximoEstadoItem("comparando", "aprovar"), null);
  assert.equal(proximoEstadoItem("comparando", "pedido_enviado"), null);
});

test("estado final não sai nem por cancelar", () => {
  for (const f of FINAIS_ITEM) {
    for (const t of TRANSICOES_ITEM) assert.ok(!t.de.includes(f), `${f} aparece em ${t.evento}`);
  }
});

test("todo estado não final pode ser cancelado", () => {
  for (const e of ESTADOS_ITEM) {
    if (!FINAIS_ITEM.includes(e)) assert.equal(proximoEstadoItem(e, "cancelar"), "cancelado");
  }
});

test("pedido: confirmação e correção", () => {
  assert.equal(proximoEstadoPedido("aguardando_confirmacao", "comprador_confirmou"), "em_andamento");
  assert.equal(proximoEstadoPedido("aguardando_confirmacao", "comprador_corrigiu"), "interpretando");
  assert.equal(proximoEstadoPedido("interpretando", "comprador_confirmou"), null);
});

test("coluna do quadro", () => {
  assert.equal(colunaDoItem("aguardando_confirmacao", "na_fila"), "Solicitado");
  assert.equal(colunaDoItem("em_andamento", "cotando"), "Cotando");
  assert.equal(colunaDoItem("em_andamento", "aguardando_decisao"), "Comparando");
  assert.equal(colunaDoItem("em_andamento", "confirmado"), "Decidido");
});

test("diagrama sai da tabela", () => {
  assert.match(diagramaMermaid(), /aguardando_decisao --> aprovado: aprovar/);
});
