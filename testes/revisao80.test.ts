// Revisão 80 (Ester, 08/11/2026): os erros dos testes dela, em testes puros, sem banco e sem IA.
// Os cenários de ponta a ponta estão em src/simulador/cenarios/revisao80.ts (npm run simulador).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const n = await import("../src/agentes/negociador/index.ts");
const { completarComAnterior } = await import("../src/fluxo/fornecedor.ts");
const { negociacaoDaLinha } = await import("../src/agentes/comparador/calculo.ts");
const { medidaDiferente, medidasDoPedido, relevante } = await import("../src/agentes/busca/filtro.ts");
const pos = await import("../src/fluxo/pos-pedido.ts");
const { textoPedidoDeCompra, descontoPendente } = await import("../src/fluxo/decisao.ts");
const c = await import("../src/fluxo/comprador.ts");
const { limpar } = await import("../src/agentes/interpretador/index.ts");

// ---------- Desconto: "no valor total da proposta" é base, não condição ----------

test("desconto: 'no valor total da proposta' não é condição; 'à vista' e 'se fechar hoje' são", () => {
  assert.equal(n.ehCondicaoDeVerdade("no valor total da proposta"), false);
  assert.equal(n.ehCondicaoDeVerdade("10% no total"), false);
  assert.equal(n.ehCondicaoDeVerdade("em tudo"), false);
  assert.equal(n.ehCondicaoDeVerdade("na proposta"), false);
  assert.equal(n.ehCondicaoDeVerdade("à vista"), true);
  assert.equal(n.ehCondicaoDeVerdade("no Pix"), true);
  assert.equal(n.ehCondicaoDeVerdade("se fechar hoje"), true);
  assert.equal(n.ehCondicaoDeVerdade("acima de 100 sacos"), true);
  // O campo errado da IA não segura mais o desconto (o caso do pedido 33).
  const lido = { descontoPercentual: 10, descontoValor: null, descontoCondicao: "no valor total da proposta" };
  assert.equal(n.condicaoDoDesconto(lido, "Dou 10% de desconto no valor total da proposta"), null);
  assert.equal(n.condicaoDoDesconto({ ...lido, descontoCondicao: "à vista" }, "Faço 10% à vista"), "10% à vista");
});

test("desconto sobre o total da proposta vale para o frete; '3% no total' sozinho, só o produto", () => {
  assert.equal(n.descontoSobreTotal("Dou 10% de desconto no valor total da proposta"), true);
  assert.equal(n.descontoSobreTotal("5% em tudo"), true);
  assert.equal(n.descontoSobreTotal("Consigo 3% de desconto no total, mantendo as outras condições."), false);
  const a = n.aplicarDesconto({ precoUnitario: 17, totalProduto: 255, frete: 15 }, { descontoPercentual: 10, descontoValor: null }, 15, false, true)!;
  assert.equal(a.totalProduto, 229.5);
  assert.equal(a.frete, 13.5);
  const b = n.aplicarDesconto({ precoUnitario: 17, totalProduto: 255, frete: 15 }, { descontoPercentual: 10, descontoValor: null }, 15, false, false)!;
  assert.equal(b.totalProduto, 229.5);
  assert.equal(b.frete, undefined);
});

test("completarComAnterior aplica os 10% da Casa do Construtor no produto e no frete (243 em vez de 270)", () => {
  const anterior = { precoUnitario: "17", totalProduto: "255", frete: "15", itemOferecido: "Tubo", itemExato: true, quantidadeOfertada: "15", unidadeOfertada: "barra", embalagem: null, impostosValor: null, impostosNaoInclusos: null, prazoDias: 3, validadeDias: 30, pagamento: "30 ddl", prazoPagamentoDias: 30, entregaNoLocal: true, extraido: {} };
  const e = { classificacao: "outro", descontoPercentual: 10, descontoValor: null, precoUnitario: null, totalProduto: null, frete: null, prazoDias: null, validadeDias: null, pagamento: null, prazoPagamentoDias: null, impostosValor: null, impostosNaoInclusos: null, entregaNoLocal: null, itemOferecido: null } as never;
  const r = completarComAnterior(e, anterior as never, { quantidade: 15, condicional: false, sobreTotal: true })!;
  assert.equal(r.totalProduto, 229.5);
  assert.equal(r.frete, 13.5);
  assert.equal(r.totalProduto! + r.frete!, 243);
});

