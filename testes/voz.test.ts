// X5: agente de voz. Testes puros, sem banco e sem IA: sessão full duplex (transcrição,
// silêncio, tempo), leitura da ferramenta na forma do Extrator, instruções e respostas.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const s = await import("../src/agentes/voz/sessao.ts");
const v = await import("../src/agentes/voz/conversa.ts");
type Dados = import("../src/agentes/voz/conversa.ts").DadosLigacao;

// ---------- Sessão ----------

test("transcrição: o rótulo só entra quando muda quem fala, e os pedaços vão colados", () => {
  let t = "";
  t = s.acrescentarFala(t, "agente", "Bom dia, aqui é o assis");
  t = s.acrescentarFala(t, "agente", "tente da empresa.");
  t = s.acrescentarFala(t, "fornecedor", " Alô");
  t = s.acrescentarFala(t, "fornecedor", ", pode falar.");
  t = s.acrescentarFala(t, "agente", "Qual o preço?");
  assert.equal(t, "[agente] Bom dia, aqui é o assistente da empresa.\n[fornecedor] Alô, pode falar.\n[agente] Qual o preço?");
  assert.equal(s.falasDe(t, "fornecedor"), "Alô, pode falar.");
  assert.equal(s.acrescentarFala(t, "agente", ""), t);
});

test("transcrição longa guarda o começo e o fim (onde está a confirmação)", () => {
  const t = `[agente] começo ${"x".repeat(20_000)} [fornecedor] isso mesmo, pode registrar`;
  const c = s.cortarTranscricao(t);
  assert.ok(c.length <= s.MAX_TRANSCRICAO);
  assert.ok(c.startsWith("[agente] começo"));
  assert.ok(c.endsWith("pode registrar"));
  assert.equal(s.cortarTranscricao("curta"), "curta");
});

test("silêncio: avisa uma vez, encerra depois; o agente falando não é silêncio", () => {
  const base = { inicio: 0, ultimaAtividade: 0, agenteFalando: false, avisouSilencio: false, avisouTempo: false };
  assert.equal(s.acaoDaSessao({ ...base, agora: s.SILENCIO_AVISO_MS - 1 }), "nada");
  assert.equal(s.acaoDaSessao({ ...base, agora: s.SILENCIO_AVISO_MS }), "avisar_silencio");
  assert.equal(s.acaoDaSessao({ ...base, agora: s.SILENCIO_AVISO_MS + 1000, avisouSilencio: true }), "nada");
  assert.equal(s.acaoDaSessao({ ...base, agora: s.SILENCIO_ENCERRA_MS, avisouSilencio: true }), "encerrar_silencio");
  assert.equal(s.acaoDaSessao({ ...base, agora: s.SILENCIO_ENCERRA_MS, agenteFalando: true }), "nada");
});

test("tempo máximo: avisa um minuto antes e encerra no limite, mesmo com o agente falando", () => {
  const base = { inicio: 0, agenteFalando: true, avisouSilencio: false, avisouTempo: false };
  assert.equal(s.acaoDaSessao({ ...base, agora: s.DURACAO_AVISO_MS, ultimaAtividade: s.DURACAO_AVISO_MS }), "avisar_tempo");
  assert.equal(s.acaoDaSessao({ ...base, agora: s.DURACAO_AVISO_MS + 5000, ultimaAtividade: s.DURACAO_AVISO_MS, avisouTempo: true }), "nada");
  assert.equal(s.acaoDaSessao({ ...base, agora: s.DURACAO_MAX_MS, ultimaAtividade: s.DURACAO_MAX_MS, avisouTempo: true }), "encerrar_tempo");
});

test("resposta da ferramenta tem sempre ok e resposta, mesmo com o servidor fora", () => {
  assert.deepEqual(s.respostaDaFerramenta({ ok: true, resposta: "Proposta registrada." }), { ok: true, resposta: "Proposta registrada." });
  assert.equal(s.respostaDaFerramenta({ erro: "Corpo grande demais" }).ok, false);
  assert.match(s.respostaDaFerramenta(null).resposta, /comprador retorna/);
});

// ---------- Leitura da ferramenta (mesma forma do Extrator) ----------

test("Q1: preço só com um número e quantidade maior que 1 fica a confirmar, sem virar total em silêncio", () => {
  const { e } = v.lerArgs({ preco_total: 300, leitura_preco: "ambiguo", prazo_dias: 3 }, { quantidade: 40 });
  assert.equal(e.classificacao, "proposta");
  assert.equal(e.leituraPreco, "ambiguo");
  assert.equal(e.precoUnitario, 300); // como no Extrator: o número fica em precoUnitario
  assert.equal(e.totalProduto, null);
  assert.deepEqual(e.aConfirmar, ["preco"]);
});

