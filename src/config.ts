// Configuração de negócio lida do ambiente, com padrões para a demo.

const num = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

/** Empresa fictícia que usa o sistema. Na demo fica em São Paulo, onde as lojas online entregam. */
export const EMPRESA = {
  nome: process.env.EMPRESA_NOME ?? "Empresa Exemplo Ltda.",
  /** Fictício na demo. */
  cnpj: process.env.EMPRESA_CNPJ ?? "00.000.000/0001-00",
  cidade: process.env.EMPRESA_CIDADE ?? "São Paulo/SP",
  /** Endereço de entrega padrão, usado quando o comprador não diz o destino. */
  enderecoEntrega: process.env.EMPRESA_ENDERECO ?? "Rua de Exemplo, 100, Bela Vista, São Paulo/SP",
  cep: process.env.EMPRESA_CEP ?? "01310-100",
  /** R11: janela de recebimento padrão, usada quando o pedido não diz outra. */
  janelaRecebimento: process.env.EMPRESA_JANELA_RECEBIMENTO ?? "dias úteis, das 8h às 17h",
  /** R11: quem recebe a mercadoria. Padrão neutro (setor, não pessoa) até a empresa dizer o nome. */
  recebedor: process.env.EMPRESA_RECEBEDOR ?? "Equipe de recebimento",
};

/** R13: condição de pagamento padrão da empresa, dita ao fornecedor. "À vista" quer dizer no recebimento. */
export const PAGAMENTO_PADRAO = "à vista, no recebimento da mercadoria (contra a nota fiscal)";

/** Q4: quanto tempo os fornecedores têm para responder na demo (15 minutos, pedido da Ester). */
export const PRAZO_RESPOSTAS_SEG = () => num(process.env.PRAZO_RESPOSTAS_SEG, 900);
/**
 * "demo" usa PRAZO_RESPOSTAS_SEG. "real" segue a regra da área de compras: 3 a 4 dias para
 * compras menores e 5 a 7 para maiores (usa o começo de cada faixa; a cotação fecha antes
 * se todos responderem).
 */
export const PRAZO_MODO = () => (process.env.PRAZO_MODO === "real" ? "real" : "demo");
/** Acima deste valor estimado (R$), a compra é "maior" e ganha o prazo longo. */
export const LIMITE_COMPRA_MAIOR = () => num(process.env.LIMITE_COMPRA_MAIOR, 5000);
const DIA_MS = 24 * 3600_000;

/** Prazo de respostas dos fornecedores, em ms. valorEstimado = referência pública × quantidade, quando houver. */
export function prazoRespostasMs(valorEstimado: number | null = null, negociacao = false): number {
  if (PRAZO_MODO() === "demo") return PRAZO_RESPOSTAS_SEG() * 1000;
  if (negociacao) return 2 * DIA_MS;
  return valorEstimado !== null && valorEstimado > LIMITE_COMPRA_MAIOR() ? 5 * DIA_MS : 3 * DIA_MS;
}

/**
 * Quanto tempo o comprador tem para terminar a solicitação (responder às perguntas e
 * confirmar). Nesse tempo, toda mensagem dele completa o pedido em aberto; depois de um
 * lembrete sem resposta, uma mensagem nova abre outro pedido.
 */
export const JANELA_CONFIRMACAO_MIN = () => num(process.env.JANELA_CONFIRMACAO_MIN, 60);
/** Lembrete sai nesta fração do prazo. */
export const FRACAO_LEMBRETE = 0.5;
/** Teto de fornecedores consultados por item. */
export const MAX_FORNECEDORES = () => num(process.env.MAX_FORNECEDORES, 8);
/** Multiplica os atrasos de resposta dos fornecedores simulados (0,2 deixa 5x mais rápido). */
export const SIM_ATRASO_FATOR = () => {
  const n = Number(process.env.SIM_ATRASO_FATOR);
  return Number.isFinite(n) && n >= 0 ? n : 1;
};

// ---------- Regras da IA da conversa (Frente 4), juntadas aqui na rodada 2 ----------

/** I3: levas de busca automática por rodada quando faltam propostas válidas (urgente: 1). */
export const MAX_AMPLIACOES = () => num(process.env.MAX_AMPLIACOES, 2);
/** I1: janela para responder ao pedido de desconto, em fração do prazo de respostas. */
export const NEGOCIACAO_ESPERA_FRACAO = 0.25;
/**
 * R14b: prazo vencido com menos de 3 propostas válidas. O comprador escolhe entre encerrar
 * e estender; ele tem esta fração do prazo de respostas para responder. Sem resposta, encerra.
 */
export const ESPERA_RESPOSTA_PRAZO_FRACAO = 0.5;
/** R14b: quantas vezes o comprador pode estender o prazo de um item na mesma rodada. */
export const MAX_PRORROGACOES = () => num(process.env.MAX_PRORROGACOES, 2);
/** U3: pergunta ao fornecedor sem resposta por mais que esta fração do prazo deixa de segurar a fila. */
export const ESPERA_PERGUNTA_FRACAO = 0.25;
/** G: nicho da empresa (ids de src/dominio/categorias.json); só escolhe exemplos e jargão, nunca limita pedidos. */
export const EMPRESA_NICHO = () => (process.env.EMPRESA_NICHO ?? "geral").split(",").map((s) => s.trim()).filter(Boolean);

/** Ester (revisaodochat.md): depois do pedido de desconto, nada mais sai ao fornecedor por pelo menos este tempo (ou até ele responder). */
export const ESPERA_MIN_DESCONTO_MS = () => num(process.env.ESPERA_MIN_DESCONTO_SEG, 300) * 1000;

/**
 * Fornecedor simulado (padrão 2 min): espera este tempo antes de responder sozinho, para dar tempo de alguém entrar no
 * Telegram simulado e responder como ele. Quem respondeu pela tela nesse tempo faz a persona pular a etapa;
 * a contagem recomeça na próxima mensagem do sistema. Não é multiplicado por SIM_ATRASO_FATOR.
 */
export const SIM_ESPERA_HUMANO_SEG = () => {
  const n = Number(process.env.SIM_ESPERA_HUMANO_SEG);
  return Number.isFinite(n) && n >= 0 ? n : 120;
};
