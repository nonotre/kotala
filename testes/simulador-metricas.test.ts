// Métricas do harness: desconto por rodada e mensagens seguidas sem resposta (U3). Sem banco.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // o módulo importa o cliente do banco; nada conecta aqui
const { descontoPorRodada, mensagensSemResposta, textoMetricas } = await import("../src/simulador/metricas.ts");
type Marca = import("../src/agentes/negociador/index.ts").MarcaNegociacao;

const marca = (extra: Partial<Marca>): Marca => ({
  pedidaEm: "2026-11-08T10:00:00Z",
  janelaAte: "2026-11-08T10:05:00Z",
  rodadaAuto: 1,
  alavancas: [],
  referenciaCitada: null,
  antes: { precoUnitario: 40, totalProduto: null, frete: 50, prazoDias: 2, pagamento: "boleto", prazoPagamentoDias: 28, impostosValor: null },
  ...extra,
});
const of = (fornecedorId: string, rodada: number, precoUnitario: number, m: Marca | null = null) => ({ itemPedidoId: 1, fornecedorId, rodada, precoUnitario, totalProduto: null, quantidade: 10, marca: m });

test("desconto automático por rodada: resultados, economia e média; rodada do botão contra a anterior", () => {
  const r = descontoPorRodada([
    of("a", 1, 38, marca({ resultado: "desconto", produtoAntes: 400, produtoDepois: 380, descontoProduto: 20 })),
    of("b", 1, 40, marca({ resultado: "manteve", produtoAntes: 400, produtoDepois: 400, descontoProduto: 0 })),
    of("c", 1, 40, marca({ resultado: "condicional" })),
    of("d", 1, 40, marca({})),
    of("e", 1, 50),
    of("a", 2, 37),
    of("e", 2, 50),
  ]);
  const a1 = r.automatico[1]!;
  assert.equal(a1.pedidos, 4);
  assert.deepEqual(a1.resultados, { desconto: 1, manteve: 1, condicional: 1, aberto: 1 });
  assert.equal(a1.economia, 20);
  assert.equal(a1.percentualMedio, 5);
  assert.deepEqual(r.botao, [{ rodada: 2, fornecedores: 2, baixaram: 1, economia: 10 }]);
});

test("mensagens seguidas sem resposta: conta por contato, zera na resposta", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 10, 8, 10, 0, s));
  const c = mensagensSemResposta([
    { contatoId: "x", direcao: "saida", criadoEm: t(0) }, // cotação
    { contatoId: "x", direcao: "saida", criadoEm: t(10) }, // lembrete sem resposta: 2 seguidas
    { contatoId: "x", direcao: "saida", criadoEm: t(20) }, // 3 seguidas (conta uma vez só)
    { contatoId: "x", direcao: "entrada", criadoEm: t(30) },
    { contatoId: "x", direcao: "saida", criadoEm: t(40) },
    { contatoId: "y", direcao: "saida", criadoEm: t(1) },
    { contatoId: "y", direcao: "entrada", criadoEm: t(2) },
    { contatoId: "y", direcao: "saida", criadoEm: t(3) },
  ]);
  assert.equal(c.vezesDuasSeguidas, 1);
  assert.equal(c.maiorSequencia, 3);
  assert.deepEqual(c.porContato.y, { saidas: 2, entradas: 1, maiorSequencia: 1, vezesDuasSeguidas: 0 });
  const texto = textoMetricas({ pedidoId: 7, desconto: descontoPorRodada([]), cadencia: c, nomes: { x: "Forn X" } });
  assert.match(texto, /Forn X: 3 mandadas|Forn X: 4 mandadas/);
  assert.match(texto, /nenhum pedido de desconto/);
});
