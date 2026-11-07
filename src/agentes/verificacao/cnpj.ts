// CNPJ: validação dos dígitos, busca em página e consulta pública (BrasilAPI,
// com Minha Receita de reserva). Sócios, e-mail e telefone são descartados
// antes de guardar: o sistema não guarda dado pessoal.

import { buscarHttp, comCache } from "../busca/rede.ts";

export const limparCnpj = (s: string) => s.replace(/\D/g, "");

export function formatarCnpj(c: string): string {
  const d = limparCnpj(c);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c;
}

/** Confere os dois dígitos verificadores. */
export function cnpjValido(c: string): boolean {
  const d = limparCnpj(c);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((t, n, i) => t + Number(n) * pesos[i]!, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digito(d.slice(0, 12)) === Number(d[12]) && digito(d.slice(0, 13)) === Number(d[13]);
}

/** CNPJs válidos citados num texto ou HTML, na ordem em que aparecem, sem repetir. */
export function acharCnpjs(texto: string): string[] {
  const achados: string[] = [];
  for (const m of texto.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    const c = limparCnpj(m[0]);
    if (cnpjValido(c) && !achados.includes(c)) achados.push(c);
  }
  return achados;
}

export type DadosCnpj = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string;
  abertura: string | null;
  municipio: string | null;
  uf: string | null;
  atividade: string | null;
  matrizOuFilial: string | null;
  fonte: "BrasilAPI" | "Minha Receita";
};

type Bruto = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Só o que interessa para a verificação. Nada de sócios, e-mail ou telefone. */
function sanitizar(cnpj: string, b: Bruto, fonte: DadosCnpj["fonte"]): DadosCnpj {
  return {
    cnpj,
    razaoSocial: str(b.razao_social) ?? "",
    nomeFantasia: str(b.nome_fantasia),
    situacao: str(b.descricao_situacao_cadastral) ?? "DESCONHECIDA",
    abertura: str(b.data_inicio_atividade),
    municipio: str(b.municipio),
    uf: str(b.uf),
    atividade: str(b.cnae_fiscal_descricao),
    matrizOuFilial: str(b.descricao_identificador_matriz_filial) ?? str(b.descricao_matriz_filial),
    fonte,
  };
}

/** null quando o CNPJ não existe; lança erro quando as duas fontes estão fora do ar. */
export async function consultarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const c = limparCnpj(cnpj);
  if (!cnpjValido(c)) return null;
  const r = await comCache("cnpj", c, { pago: false }, async () => {
    for (const [fonte, url] of [
      ["BrasilAPI", `https://brasilapi.com.br/api/cnpj/v1/${c}`],
      ["Minha Receita", `https://minhareceita.org/${c}`],
    ] as const) {
      try {
        const res = await buscarHttp(url, { timeoutMs: 8_000 });
        if (res.status === 404) return { naoExiste: true };
        if (!res.ok) continue;
        return sanitizar(c, (await res.json()) as Bruto, fonte);
      } catch {
        // tenta a próxima fonte
      }
    }
    throw new Error("Consulta de CNPJ fora do ar agora.");
  });
  if (!r || "naoExiste" in (r.valor as object)) return null;
  return r.valor as DadosCnpj;
}
