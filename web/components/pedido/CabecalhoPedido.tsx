// Topo de toda aba do pedido: trilha, título, contexto, etapas, abas e o que falta agora.

import { CabecalhoPagina } from "@/components/Pagina";
import type { DadosPedido } from "@/lib/dados-pedido";
import { dias, quantidade } from "@/lib/formato";
import { AbasPedido } from "./AbasPedido";
import { FaixaProximoPasso } from "./FaixaProximoPasso";
import { ProgressoPedido } from "./ProgressoPedido";
import { abasDoPedido, ESTADO_PEDIDO, progressoDoPedido, proximoPasso } from "./textos";
import s from "./pedido.module.scss";

/** Urgência alta é a única cor do cabeçalho. */
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

/** `Em andamento · Entrega: Sede · Setor: Manutenção · Prazo: até sexta (5 dias) · Urgente`. */
function ContextoPedido({ p, dono }: { p: DadosPedido["pedido"]; dono: string | null }) {
  const prazo = textoPrazo(p);
  return (
    <>
      {ESTADO_PEDIDO[p.estado]} · {dono ? `De ${dono}` : "Sem dono"} · {textoEntrega(p)}
      {p.setor ? ` · Setor: ${p.setor}` : ""}
      {prazo ? ` · Prazo: ${prazo}` : ""}
      {p.urgencia !== "normal" ? (
        <>
          {" · "}
          <Urgencia urgencia={p.urgencia} />
        </>
      ) : null}
    </>
  );
}

function tituloPedido(d: DadosPedido) {
  const { pedido: p, itens } = d;
  if (itens.length === 1) return `Pedido ${p.id}: ${quantidade(itens[0]!.item.quantidade, itens[0]!.item.unidade)} de ${itens[0]!.item.descricao}`;
  if (itens.length > 1) return `Pedido ${p.id}: ${itens.length} itens`;
  return `Pedido ${p.id}`;
}

export function CabecalhoPedido({ d }: { d: DadosPedido }) {
  return (
    <>
      <CabecalhoPagina
        trilha={[{ rotulo: "Quadro", href: "/quadro" }, { rotulo: "Pedidos", href: "/pedidos" }, { rotulo: `Pedido ${d.pedido.id}` }]}
        titulo={tituloPedido(d)}
        contexto={<ContextoPedido p={d.pedido} dono={d.dono} />}
        lado={
          <div className={s.progresso}>
            <ProgressoPedido progresso={progressoDoPedido(d)} />
          </div>
        }
        abas={<AbasPedido itens={abasDoPedido(d)} />}
      />
      <FaixaProximoPasso passo={proximoPasso(d)} />
    </>
  );
}