test("Q1: unitário e total que não batem com a quantidade ficam a confirmar; quantidade 1 não é ambígua", () => {
  assert.deepEqual(v.lerArgs({ preco_unitario: 10, preco_total: 300, leitura_preco: "unitario" }, { quantidade: 40 }).e.aConfirmar, ["preco"]);
  assert.equal(v.lerArgs({ preco_unitario: 10, preco_total: 400 }, { quantidade: 40 }).e.aConfirmar, undefined);
  const um = v.lerArgs({ preco_total: 1200, leitura_preco: "ambiguo" }, { quantidade: 1 }).e;
  assert.equal(um.leituraPreco, "total");
  assert.equal(um.totalProduto, 1200);
  assert.equal(um.aConfirmar, undefined);
});

test("valores conferidos em código: número em texto, dias inválidos e alerta desconhecido", () => {
  const { e } = v.lerArgs({ preco_unitario: "37,50", frete: -5, prazo_dias: 2.5, validade_dias: 900, alertas: ["propina", "inventado"], pagamento: "  boleto 28 dias " }, { quantidade: 40 });
  assert.equal(e.precoUnitario, 37.5);
  assert.equal(e.frete, null);
  assert.equal(e.prazoDias, null);
  assert.equal(e.validadeDias, null);
  assert.deepEqual(e.alertas, ["propina"]);
  assert.equal(e.pagamento, "boleto 28 dias");
});

test("Q2: outra marca sem aderência dita fica a confirmar; equivalente segue exato no item_exato", () => {
  const a = v.lerArgs({ preco_unitario: 10, item_oferecido: "Marca X" }, { quantidade: 5 }).e;
  assert.equal(a.aderencia, "a_confirmar");
  assert.deepEqual(a.aConfirmar, ["item"]);
  assert.equal(a.itemExato, true);
  const b = v.lerArgs({ preco_unitario: 10, item_oferecido: "Marca X", aderencia: "equivalente", divergencias: ["marca X, não exigida", " "] }, { quantidade: 5 }).e;
  assert.equal(b.itemExato, true);
  assert.deepEqual(b.divergencias, ["marca X, não exigida"]);
  const c = v.lerArgs({ preco_unitario: 10, item_oferecido: "Extintor 6 kg", aderencia: "diferente" }, { quantidade: 5 }).e;
  assert.equal(c.itemExato, false);
});

test("parar, não atende, desconto e resposta ao desconto", () => {
  assert.equal(v.lerArgs({ parar: true, preco_unitario: 10 }, { quantidade: 2 }).e.classificacao, "parar");
  assert.equal(v.lerArgs({ nao_atende: true }, { quantidade: 2 }).e.classificacao, "recusa");
  const d = v.lerArgs({ desconto_percentual: 5, desconto_condicao: "à vista", resposta_desconto: "condicional", preco_no_limite: true }, { quantidade: 2 });
  assert.equal(d.e.descontoPercentual, 5);
  assert.equal(d.e.descontoCondicao, "à vista");
  assert.equal(d.e.classificacao, "outro"); // sem preço: completa a proposta anterior
  assert.equal(d.respostaDesconto, "condicional");
  assert.equal(d.firme, true);
  assert.equal(v.lerArgs({ resposta_desconto: "inventada" }, { quantidade: 2 }).respostaDesconto, null);
});

test("chamada repetida: mesmos argumentos em outra ordem contam como a mesma", () => {
  assert.ok(v.mesmosArgs({ preco_unitario: 10, prazo_dias: 2 }, { prazo_dias: 2, preco_unitario: 10, frete: undefined }));
  assert.ok(!v.mesmosArgs({ preco_unitario: 10 }, { preco_unitario: 9 }));
  assert.ok(!v.mesmosArgs(undefined, { preco_unitario: 9 }));
});

// ---------- Respostas ao agente ----------

test("o que falta segue o texto, sem frete na retirada", () => {
  const e = { prazoDias: null, frete: null, pagamento: "pix", validadeDias: null };
  assert.deepEqual(v.faltasDaProposta(e, false), ["o prazo de entrega", "o frete", "a validade da proposta"]);
  assert.deepEqual(v.faltasDaProposta(e, true), ["o prazo de entrega", "a validade da proposta"]);
});

test("confirmação falada de preço e item", () => {
  const t = v.confirmacaoFalada({ aConfirmar: ["preco", "item"], precoUnitario: 300, totalProduto: null, itemOferecido: "Marca X", divergencias: ["marca não exigida"] }, { descricao: "Luva nitrílica", unidade: "caixa", quantidade: 10 });
  assert.match(t!, /R\$ 300,00 é o preço por caixa ou o total para 10 caixas/);
  assert.match(t!, /item oferecido \(Marca X\) atende ao pedido de Luva nitrílica \(conferir: marca não exigida\)/);
  assert.equal(v.confirmacaoFalada({ aConfirmar: undefined, precoUnitario: 1, totalProduto: null, itemOferecido: null, divergencias: [] }, { descricao: "x", unidade: "un", quantidade: 1 }), null);
});

