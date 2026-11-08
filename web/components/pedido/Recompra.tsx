// Compra repetida: o item foi comprado há pouco, e o comprador escolhe repetir com o
// mesmo fornecedor ou cotar de novo. Fica na etapa Comparando, onde o item espera.

import { Bloco } from "@/components/Bloco";
import { BotaoAcao } from "@/components/BotaoAcao";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dataHora, dias, quantidade } from "@/lib/formato";
import s from "./pedido.module.scss";

export function Recompra({ i }: { i: ItemDoPedido }) {
  const { item, recompra } = i;
  if (!recompra) return null;
  return (
    <Bloco titulo="Você comprou este item há pouco tempo" descricao="Compras repetidas em menos de 3 meses quase não mudam de preço. A decisão é sua.">
      <p className={s.texto}>
        Última compra: <strong>{recompra.fornecedorNome}</strong>, em {dataHora(recompra.data)}, a {brl(recompra.precoUnitario)} por {item.unidade}
        {recompra.frete !== null ? `, frete ${brl(recompra.frete)}` : ""}. {recompra.simulado ? <SeloSimulado /> : null}
      </p>
      {recompra.prazoPrometidoDias !== null ? (
        <p className={s.ajuda}>
          Prazo combinado: {dias(recompra.prazoPrometidoDias)}
          {recompra.prazoCumprido === true ? ", cumprido" : ""}. {recompra.comprasNoPeriodo > 1 ? `Comprou ${recompra.comprasNoPeriodo} vezes com ele nos últimos 90 dias.` : ""}
        </p>
      ) : null}
      {recompra.experiencia ? <p className={s.ajuda}>Como foi: {recompra.experiencia}</p> : null}
      <div className={s.acoes}>
        <BotaoAcao
          dado={`item:${item.id}:repetir_ok`}
          rotulo={`Repetir com ${recompra.fornecedorNome}`}
          kind="primary"
          confirmar={{
            titulo: "Repetir a compra?",
            texto: `${quantidade(item.quantidade, item.unidade)} de ${item.descricao} com ${recompra.fornecedorNome}${recompra.simulado ? " (simulado)" : ""}, a ${brl(recompra.precoUnitario)} por ${item.unidade}. O pedido vai para o fornecedor, que confirma se mantém o preço.`,
            botao: "Sim, repetir",
          }}
        />
        <BotaoAcao dado={`item:${item.id}:cotar_novo`} rotulo="Cotar de novo" kind="tertiary" />
      </div>
    </Bloco>
  );
}
