// Regressão dos erros do plano (docs/plano-ia.md) com a IA real: Interpretador e
// Extrator nos casos de src/simulador/casos/regressao.ts. Sem banco nem busca.
//
// npm run regressao:avaliar             # ~11 chamadas (mais a releitura forte quando a leitura é duvidosa)
// npm run regressao:avaliar -- --juiz   # também o juiz de clareza nas mensagens ao fornecedor (3 chamadas, modelo forte)
// npm run regressao:avaliar -- --so clips-nome,300-ambiguo

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta: só IA

const { z } = await import("zod");
const { CASOS_EXTRATOR, CASOS_INTERPRETADOR, RUBRICA_CLAREZA } = await import("../src/simulador/casos/regressao.ts");
const { interpretar } = await import("../src/agentes/interpretador/index.ts");
const { extrair } = await import("../src/agentes/extrator/index.ts");
const { aoRegistrarUso, gerarObjeto } = await import("../src/nucleo/ia/index.ts");

const args = process.argv.slice(2);
const i = args.indexOf("--so");
const so = i >= 0 ? args[i + 1]!.split(",") : null;
const escolhido = (id: string) => !so || so.includes(id);
let chamadas = 0;
aoRegistrarUso(() => chamadas++);
let falhas = 0;

console.log("Comprador → Interpretador\n");
for (const c of CASOS_INTERPRETADOR.filter((x) => escolhido(x.id))) {
  try {
    const r = await interpretar({ textoOriginal: c.texto });
    const erro = c.checar(r.valor);
    if (erro) falhas++;
    console.log(`${erro ? "✖" : "✔"} ${c.plano.padEnd(3)} ${c.id.padEnd(26)} ${erro ?? ""}  ${JSON.stringify({ classe: r.valor.classe, itens: r.valor.itens.map((x) => `${x.quantidade} ${x.unidade} ${x.descricao}`), faltando: r.valor.faltando })}`);
  } catch (e) {
    falhas++;
    console.log(`✖ ${c.plano.padEnd(3)} ${c.id.padEnd(26)} erro: ${String(e).slice(0, 120)}`);
  }
}

console.log("\nFornecedor → Extrator\n");
for (const c of CASOS_EXTRATOR.filter((x) => escolhido(x.id))) {
  try {
    const r = await extrair(c.item, { texto: c.texto });
    const erro = c.checar(r.valor);
    if (erro) falhas++;
    console.log(`${erro ? "✖" : "✔"} ${c.plano.padEnd(3)} ${c.id.padEnd(26)} ${erro ?? ""}  ${JSON.stringify({ leitura: r.valor.leituraPreco, unit: r.valor.precoUnitario, total: r.valor.totalProduto, aderencia: r.valor.aderencia, aConfirmar: r.valor.aConfirmar, pagamento: r.valor.pagamento })}`);
  } catch (e) {
    falhas++;
    console.log(`✖ ${c.plano.padEnd(3)} ${c.id.padEnd(26)} erro: ${String(e).slice(0, 120)}`);
  }
}

if (args.includes("--juiz")) {
  // U4: juiz de clareza nas mensagens fixas ao fornecedor (cotação, pedido de desconto, pergunta de preço).
  const { textoCotacao } = await import("../src/agentes/cotador/index.ts");
  const { montarNegociacao, escolherAlavancas } = await import("../src/agentes/negociador/index.ts");
  const { perguntaDeConfirmacao } = await import("../src/fluxo/fornecedor.ts");
  const { limpar } = await import("../src/agentes/extrator/index.ts");
  const dados = {
    item: { id: 12, rodada: 1, quantidade: "40", unidade: "saco", descricao: "Cimento Portland CP II 50 kg", itemChave: "cimento", aceitaSimilar: true, especificacao: { Tipo: "CP II-E 32" }, prazoRespostasEm: new Date(Date.now() + 3 * 3600_000) },
    pedido: { id: 3, modoEntrega: "entrega", destino: "Rua de Exemplo, 100, São Paulo/SP", cep: "01310-100", janelaRecebimento: "seg a sex, 7h às 16h", prazoTexto: "até sexta", entregas: null },
  } as never;
  const agora = new Date();
  const negociacao = montarNegociacao({
    alavancas: escolherAlavancas({ recompra: false, quantidade: 40, pagamento: "boleto 28 dias", frete: 60, entregas: null }),
    quantidade: "40", unidade: "saco", frete: 60, referencia: 38.5, janelaAte: new Date(agora.getTime() + 15 * 60_000), agora,
  }).texto;
  const base = { classificacao: "proposta" as const, duvida: null, itemOferecido: null, aderencia: "exato" as const, divergencias: [], leituraPreco: "ambiguo" as const, trechoPreco: "fica R$ 300", alertas: [], descontoPercentual: null, descontoValor: null, precoUnitario: 300, quantidadeOfertada: null, unidadeOfertada: null, embalagem: null, totalProduto: null, frete: 0, impostosValor: null, impostosNaoInclusos: null, prazoDias: 2, validadeDias: null, pagamento: null, prazoPagamentoDias: null, entregaNoLocal: null, cnpj: null };
  const pergunta = perguntaDeConfirmacao(limpar(base, { quantidade: 5 }), { id: 13, descricao: "Extintor ABC 6 kg", unidade: "unidade", quantidade: 5 });
  const mensagens = { cotacao: textoCotacao(dados, "Depósito Exemplo"), negociacao: `Recebi sua proposta para a cotação 12. Obrigado!\n${negociacao}`, pergunta_preco: pergunta };
  const Nota = z.object({ organizada: z.number().int().min(1).max(5), clara: z.number().int().min(1).max(5), coesa: z.number().int().min(1).max(5), melhorar: z.string() });
  console.log("\nJuiz de clareza (mensagens ao fornecedor)\n");
  for (const [nome, texto] of Object.entries(mensagens)) {
    try {
      const r = await gerarObjeto({ papel: "forte", schema: Nota, sistema: RUBRICA_CLAREZA, prompt: `<mensagem>\n${texto}\n</mensagem>`, contexto: { agente: "Juiz" } });
      const n = r.valor;
      console.log(`${nome.padEnd(15)} organizada ${n.organizada} · clara ${n.clara} · coesa ${n.coesa}  ${n.melhorar}`);
    } catch (e) {
      console.log(`${nome.padEnd(15)} erro: ${String(e).slice(0, 120)}`);
    }
  }
}

console.log(`\n${falhas ? `${falhas} falha(s)` : "Todos os casos passaram."} · ${chamadas} chamada(s) de IA`);
process.exit(falhas ? 1 : 0);
