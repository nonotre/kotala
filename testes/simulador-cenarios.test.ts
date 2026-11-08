// Simulador geral (frente-3-simulador.md, 3.1 a 3.6): trava de rede, IA falsa, conferência
// do gabarito e, com DATABASE_URL_TESTE, dois cenários de ponta a ponta no modo
// determinístico. Nenhuma chamada de IA nem de rede sai daqui.
import assert from "node:assert/strict";
import { test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";

const rede = await import("../src/simulador/rede.ts");
const ia = await import("../src/simulador/ia-falsa.ts");
const g = await import("../src/simulador/cenarios/gabarito.ts");
const { CENARIOS } = await import("../src/simulador/cenarios/index.ts");
const { situacao, rodadaPassou } = await import("../src/simulador/relatorio.ts");
type Rastro = import("../src/simulador/cenarios/tipos.ts").Rastro;

test("trava de rede: só o banco local e o Gemini; o resto falha alto e fica anotado", async () => {
  const u = (s: string) => new URL(s);
  assert.equal(rede.destinoDaChamada(u("http://127.0.0.1:5433/x")), "local");
  assert.equal(rede.destinoDaChamada(u("http://localhost:3000/api")), "local");
  assert.equal(rede.destinoDaChamada(u("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent")), "gemini");
  assert.equal(rede.destinoDaChamada(u("http://generativelanguage.googleapis.com/")), "bloqueada", "Gemini só por https");
  for (const s of ["https://google.serper.dev/search", "https://www.leroymerlin.com.br/api/catalog_system/pub/products/search", "https://brasilapi.com.br/api/cnpj/v1/1", "https://esaj.tjsp.jus.br/", "https://api.telegram.org/bot1/getMe", "https://portaldatransparencia.gov.br/x"]) {
    assert.equal(rede.destinoDaChamada(u(s)), "bloqueada", s);
  }
  assert.ok(rede.semRedeLigado({ SIM_SEM_REDE: "1" }));
  assert.ok(!rede.semRedeLigado({}));

  const t = rede.instalarTravaDeRede({ iaFalsa: ia.iaFalsa });
  try {
    rede.zerarContadoresDeRede();
    await assert.rejects(fetch("https://google.serper.dev/search", { method: "POST" }), rede.RedeBloqueada);
    await assert.rejects(fetch("https://brasilapi.com.br/api/cnpj/v1/00000000000191"), rede.RedeBloqueada);
    assert.deepEqual(t.bloqueadas.map((b) => b.url), ["https://google.serper.dev/search", "https://brasilapi.com.br/api/cnpj/v1/00000000000191"]);
  } finally {
    rede.desinstalarTravaDeRede();
  }
});

test("IA falsa: o Extrator e o Interpretador de verdade recebem a leitura do cenário, sem rede", async () => {
  const chavesIa = ["GEMINI_API_KEY", "GEMINI_API_KEY_RESERVA", "IA_MODELOS_RAPIDO", "IA_MODELOS_FORTE", "IA_MODELOS_CONVERSA", "IA_MODELOS_CONVERSA_FORTE", "IA_MODELOS_JUIZ"];
  const antes = Object.fromEntries(chavesIa.map((k) => [k, process.env[k]]));
  ia.ambienteIaFalsa();
  const { reiniciarIa } = await import("../src/nucleo/ia/index.ts");
  reiniciarIa();
  const t = rede.instalarTravaDeRede({ iaFalsa: ia.iaFalsa });
  try {
    ia.limparIaFalsa();
    ia.registrarLeitura("40 sacos a R$ 30,00 cada, frete R$ 60,00", { classificacao: "proposta", precoUnitario: 30, totalProduto: 1200, frete: 60, quantidadeOfertada: 40 });
    const { extrair } = await import("../src/agentes/extrator/index.ts");
    const item = { descricao: "Cimento CP II", quantidade: 40, unidade: "saco", aceitaSimilar: true, destino: null, modoEntrega: null };
    const r = await extrair(item, { texto: "40 sacos a R$ 30,00 cada, frete R$ 60,00" });
    assert.equal(r.modelo, ia.MODELO_FALSO);
    assert.equal(r.valor.classificacao, "proposta");
    assert.equal(r.valor.precoUnitario, 30);
    assert.equal(r.valor.frete, 60);
    // Texto sem leitura registrada: recado sem preço, e a falta fica anotada para o relatório.
    const s = await extrair(item, { texto: "texto que ninguém registrou" });
    assert.equal(s.valor.classificacao, "outro");
    assert.equal(ia.semResposta.length, 1);

    ia.registrarInterpretacao("40 cp2 pra obra", { itens: [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }], setor: "estrutura" });
    const { interpretar } = await import("../src/agentes/interpretador/index.ts");
    const i = await interpretar({ textoOriginal: "40 cp2 pra obra" });
    assert.equal(i.valor.itens[0]!.descricao, "Cimento CP II 50 kg");
    assert.equal(i.valor.setor, "estrutura");

    // Agente sem resposta simulada: erro 400, e o código usa a reserva dele.
    const { gerarTexto } = await import("../src/nucleo/ia/index.ts");
    await assert.rejects(gerarTexto({ papel: "forte", prompt: "explique o mapa" }), /não tem resposta simulada/);
    assert.equal(t.bloqueadas.length, 0);
    assert.equal(t.geminiReais, 0);
  } finally {
    rede.desinstalarTravaDeRede();
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    reiniciarIa();
  }
});