test("desconto falado: tira o horário de resposta e barra valor que não seja permitido", () => {
  const montado = "Por gentileza, conseguiria desconto na cotação?\nO frete de R$ 80,00 pode ser reduzido ou incluído no preço?\nSe não for possível, sem problema: a proposta continua valendo.\nRespondo ao comprador até 14:30.";
  const t = v.descontoParaFalar(montado, [80]);
  assert.ok(t && !/Respondo/.test(t));
  assert.match(t!, /frete de R\$ 80,00/);
  assert.equal(v.descontoParaFalar(montado, []), null);
  assert.equal(v.descontoParaFalar("O outro fornecedor fez mais barato.", []), null);
});

test("resposta ao registrar: confirmar e completar vêm antes do desconto; sem pendência, encerra", () => {
  const base = { aConfirmar: null, faltam: [] as string[], desconto: null, ressalva: null, aberta: true };
  assert.match(v.respostaAoRegistrar(base), /Agradeça, diga que o comprador decide/);
  assert.match(v.respostaAoRegistrar({ ...base, aberta: false }), /já fechou para comparação/);
  const comFalta = v.respostaAoRegistrar({ ...base, faltam: ["o frete"], desconto: "Por gentileza, conseguiria desconto na cotação?" });
  assert.match(comFalta, /Ainda falta: o frete/);
  assert.doesNotMatch(comFalta, /desconto/);
  const comDesconto = v.respostaAoRegistrar({ ...base, desconto: "Por gentileza, conseguiria desconto na cotação?" });
  assert.match(comDesconto, /peça desconto uma única vez/);
  assert.match(comDesconto, /resposta_desconto manteve/);
  assert.match(v.respostaAoRegistrar({ ...base, ressalva: "Não aceitamos comissão nem vantagem." }), /Diga ao fornecedor: "Não aceitamos comissão/);
});

// ---------- Instruções ----------

const dados = (mudar: { item?: Partial<Dados["item"]>; pedido?: Partial<Dados["pedido"]>; resto?: Partial<Dados> } = {}): Dados => ({
  cotacaoId: "00000000-0000-0000-0000-000000000000",
  situacao: "aguardando",
  rodada: 1,
  fornecedor: "Papelaria Exemplo",
  simulado: true,
  anterior: null,
  desconto: "nao_pedido",
  ...mudar.resto,
  item: { id: 12, descricao: "Papel A4 75 g", quantidade: "50", unidade: "resma", estado: "cotando", rodada: 1, aceitaSimilar: true, especificacao: { gramatura: "75 g" }, codigo: null, categoria: "Escritório e papelaria", ...mudar.item },
  pedido: { id: 7, destino: "Rua de Exemplo, 100", cep: "01310-100", prazoTexto: "até sexta", modoEntrega: "entrega", janelaRecebimento: "8h às 17h", entregas: null, pagamentoPreferido: "pix", comprador: "Ester", ...mudar.pedido },
});

test("instruções: generalista, com especificação, jargão da categoria, preferência de pagamento e só o nome de quem compra", () => {
  const t = v.instrucoesDaLigacao(dados());
  assert.match(t, /50 resmas de Papel A4 75 g/);
  assert.match(t, /Especificação: gramatura: 75 g/);
  assert.match(t, /resma: pacote de papel/);
  assert.match(t, /CIF, FOB/);
  assert.match(t, /Pagamento preferido do comprador: pix/);
  assert.match(t, /Quem compra: Ester \(só o nome\)/);
  assert.match(t, /por resma ou o total para 50 resmas/);
  assert.match(t, /Nunca diga: dados bancários/);
  assert.doesNotMatch(t, /\bobra\b|cimento|canteiro/i);
});

test("instruções: retirada não pergunta frete nem entrega; nova rodada cita só a proposta dele; desconto já pedido por texto", () => {
  const r = v.instrucoesDaLigacao(dados({ pedido: { modoEntrega: "retirada" } }));
  assert.doesNotMatch(r, /o frete até o local|se entrega no local/);
  assert.match(r, /Retirada na loja/);
  const n = v.instrucoesDaLigacao(dados({ resto: { rodada: 2, anterior: { precoUnitario: 25.9, totalProduto: null, rodada: 1 } } }));
  assert.match(n, /nova rodada.*R\$ 25,90 por resma/);
  assert.match(v.instrucoesDaLigacao(dados({ resto: { desconto: "aberto" } })), /já pedimos desconto e ele ainda não respondeu/);
  assert.match(v.instrucoesDaLigacao(dados({ resto: { desconto: "respondido" } })), /não peça desconto de novo/);
});

test("conferência de saída: só os dados do pedido (as instruções citam os sinais de risco de propósito)", () => {
  assert.ok(v.conferirPedidoDaLigacao(dados()).ok);
  assert.match(v.instrucoesDaLigacao(dados()), /sem nota/);
  assert.equal(v.conferirPedidoDaLigacao(dados({ item: { descricao: "Papel A4 sem nota" } })).ok, false);
  assert.equal(v.conferirFalaDoAgente("[agente] Pode pagar por fora, na conta pessoal.\n[fornecedor] sem nota").ok, false);
  assert.ok(v.conferirFalaDoAgente("[agente] Só compramos com nota fiscal.\n[fornecedor] faço sem nota").ok);
});
