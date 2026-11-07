// Q8: Portal da Transparência pela API (chave gratuita, cabeçalho chave-api-dados).
// Uma chamada de pessoa-juridica traz as sanções na hora (CEIS, CNEP, CEPIM,
// CEAF) e se a empresa já fornece ao governo federal. Sem chave, não roda e a
// verificação usa os arquivos diários de dados abertos.

import { buscarHttp, comCache } from "../busca/rede.ts";
import { limparCnpj } from "./cnpj.ts";

export const temChavePortal = () => !!process.env.PORTAL_TRANSPARENCIA_CHAVE?.trim();

export type PortalPj = {
  /** Cadastros em que a empresa aparece sancionada. */
  sancoes: string[];
  /** Já contratou, participou de licitação ou emitiu nota ao governo federal. */
  forneceGoverno: boolean;
  sinais: string[];
};

type Bruto = Record<string, unknown>;

/** Só os indicadores; nada de dado pessoal. Exportada para teste. */
export function lerPessoaJuridica(b: Bruto): PortalPj {
  const sim = (k: string) => b[k] === true;
  const sancoes = (["CEIS", "CNEP", "CEPIM", "CEAF"] as const).filter((c) => sim(`sancionado${c}`));
  const sinais: string[] = [];
  if (sim("possuiContratacao")) sinais.push("tem contrato com o governo federal");
  if (sim("participanteLicitacao")) sinais.push("participou de licitação federal");
  if (sim("emitiuNFe")) sinais.push("emitiu nota fiscal ao governo federal");
  return { sancoes, forneceGoverno: sinais.length > 0, sinais };
}

/** null sem chave ou quando a API não responde: a verificação segue com as outras fontes. */
export async function consultarPortal(cnpj: string): Promise<PortalPj | null> {
  const chave = process.env.PORTAL_TRANSPARENCIA_CHAVE?.trim();
  if (!chave) return null;
  const c = limparCnpj(cnpj);
  try {
    const r = await comCache("portal-pj", c, { pago: false, guardarSe: (v: Bruto | null) => v !== null }, async () => {
      const res = await buscarHttp(`https://api.portaldatransparencia.gov.br/api-de-dados/pessoa-juridica?cnpj=${c}`, {
        timeoutMs: 10_000,
        headers: { "chave-api-dados": chave, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Portal da Transparência: HTTP ${res.status}`);
      const j = (await res.json()) as Bruto | Bruto[];
      return (Array.isArray(j) ? j[0] : j) ?? null;
    });
    return r?.valor ? lerPessoaJuridica(r.valor) : null;
  } catch (erro) {
    console.error("[portal]", erro instanceof Error ? erro.message : erro);
    return null;
  }
}
