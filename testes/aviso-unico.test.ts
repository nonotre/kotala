import assert from "node:assert/strict";
import { test } from "node:test";
import { avisoRepetido, normalizarAviso } from "../src/nucleo/mensagens/aviso-unico.ts";

test("aviso ao comprador: mesma pergunta com caixa e pontuação diferentes conta como repetida", () => {
  const antes = 'Pedido 6: Casa do Construtor Lagoa Exemplo perguntou: "Qual o CEP da entrega e se tem restrição de horário para caminhão?". Responda aqui que eu repasso a ele.';
  const agora = 'Pedido 6: Casa do Construtor Lagoa Exemplo perguntou: "qual o CEP da entrega e se tem restricao de horario para caminhao". Responda aqui que eu repasso a ele.';
  assert.equal(normalizarAviso(antes), normalizarAviso(agora));
  assert.ok(avisoRepetido(agora, ["Pedido 6: outra coisa", antes]));
});

test("aviso ao comprador: outro fornecedor, outro pedido ou outra pergunta não é repetido", () => {
  const base = "Pedido 6: Atacado Serra Exemplo pediu pagamento fora do padrão.";
  assert.ok(!avisoRepetido("Pedido 6: Depósito Perto Exemplo pediu pagamento fora do padrão.", [base]));
  assert.ok(!avisoRepetido("Pedido 7: Atacado Serra Exemplo pediu pagamento fora do padrão.", [base]));
  assert.ok(!avisoRepetido('Pedido 6: Lagoa perguntou: "tem descarga?"', ['Pedido 6: Lagoa perguntou: "qual o CEP?"']));
  assert.ok(avisoRepetido(base, [base]));
});
