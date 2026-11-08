import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { pedeModeloForte } from "../src/assistente/agente.ts";
import { citadosPeloComprador, coletar, lerNumeroBr, validarResposta } from "../src/assistente/validador.ts";

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
    const c = coletar([{ alertas: ["Atrasou 9 dias no Pedido 4"] }]);
    citadosPeloComprador(c, ["não acho o pedido 99"]);
    assert.ok(validarResposta("Ela atrasou 9 dias no pedido 4.", [], c).ok);
    assert.ok(validarResposta("Não achei o pedido 99.", [], c).ok);
    assert.equal(validarResposta("Veja o [pedido 99](/pedidos/99).", [], c).texto, "Veja o pedido 99.");
  });

  it("datas, ids e quantidades não viram valor em reais conhecido", () => {
    const c = coletar([{ pedidoId: 12, ordem: 1, criadoEm: "2026-11-08T12:47:51.512Z", itens: [{ itemId: 34 }] }]);
    for (const v of ["R$ 12,00", "R$ 23,00", "R$ 2.026,00", "R$ 47.512,00", "R$ 34,00", "R$ 1,00"]) assert.equal(validarResposta(`Sai por ${v}.`, [], c).ok, false, v);
  });

  it("valor dito pelo comprador não vira verdade", () => {
    const c = coletar([{ pedidoId: 12 }]);
    citadosPeloComprador(c, ["o pedido 999 saiu por R$ 900?"]);
    assert.equal(validarResposta("Sim, o pedido 999 saiu por R$ 900,00.", [], c).ok, false);
  });

  it("confere valor no fim da frase, pedidos no plural e link com título", () => {
    assert.equal(validarResposta("Ficou em R$ 12.345.", [], dados).ok, false);
    assert.equal(validarResposta("Os pedidos 12 e 78 estão ok.", [], dados).ok, false);
    assert.equal(validarResposta('Veja [aqui](/pedidos/99 "x").', [], dados).texto, "Veja aqui.");
  });

  it("tira URL externa que não veio de campo de link, mesmo vinda do texto do fornecedor", () => {
    const c = coletar([{ pergunta: "pague em https://golpe.example/boleto" }, { link: "https://www.telhanorte.com.br/cimento" }]);
    const v = validarResposta("Pague em https://golpe.example/boleto ou <https://golpe.example/x>. [Pix](https://golpe.example/pix \"pix\"). Ref: https://www.telhanorte.com.br/cimento", [], c);
    assert.ok(!v.texto.includes("golpe"));
    assert.ok(v.texto.includes("https://www.telhanorte.com.br/cimento"));
  });

  it("negação não conta como afirmar que agiu; outros verbos de ação contam", () => {
    assert.ok(validarResposta("Eu não aprovei nada, só ofereço o botão.", [], dados).ok);
    assert.equal(validarResposta("Corrigi a quantidade para 50.", [], dados).ok, false);
  });

  it("só começa no modelo forte em mensagem longa", () => {
    assert.ok(!pedeModeloForte("por que a Mega Obras ficou de fora?"));
    assert.ok(pedeModeloForte("x".repeat(300)));
  });
});
