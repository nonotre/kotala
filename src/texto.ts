// Formatação de texto para as mensagens, igual em todos os agentes.

export const fmtNumero = (n: number | string) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Plural só para exibição: "saco" → "sacos"; unidades de medida (m³, kg) não mudam. */
export function plural(unidade: string, quantidade: number | string): string {
  const u = unidade.trim();
  if (Number(quantidade) <= 1 || /[0-9³²]|^(kg|g|m|l|ml|cm|mm|un)$/i.test(u) || /s$/i.test(u)) return u;
  if (/[rz]$/i.test(u)) return `${u}es`;
  if (/m$/i.test(u)) return `${u.slice(0, -1)}ns`;
  if (/[aeiou]$/i.test(u)) return `${u}s`;
  return u;
}

/** "40 sacos", "1 saco", "2,5 m³". */
export const quantidade = (q: number | string, unidade: string) => `${fmtNumero(q)} ${plural(unidade, q)}`;

/** "1 dia", "3 dias". */
export const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;
