import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { pedeModeloForte } from "../src/assistente/agente.ts";
import { coletar, lerNumeroBr, validarResposta } from "../src/assistente/validador.ts";

const FORN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const dados = coletar([
  { pedidoId: 12, href: "/pedidos/12", itens: [{ itemId: 34, href: "/pedidos/12/decisao#item-34" }] },
  { validas: [{ fornecedorId: FORN, custoTotal: 1636, precoUnitario: 38.9 }], referenciaPublica: [{ link: "https://www.telhanorte.com.br/cimento", preco: 42.9 }] },
]);

describe("validador do Assistente", () => {
  it("lê números no formato brasileiro", () => {
    assert.equal(lerNumeroBr("1.636,00"), 1636);
    assert.equal(lerNumeroBr("38,9"), 38.9);
    assert.equal(lerNumeroBr("1.636"), 1636);
    assert.equal(lerNumeroBr("42.9"), 42.9);
  });

  it("aceita valores, pedidos e links que vieram dos dados", () => {
    const v = validarResposta("O [Pedido 12](/pedidos/12) tem proposta de R$ 1.636,00 (R$ 38,90 o saco). [Decidir](/pedidos/12/decisao#item-34). Referência: [loja](https://www.telhanorte.com.br/cimento).", [], dados);
    assert.deepEqual(v.problemas, []);
    assert.ok(v.ok);
  });

  it("reprova valor em reais que não veio das ferramentas", () => {
    const v = validarResposta("Sai por R$ 1.500,00.", [], dados);
    assert.equal(v.ok, false);
    assert.match(v.problemas[0]!, /R\$ 1\.500,00/);
  });

  it("reprova pedido inexistente", () => {
    assert.equal(validarResposta("O pedido 99 está cotando.", [], dados).ok, false);
  });

  it("reprova quando diz que agiu sozinho", () => {
    assert.equal(validarResposta("Pronto, já aprovei a proposta do Depósito Silva.", [], dados).ok, false);
  });

  it("tira links ruins do texto sem reprovar só por isso", () => {
    const v = validarResposta("Veja [aqui](/admin) e [lá](/pedidos/99) e [fora](https://exemplo.com).", [], dados);
    assert.equal(v.texto, "Veja aqui e lá e fora.");
    assert.equal(v.problemas.length, 3);
    assert.ok(v.ok);
  });

  it("reprova botão de link para item ou fornecedor que não veio dos dados", () => {
    assert.equal(validarResposta("Ok.", [{ rotulo: "Abrir", dado: "link:/pedidos/12/decisao#item-99" }], dados).ok, false);
    assert.equal(validarResposta("Ok.", [{ rotulo: "Abrir", dado: `link:/fornecedores/${FORN}` }], dados).ok, true);
  });

  it("reprova link de item que é de outro pedido", () => {
    const outro = coletar([{ pedidoId: 12, itens: [{ itemId: 34 }] }, { pedidoId: 13, itens: [{ itemId: 36 }] }]);
    assert.equal(validarResposta("Ok.", [{ rotulo: "Abrir", dado: "link:/pedidos/12/decisao#item-36" }], outro).ok, false);
    assert.equal(validarResposta("Ok.", [{ rotulo: "Abrir", dado: "link:/pedidos/13/decisao#item-36" }], outro).ok, true);
  });

  it("aceita pedido citado em texto dos dados ou pelo comprador, mas não como link", () => {
    const c = coletar([{ alertas: ["Atrasou 9 dias no Pedido 4"] }, "não acho o pedido 99"]);
    assert.ok(validarResposta("Ela atrasou 9 dias no pedido 4.", [], c).ok);
    assert.ok(validarResposta("Não achei o pedido 99.", [], c).ok);
    assert.equal(validarResposta("Veja o [pedido 99](/pedidos/99).", [], c).texto, "Veja o pedido 99.");
  });

  it("só começa no modelo forte em mensagem longa", () => {
    assert.ok(!pedeModeloForte("por que a Mega Obras ficou de fora?"));
    assert.ok(pedeModeloForte("x".repeat(300)));
  });
});
