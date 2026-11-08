// Pedaços comuns dos cenários: o pedido do comprador e os passos até o mapa e até a compra.

import type { InterpretacaoSimulada } from "../ia-falsa.ts";
import type { Passo } from "./tipos.ts";

export const TEXTO_CIMENTO = "40 sacos de cimento CP II 50 kg pra obra alfa, setor estrutura";

export const INTERPRETACAO_CIMENTO: InterpretacaoSimulada = {
  itens: [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", especificacao: [{ nome: "Tipo", valor: "CP II" }, { nome: "Peso", valor: "50 kg" }] }],
  destino: "obra alfa",
  setor: "estrutura",
};

export const QTD_CIMENTO = 40;

/** Comprador pede e confirma. */
export const PEDE_E_CONFIRMA: Passo[] = [{ diz: TEXTO_CIMENTO, interpretacao: INTERPRETACAO_CIMENTO }, { clica: /^Confirmar/ }];

/** Do mapa até o fornecedor confirmar o pedido de compra. */
export const APROVA_E_COMPRA: Passo[] = [{ espera: "aguardando_decisao" }, { clica: /^Aprovar/ }, { clica: /^Sim, aprovar/ }, { espera: "confirmado", timeoutSeg: 40 }];
