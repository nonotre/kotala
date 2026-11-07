// Textos comuns das telas de operação. Sem banco e sem "use client": servem ao servidor e ao cliente.

import type { TipoAviso } from "@/lib/avisos";

/** O verbo diz o que o comprador vai fazer na tela de destino. Nunca "Aprovar": aprovar só com confirmação. */
export const VERBO_DO_AVISO: Record<TipoAviso, string> = {
  confirmar_pedido: "Conferir o pedido",
  decidir: "Ir para Decisão",
  recompra: "Repetir ou cotar",
  sem_proposta: "Ver o pedido",
};

export const ROTULO_CANAL: Record<string, string> = {
  web: "Aqui no app",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "E-mail",
  voz: "Voz",
  simulado: "Simulado",
};

export const nomeDoCanal = (canal: string) => ROTULO_CANAL[canal] ?? canal;

export const ESTADO_PEDIDO: Record<string, string> = {
  interpretando: "Lendo o pedido",
  aguardando_confirmacao: "Aguardando sua confirmação",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