function rastroVazio(): Rastro {
  return {
    cenario: "x",
    pedidoId: 1,
    pedidoEstado: "em_andamento",
    itens: [{ id: 1, descricao: "Cimento", estado: "aguardando_decisao", rodada: 1 }],
    mensagens: [],
    eventos: [],
    mapas: [],
    cotacoes: [],
    contatos: [],
    verdades: {},
    rede: { bloqueadas: [], geminiReais: 0, geminiFalsas: 0 },
    iaSemResposta: [],
    usoIa: { chamadas: 0, falhas: 0 },
    passosFalhos: [],
    erros: [],
    duracaoMs: 0,
  };
}

test("conferência: mapa, desconto em mensagem própria e valor de outro fornecedor", () => {
  const r = rastroVazio();
  const linha = (fornecedor: string, custo: number) => ({ fornecedor, custo, alertas: [], motivos: [], negociacao: null, aConfirmar: false });
  r.mapas.push({ itemPedidoId: 1, rodada: 1, validas: [linha("a", 100), linha("b", 110)], cortadas: [], recomendada: "a", em: 5000 });
  assert.ok(g.mapaSai({ validas: 2, recomendada: "a" }).conferir(r).ok);
  assert.ok(!g.mapaSai({ validas: 3 }).conferir(r).ok);
  assert.ok(g.custoNoMapa("b", 110, "x").conferir(r).ok);

  // Desconto: recebimento, depois o pedido sozinho; nada sai antes da espera ou da resposta.
  const m = (em: number, direcao: "saida" | "entrada", texto: string, tipo?: string) => ({ com: "a", direcao, texto, em, ...(tipo ? { tipo } : {}) }) as Rastro["mensagens"][number];
  r.mensagens.push(m(0, "entrada", "R$ 30,00 cada"), m(100, "saida", "Recebi sua proposta", "proposta_recebida"), m(200, "saida", "Conseguiria desconto?", "negociacao"));
  assert.ok(g.descontoEmMensagemPropria("a", 5).conferir(r).ok);
  r.mensagens.push(m(1200, "saida", "Lembrete: ainda dá tempo", "lembrete"));
  assert.ok(!g.descontoEmMensagemPropria("a", 5).conferir(r).ok, "outra mensagem 1 s depois do desconto, sem resposta");
  r.mensagens.splice(-1, 1, m(1000, "entrada", "Não consigo"), m(1200, "saida", "Combinado", "resposta"));
  assert.ok(g.descontoEmMensagemPropria("a", 5).conferir(r).ok, "depois da resposta pode");

  const valorDeOutro = g.GLOBAIS.find((e) => e.regra === "07/11")!;
  r.mensagens.push({ com: "b", direcao: "entrada", texto: "Fica R$ 27,50 cada", em: 300 });
  assert.ok(valorDeOutro.conferir(r).ok);
  r.mensagens.push({ com: "a", direcao: "saida", texto: "Outro fornecedor fez R$ 27,50, consegue igualar?", tipo: "negociacao", em: 400 });
  const res = valorDeOutro.conferir(r);
  assert.ok(!res.ok);
  assert.match(res.detalhe!, /27,50 de b/);
});

test("relatório: esperado falhar não reprova a rodada; passar sem o recurso é anotado", () => {
  const base = { titulo: "t", resultados: [], duracaoMs: 0, usoIa: { chamadas: 0, falhas: 0 }, rede: { bloqueadas: [], geminiReais: 0, geminiFalsas: 0 } };
  const xf = { ...base, cenario: "s", esperadoFalhar: "ainda não existe", passou: false };
  const ok = { ...base, cenario: "f", esperadoFalhar: null, passou: true };
  assert.equal(situacao(xf), "falhou (esperado)");
  assert.equal(situacao({ ...xf, passou: true }), "passou (inesperado)");
  assert.ok(rodadaPassou([ok, xf]));
  assert.ok(!rodadaPassou([ok, { ...ok, passou: false }]));
});

test("cenários bem formados: chaves únicas, personas cen-, leituras válidas para a IA falsa", () => {
  const chaves = CENARIOS.map((c) => c.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  for (const k of ["feliz", "prazo", "desconto", "parar", "sobe-preco", "servico"]) assert.ok(chaves.includes(k), k);
  for (const c of CENARIOS) {
    assert.ok(c.gabarito.length >= 3, `${c.chave}: gabarito curto`);
    for (const p of c.fornecedores) {
      assert.match(p.chave, /^cen-/);
      const item = { id: 1, descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", rodada: 1 };
      for (const gat of p.roteiro) {
        for (const f of gat.falas) {
          const e = f.escrever({ item, persona: p, recebida: { texto: "", botoes: [{ rotulo: "Confirmo", dado: "compra:1:confirmo" }] } });
          if (e?.leitura) assert.doesNotThrow(() => ia.leituraCompleta(e.leitura!), `${c.chave}/${p.chave}: ${f.descricao}`);
        }
      }
    }
  }
});

// Ponta a ponta no banco de teste, IA falsa, prazos de segundos (~15 s no total).
const e2e = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
test("ponta a ponta: caminho feliz e PARAR passam no gabarito, sem rede e sem IA", { skip: e2e, timeout: 120_000 }, async () => {
  const { rodarCenario, encerrarSimulador } = await import("../src/simulador/executor.ts");
  try {
    for (const chave of ["feliz", "parar"]) {
      const c = CENARIOS.find((x) => x.chave === chave)!;
      const rastro = await rodarCenario(c, { ia: false });
      const r = g.conferir(c, rastro);
      const falhas = r.resultados.filter((x) => !x.ok).map((x) => `${x.descricao}: ${x.detalhe ?? ""}`);
      assert.deepEqual(falhas, [], chave);
      assert.equal(rastro.rede.geminiReais, 0);
      assert.ok(rastro.rede.geminiFalsas > 0, "a IA falsa respondeu");
    }
  } finally {
    await encerrarSimulador();
    rede.desinstalarTravaDeRede();
  }
});
