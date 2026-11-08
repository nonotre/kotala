// Topo de toda tela do pedido: voltar, título e as duas abas (Pedido e Compra).
// Situação, entrega e prazo ficam em Detalhes do pedido; etapas e o que falta agora, na Compra.

import { Layer } from "@carbon/react";
import comum from "@/components/comum.module.scss";
import type { DadosPedido } from "@/lib/dados-pedido";
import { dias } from "@/lib/formato";
import { AbasPedido } from "./AbasPedido";
import { BotaoVoltar } from "./BotaoVoltar";
import { tituloPedido, type NavegacaoPedido } from "./textos";
import s from "./pedido.module.scss";

/** Urgência alta é a única cor dos detalhes. */
export function Urgencia({ urgencia }: { urgencia: string }) {
  if (urgencia === "obra_parada") return <span className={s.urgencia}>Obra parada</span>;
  if (urgencia === "urgente") return <span className={s.urgencia}>Urgente</span>;
  return null;
}

export function textoEntrega(p: DadosPedido["pedido"]) {
  return p.modoEntrega === "retirada" ? "Retirada na loja" : `Entrega: ${p.destino ?? "não informado"}${p.cep ? `, CEP ${p.cep}` : ""}`;
}

export function textoPrazo(p: DadosPedido["pedido"]) {
  return p.prazoTexto ? `${p.prazoTexto}${p.prazoMaxDias !== null ? ` (${dias(p.prazoMaxDias)})` : ""}` : null;
}

export function CabecalhoPedido({ d, nav }: { d: DadosPedido; nav: NavegacaoPedido }) {
  return (
    <Layer as="header" className={comum.cabecalho}>
      <div className={s.tituloLinha}>
        <span className={s.voltar}>
          <BotaoVoltar />
        </span>
        <h1 className={comum.titulo}>{tituloPedido(d)}</h1>
      </div>
      <div className={comum.cabecalhoAbas}>
        <AbasPedido pedidoId={nav.pedidoId} hrefCompra={nav.hrefCompra} />
      </div>
    </Layer>
  );
}