test("mapa: desconto obtido com valor bruto, percentual e valor com desconto", () => {
  const o = { frete: 13.5, negociacao: { resultado: "desconto" as const, descontoFrete: 1.5 }, produtoAnterior: 255 } as never;
  const r = negociacaoDaLinha(o, 229.5);
  assert.equal(r.texto, "Desconto obtido: R$ 27,00 (10%) · valor bruto R$ 270,00 · com desconto R$ 243,00 (frete R$ 1,50 mais barato)");
});

// ---------- Pedido de compra e a resposta do vencedor ----------

const ofertaBase = { itemOferecido: "Tubo de PVC soldável marrom 25 mm 3/4\"", formato: "texto" as const, precoUnitario: "17", frete: "15", prazoDias: 3, prazoPagamentoDias: 30 };
const pedidoBase = { modoEntrega: "entrega" as const, destino: "Rua de Exemplo, 100", janelaRecebimento: null, entregas: null, pagamentoPreferido: null };

test("pedido de compra: sem '(não aplicado ao total)'; pergunta se o desconto condicionado vale", () => {
  const pagamento = '30 ddl; desconto condicionado: "10% se fechar hoje" (não aplicado ao total)';
  assert.equal(descontoPendente(pagamento), "10% se fechar hoje");
  const t = textoPedidoDeCompra({ item: { id: 64, quantidade: "15", unidade: "barra" }, pedido: pedidoBase, oferta: { ...ofertaBase, pagamento }, custo: 270, comprador: "Ester" });
  assert.doesNotMatch(t, /não aplicado/);
  assert.match(t, /Pagamento: 30 ddl\./);
  assert.match(t, /Você ofereceu um desconto com condição \("10% se fechar hoje"\), que não está no total acima\./);
});

test("resposta ao pedido de compra (regra de reserva): desconto pendente que passa a valer, prazo, dúvida, recusa, confirmação", () => {
  const pendente = pos.descontoPendenteDaOferta('30 ddl; desconto condicionado: "10% no valor total da proposta" (não aplicado ao total)');
  assert.deepEqual(pendente, { percentual: 10, valor: null, trecho: "10% no valor total da proposta" });
  const l = pos.lerPosPedidoPorRegra("desconto se aplica ao total sim", pendente);
  assert.equal(l.intencao, "altera");
  assert.equal(l.descontoPercentual, 10);
  assert.equal(pos.lerPosPedidoPorRegra("o desconto não vale para boleto", pendente).descontoPercentual, null);
  assert.equal(pos.lerPosPedidoPorRegra("Consigo entregar em 5 dias").novoPrazoDias, 5);
  assert.equal(pos.lerPosPedidoPorRegra("Qual o CNPJ para a nota?").intencao, "duvida");
  assert.equal(pos.lerPosPedidoPorRegra("Infelizmente não consigo atender, sem estoque").intencao, "recusa");
  assert.equal(pos.lerPosPedidoPorRegra("Combinado, pode deixar").intencao, "confirma");
  assert.equal(pos.lerPosPedidoPorRegra("Vou separar e mando foto amanhã").intencao, "outro");
});

test("alteração depois do pedido de compra: contas em código, produto e frete com 'total da proposta'", () => {
  const antes = { precoUnitario: 17, totalProduto: 255, frete: 15, prazoDias: 3, pagamento: '30 ddl; desconto condicionado: "10% no valor total da proposta" (não aplicado ao total)', impostosValor: null };
  const l = pos.lerPosPedidoPorRegra("desconto se aplica ao total sim", pos.descontoPendenteDaOferta(antes.pagamento));
  const r = pos.aplicarAlteracao(antes, l, 15, "desconto se aplica ao total sim", "10% no valor total da proposta")!;
  assert.equal(r.depois.totalProduto! + r.depois.frete!, 243);
  assert.equal(r.depois.pagamento, "30 ddl");
  assert.match(r.descricao[0]!, /10% sobre o total/);
  // Sem nada calculável, não há alteração.
  assert.equal(pos.aplicarAlteracao(antes, pos.lerPosPedidoPorRegra("ok, vou ver"), 15, "ok, vou ver"), null);
});

test("estado do item em palavras: pedido enviado não é 'em cotação'", () => {
  assert.match(pos.situacaoDoItem("pedido_enviado"), /pedido de compra enviado, esperando a confirmação do fornecedor/);
  assert.equal(pos.situacaoDoItem("cotando"), "em cotação");
});

// ---------- Loja online com medida diferente ----------

