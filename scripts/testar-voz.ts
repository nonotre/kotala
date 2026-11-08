// X5: testa o agente de voz com o Gemini Live de verdade, falando por TEXTO no papel
// do fornecedor (o áudio de microfone fica nas telas, em /voz). Usa o banco de teste.
// npm run voz:testar

if (process.env.DATABASE_URL_TESTE) process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
const { GoogleGenAI, Modality } = await import("@google/genai");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { conexao, db, schema } = await import("../src/nucleo/index.ts");
const voz = await import("../src/agentes/voz/index.ts");

await migrate(db, { migrationsFolder: "drizzle" });
const [c] = await db.insert(schema.contato).values({ canal: "web", endereco: `voz-${Date.now()}`, papel: "comprador" }).returning();
const [p] = await db.insert(schema.pedido).values({ compradorId: c!.id, canalOrigem: "web", textoOriginal: "50 resmas de papel A4", destino: "Rua de Exemplo, 100, São Paulo/SP", cep: "01310-100", prazoTexto: "até quinta", pagamentoPreferido: "pix", estado: "em_andamento" }).returning();
const [i] = await db.insert(schema.itemPedido).values({ pedidoId: p!.id, ordem: 1, descricao: "Papel sulfite A4 75 g", quantidade: "50", unidade: "resma", estado: "cotando", aceitaSimilar: true, categoria: "Escritório e papelaria", prazoRespostasEm: new Date(Date.now() + 15 * 60_000) }).returning();
const [f] = await db.insert(schema.fornecedor).values({ nome: "Papelaria Teste da Voz", origem: "simulado" }).returning();
const [ct] = await db.insert(schema.cotacao).values({ itemPedidoId: i!.id, fornecedorId: f!.id, situacao: "aguardando", enviadaEm: new Date() }).returning();
// Outra cotação aguardando: a do teste não fecha o item no meio da conversa.
const [f2] = await db.insert(schema.fornecedor).values({ nome: "Outra Papelaria Teste", origem: "simulado" }).returning();
await db.insert(schema.cotacao).values({ itemPedidoId: i!.id, fornecedorId: f2!.id, situacao: "aguardando", enviadaEm: new Date() });

const dados = (await voz.dadosDaLigacao(ct!.id))!;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const falas = [
  "(a ligação foi atendida) Alô, Papelaria Teste, bom dia.",
  "Tenho sim. Sai a vinte e oito e noventa.",
  "É cada resma. O frete fica quarenta reais, entrego em dois dias. Pagamento no boleto de vinte e oito dias, a proposta vale sete dias, impostos inclusos.",
  "Isso mesmo, pode registrar.",
  "Não consigo baixar, o preço é esse.",
];
let transcricao = "";
let ferramenta: unknown = null;
let resolver: () => void = () => {};
const session = await ai.live.connect({
  model: voz.MODELO_VOZ(),
  config: {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    systemInstruction: voz.instrucoesDaLigacao(dados),
    tools: [{ functionDeclarations: [voz.FERRAMENTA_REGISTRAR as never] }],
  },
  callbacks: {
    onerror: (e) => console.error("erro:", (e as ErrorEvent).message ?? e),
    onmessage: async (msg) => {
      const sc = msg.serverContent;
      if (sc?.outputTranscription?.text) transcricao += sc.outputTranscription.text;
      if (msg.toolCall) {
        for (const fc of msg.toolCall.functionCalls ?? []) {
          ferramenta = fc.args;
          console.log(`\n  ✦ ${fc.name}(${JSON.stringify(fc.args)})`);
          const r = await voz.registrarCotacaoPorVoz(ct!.id, (fc.args ?? {}) as never, transcricao);
          console.log(`  → ${JSON.stringify(r)}`);
          session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: r }] });
        }
      }
      if (sc?.turnComplete) resolver();
    },
  },
});
for (const fala of falas) {
  const fim = new Promise<void>((r) => (resolver = r));
  console.log(`\nfornecedor: ${fala}`);
  transcricao += `\n[fornecedor] ${fala}\n[agente] `;
  session.sendClientContent({ turns: [{ role: "user", parts: [{ text: fala }] }], turnComplete: true });
  await Promise.race([fim, new Promise((r) => setTimeout(r, 30_000))]);
  console.log(`agente: ${transcricao.split("[agente] ").at(-1)?.trim()}`);
}
await new Promise((r) => setTimeout(r, 4000));
session.close();
const [o] = await db.select().from(schema.oferta).where((await import("drizzle-orm")).eq(schema.oferta.cotacaoId, ct!.id));
console.log("\noferta gravada:", o ? { preco: o.precoUnitario, frete: o.frete, prazo: o.prazoDias, pagamento: o.pagamento, prazoPagamento: o.prazoPagamentoDias, validade: o.validadeDias, entrega: o.entregaNoLocal, formato: o.formato } : "nenhuma");
console.log("extraido:", o ? JSON.stringify({ leituraPreco: (o.extraido as { leituraPreco?: string }).leituraPreco, aConfirmar: (o.extraido as { aConfirmar?: unknown }).aConfirmar, negociacao: (o.extraido as { negociacao?: unknown }).negociacao }) : "-");
const ok = !!o && Number(o.precoUnitario) === 28.9 && Number(o.frete) === 40 && o.prazoDias === 2;
console.log(ok ? "\n✔ a conversa virou proposta com os valores certos" : "\n✖ a proposta não saiu como esperado");
await conexao.end();
process.exit(ok ? 0 : 1);
