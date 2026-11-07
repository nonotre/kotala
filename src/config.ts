// Configuração de negócio lida do ambiente, com padrões para a demo.

const num = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

export const EMPRESA = {
  nome: process.env.EMPRESA_NOME ?? "Construtora Exemplo Ltda.",
  /** Fictício na demo. */
  cnpj: process.env.EMPRESA_CNPJ ?? "00.000.000/0001-00",
};

/** Q4: quanto tempo os fornecedores têm para responder. Cerca de 2 minutos na demo. */
export const PRAZO_RESPOSTAS_SEG = () => num(process.env.PRAZO_RESPOSTAS_SEG, 120);
/** Lembrete sai nesta fração do prazo. */
export const FRACAO_LEMBRETE = 0.5;
/** Teto de fornecedores consultados por item. */
export const MAX_FORNECEDORES = () => num(process.env.MAX_FORNECEDORES, 8);
/** Multiplica os atrasos de resposta dos fornecedores simulados (0,2 deixa 5x mais rápido). */
export const SIM_ATRASO_FATOR = () => {
  const n = Number(process.env.SIM_ATRASO_FATOR);
  return Number.isFinite(n) && n >= 0 ? n : 1;
};