test("anúncio com comprimento diferente do pedido é cortado (tubo de 3 m num pedido de 6 m)", () => {
  const medidas = medidasDoPedido('Tubo de PVC soldável marrom 25 mm 3/4"', { Bitola: "25 mm", Polegada: '3/4"', Comprimento: "6 m" });
  assert.match(medidaDiferente("Tubo PVC Soldável 3 metros 25mm Krona", medidas)!, /3 metros no anúncio; pedido 6 m/);
  assert.equal(medidaDiferente("Tubo Pvc Soldavel 25mm X 6m Krona", medidas), null);
  assert.equal(medidaDiferente("Tubo Soldável 25 6mt Marrom Amanco", medidas), null);
  assert.match(medidaDiferente('Tubo PVC 1/2" 20mm 6m', medidas)!, /20mm/);
  // Sem medida no título: fica (o comprador confere no link). A marca 3M não é "3 metros".
  assert.equal(medidaDiferente("Tubo PVC soldável marrom", medidas), null);
  assert.equal(medidaDiferente("Fita isolante 3M 19mm x 20m", medidasDoPedido("Fita isolante 19 mm", { Comprimento: "20 m" })), null);
  assert.equal(relevante("Tubo PVC Soldável 3 metros 25mm", { grupos: [["tubo"]], proibidas: [], conteudoKg: null, medidas }).ok, false);
});

// ---------- Resumo ao comprador ----------

test("resumo mostra toda especificação de qualquer item, sem repetir o que o nome diz", () => {
  assert.equal(c.especificacoesVisiveis({ Classe: "A", Cor: "branco" }, "Capacete de segurança com carneira"), "Classe: A · Cor: branco");
  assert.equal(c.especificacoesVisiveis({ Bitola: "25 mm", Comprimento: "6 m" }, "Tubo de PVC 25 mm"), "Comprimento: 6 m");
  const t = c.textoConfirmacao({
    id: 30,
    itens: [{ descricao: "Capacete de segurança com carneira", quantidade: 30, unidade: "unidade", aceitaSimilar: false, especificacao: { Classe: "A", Cor: "branco" } }],
    destino: null, cep: null, setor: "QSMS", entregas: null, pagamento: "28 DDL", prazoTexto: "15 dias", prazoMaxDias: 15,
    urgencia: "normal", modoEntrega: null, janelaRecebimento: null, suposicoes: [], perguntas: [],
  });
  assert.match(t, /30 unidades de Capacete de segurança com carneira \(não aceita similar\)\n {3}Classe: A · Cor: branco/);
  assert.match(t, /Prazo: 15 dias\n/);
  assert.doesNotMatch(t, /15 dias \(15 dias\)/);
});

test("depois da correção: diz o que mudou; pergunta recebe conferência; nada mudou é dito", () => {
  const itens = [{ descricao: "Tubo de PVC", quantidade: 15, unidade: "barra", especificacao: { Bitola: "3/4 de polegada" }, aceitaSimilar: true }];
  const antes = c.fotoDoPedido(itens, { setor: "Instalações" });
  assert.match(c.textoDoQueMudou(antes, c.fotoDoPedido(itens, { setor: "Instalações" }), "vc anotou o diâmetro?"), /^Conferi: está tudo anotado/);
  assert.match(c.textoDoQueMudou(antes, c.fotoDoPedido(itens, { setor: "Instalações" }), "é o mesmo item"), /^Essa mensagem não mudou nada/);
  const depois = c.fotoDoPedido([{ ...itens[0]!, aceitaSimilar: false, especificacao: { ...itens[0]!.especificacao, Comprimento: "6 m" } }], { setor: "Instalações" });
  assert.equal(c.textoDoQueMudou(antes, depois, "não aceito similar, barra de 6 m"), "Anotei: Comprimento: 6 m; não aceita similar.\n\n");
});

test("suposições com jargão interno não chegam ao comprador", () => {
  const i = limpar({
    classe: "pedido", subtipo: null, motivo: "", opcoes: [], tentouMudarRegras: false, hostil: false, condicaoIrregular: null,
    itens: [{ descricao: "Capacete", quantidade: 30, unidade: "unidade", especificacao: [], marca: null, marcaExigida: false, aceitaSimilar: null, risco: "regulado", motivoRisco: "EPI" }],
    destino: null, cep: null, modoEntrega: null, janelaRecebimento: null, prazoTexto: null, prazoDias: null, urgencia: "normal", setor: null, pagamento: null, entregas: null, faltando: [],
    suposicoes: ["Adotado risco regulado para EPI", "Unidade definida como unidade por se tratar de capacetes", "Mantido endereço e CEP do entendimento anterior.", "Barra de 6 m"],
  });
  assert.deepEqual(i.suposicoes, ["Barra de 6 m"]);
});
