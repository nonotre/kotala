// Regressão dos erros de docs/plano-ia.md ("Intenções para a Frente 3"), na parte que
// dá para conferir sem IA: o que a persona simulada escreve passa pelas mesmas
// funções de código do fluxo. Os casos que dependem da leitura da IA estão em
// src/simulador/casos/regressao.ts e rodam no `npm run regressao:avaliar`.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // os módulos exigem a variável; nada conecta aqui
const { posRegras, triagem, conferirItem } = await import("../src/agentes/guardrail/index.ts");
const { limpar } = await import("../src/agentes/extrator/index.ts");
const { perguntaDeConfirmacao } = await import("../src/fluxo/fornecedor.ts");
const { atributosPerguntados } = await import("../src/fluxo/comprador.ts");
const { comparar, botoesDecisao } = await import("../src/agentes/comparador/index.ts");
const { tecladoAposClique } = await import("../src/fluxo/componentes/botoes.ts");
const { detectarCategoria } = await import("../src/dominio/categorias.ts");
const { PERSONAS_AREAS, PERSONAS_EXTRAS, personaVende, precoUnitario, textoProposta, textoEsclarecePreco } = await import("../src/simulador/personas.ts");
const { valoresEmReais } = await import("../src/agentes/negociador/index.ts");
type Interpretacao = import("../src/agentes/interpretador/index.ts").Interpretacao;
type OfertaComparavel = import("../src/agentes/comparador/index.ts").OfertaComparavel;

const extracao = {
  classificacao: "proposta" as const, duvida: null, itemOferecido: null, aderencia: "exato" as const, divergencias: [] as string[],
  leituraPreco: "unitario" as const, trechoPreco: null, alertas: [] as never[], descontoPercentual: null, descontoValor: null,
  precoUnitario: null, quantidadeOfertada: null, unidadeOfertada: null, embalagem: null, totalProduto: null, frete: 50, impostosValor: null,
  impostosNaoInclusos: null, prazoDias: 2, validadeDias: 7, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, entregaNoLocal: true, cnpj: null,
};
const leitura = (p: Partial<Interpretacao>): Interpretacao => ({
  classe: "pedido", subtipo: null, motivo: "", opcoes: [], tentouMudarRegras: false, hostil: false, condicaoIrregular: null, itens: [],
  destino: null, cep: null, modoEntrega: null, janelaRecebimento: null, prazoTexto: null, prazoDias: null, urgencia: "normal", setor: null,
  entregas: null, faltando: [], suposicoes: [], ehPedido: true, ...p,
});
const itemI = (descricao: string): Interpretacao["itens"][number] => ({
  descricao, quantidade: 1, unidade: "unidade", especificacao: [], marca: null, marcaExigida: false, aceitaSimilar: null, risco: "nenhum", motivoRisco: null,
});

test("Q3 \"clips de papel\": nada bloqueia, é de escritório e tem quem venda; só o nome não abre pedido", () => {
  const t = triagem("clips de papel");
  assert.equal(t.bloqueio, null);
  assert.deepEqual(t.sinais, []);
  assert.equal(detectarCategoria("clips de papel").id, "escritorio");
  assert.ok(PERSONAS_AREAS.some((p) => personaVende(p, "Clips de papel nº 2/0", null)));
  // A leitura "ambiguo" com o item ("Quer que eu cote...?") não vira pedido até o Sim.
  const d = posRegras(leitura({ classe: "ambiguo", subtipo: "intencao", itens: [itemI("Clips de papel")] }), t);
  assert.equal(d.interpretacao.classe, "ambiguo");
  assert.equal(d.interpretacao.ehPedido, false);
  // "10000 clipes de papel" é pedido.
  assert.equal(posRegras(leitura({ itens: [itemI("Clipes de papel")] }), triagem("quero 10000 clipes de papel")).interpretacao.ehPedido, true);
});

test("Q1 \"R$ 300\" para 5 unidades: a persona do preço ambíguo vira pergunta, e a resposta dela resolve", () => {
  const p = PERSONAS_EXTRAS.find((x) => x.comportamento === "ambiguo")!;
  const item = { descricao: "Extintor ABC 6 kg", quantidade: 5, unidade: "unidade", destino: null };
  const unit = precoUnitario(p, item.descricao, item.unidade)!;
  const texto = textoProposta(p, item, 1)!;
  const numero = valoresEmReais(texto).find((v) => v > 100)!;
  // Só um número, sem "cada" nem "total": a leitura certa é "ambiguo".
  const e = limpar({ ...extracao, leituraPreco: "ambiguo", precoUnitario: numero, trechoPreco: `fica R$ ${numero}` }, { quantidade: 5 });
  assert.deepEqual(e.aConfirmar, ["preco"]);
  assert.match(perguntaDeConfirmacao(e, { id: 9, descricao: item.descricao, unidade: "unidade", quantidade: 5 }), /unit[aá]rio|cada|total/i);
  // A persona responde que é o total, com o unitário; os dois batem.
  const [total, cada] = valoresEmReais(textoEsclarecePreco(item, unit));
  const r = limpar({ ...extracao, leituraPreco: "total", precoUnitario: cada!, totalProduto: total! }, { quantidade: 5 });
  assert.equal(r.aConfirmar, undefined);
  // E "R$ 300 cada" continua unitário, sem pergunta.
  assert.equal(limpar({ ...extracao, precoUnitario: 300, trechoPreco: "R$ 300 cada" }, { quantidade: 5 }).aConfirmar, undefined);
});

