// Configuração de negócio lida do ambiente, com padrões para a demo.

const num = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

/** Empresa fictícia que usa o sistema. Na demo fica em São Paulo, onde as lojas online entregam. */
export const EMPRESA = {
  nome: process.env.EMPRESA_NOME ?? "Construtora Exemplo Ltda.",
  /** Fictício na demo. */
  cnpj: process.env.EMPRESA_CNPJ ?? "00.000.000/0001-00",
  cidade: process.env.EMPRESA_CIDADE ?? "São Paulo/SP",
  /** Endereço de entrega padrão, usado quando o comprador não diz o destino. */
  enderecoEntrega: process.env.EMPRESA_ENDERECO ?? "Obra Alfa, Rua de Exemplo, 100, Bela Vista, São Paulo/SP",
  cep: process.env.EMPRESA_CEP ?? "01310-100",
};

/** Q4: quanto tempo os fornecedores têm para responder na demo (5 minutos: dá tempo de uma pessoa responder). */
export const PRAZO_RESPOSTAS_SEG = () => num(process.env.PRAZO_RESPOSTAS_SEG, 300);
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