test("Q2 proposta em kg ou com marca não exigida: equivalente, entra no mapa mesmo sem \"aceita similar\"", () => {
  const e = limpar({ ...extracao, aderencia: "equivalente", precoUnitario: 39, divergencias: ["unidade kg, pedido sem unidade", "marca Votoran, não exigida"] }, { quantidade: 40 });
  assert.equal(e.itemExato, true);
  assert.equal(e.aConfirmar, undefined);
  const oferta: OfertaComparavel = {
    id: "o1", fornecedorId: "f1", fornecedorNome: "F1", simulado: true, verificado: false, homologado: false, conhecido: false,
    itemOferecido: "Cimento Votoran CP II", itemExato: e.itemExato, precoUnitario: 39, totalProduto: null, frete: 50, impostosValor: null,
    impostosNaoInclusos: "inclusos", prazoDias: 2, validadeDias: 7, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, entregaNoLocal: true, precoConfirmado: false,
  };
  const c = comparar({ quantidade: 40, aceitaSimilar: false, prazoMaxDias: 5, modoEntrega: "entrega", urgencia: "normal" }, [oferta]);
  assert.equal(c.validas.length, 1);
  // Especificação diferente (outro número) não passa calada.
  assert.equal(limpar({ ...extracao, aderencia: "diferente", precoUnitario: 39, divergencias: ["6 kg, pedido de 4 kg"] }).itemExato, false);
});

test("Q4 extintor sem kg: pergunta a capacidade com botões; extintor não é barrado", () => {
  const r = atributosPerguntados([{ ordem: 1, descricao: "Extintor ABC", unidade: "unidade", quantidade: "2", especificacao: { Tipo: "Pó ABC" } }], 0);
  const cap = r.find((a) => a.chave === "capacidade");
  assert.ok(cap);
  assert.ok(cap.opcoes?.some((o) => /kg/.test(o)));
  assert.equal(r.find((a) => a.chave === "tipo"), undefined);
  assert.deepEqual(conferirItem({ descricao: "Extintor ABC 6 kg" }), { ok: true });
  assert.equal(triagem("2 extintores ABC pro galpão").bloqueio, null);
});

test("Q9 botões do mapa: \"Escolher outra\", \"Voltar\" e \"Aprovar\" mantêm o teclado; só a ação final tira", () => {
  const o = (id: string, preco: number): OfertaComparavel => ({
    id, fornecedorId: `f${id}`, fornecedorNome: `F${id}`, simulado: true, verificado: false, homologado: false, conhecido: false, itemOferecido: "Cimento",
    itemExato: true, precoUnitario: preco, totalProduto: null, frete: 50, impostosValor: null, impostosNaoInclusos: "inclusos", prazoDias: 2, validadeDias: 7,
    pagamento: "boleto", prazoPagamentoDias: 28, entregaNoLocal: true, precoConfirmado: false,
  });
  const c = comparar({ quantidade: 40, aceitaSimilar: true, prazoMaxDias: 5, modoEntrega: "entrega", urgencia: "normal" }, [o("1", 40), o("2", 41), o("3", 42)]);
  const botoes = botoesDecisao(7, c);
  assert.ok(botoes.length >= 3);
  for (const b of botoes) assert.equal(tecladoAposClique(b.dado), "manter", b.dado);
  assert.equal(tecladoAposClique("item:7:voltar"), "manter");
  assert.equal(tecladoAposClique(`item:7:confirmar:${c.vencedora!.oferta.id}`), "tirar");
});

test("U1 fornecedor que só aceita Pix: a proposta diz, sem esconder a condição", () => {
  const p = PERSONAS_EXTRAS.find((x) => x.comportamento === "so_pix")!;
  const t = textoProposta(p, { descricao: "Cimento CP II", quantidade: 40, unidade: "saco", destino: null }, 1)!;
  assert.match(t, /Pix/);
  assert.match(t, /não trabalhamos com boleto/);
});
