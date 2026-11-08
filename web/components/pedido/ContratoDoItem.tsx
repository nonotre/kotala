// X2: o item tem contrato anual vigente. O comprador escolhe pedir direto ao fornecedor
// do contrato (o pedido de compra sai pelo preço do contrato) ou cotar mesmo assim.
// Fica na etapa Comparando, onde o item espera, como a compra repetida.

import { Bloco } from "@/components/Bloco";
import { BotaoAcao } from "@/components/BotaoAcao";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { ItemDoPedido } from "@/lib/dados-pedido";
import { brl, quantidade } from "@/lib/formato";
import s from "./pedido.module.scss";

const data = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function ContratoDoItem({ i }: { i: ItemDoPedido }) {
  const { item, contrato: c } = i;
  if (!c) return null;
  const total = c.precoUnitario * Number(item.quantidade);
  return (
    <Bloco titulo="Este item tem contrato" descricao="Com contrato vigente, o item vai direto ao fornecedor do contrato, sem cotação. A decisão é sua.">
      <p className={s.texto}>
        Contrato com <strong>{c.fornecedorNome}</strong> {c.simulado ? <SeloSimulado /> : null} até {data(c.fim)}, a {brl(c.precoUnitario)} por {item.unidade}: {quantidade(item.quantidade, item.unidade)} dão {brl(total)} de produto.
      </p>
      {c.observacao ? <p className={s.ajuda}>Condições do contrato: {c.observacao}</p> : null}
      {c.motivoIndisponivel ? <p className={s.ajuda}>Agora não dá para pedir pelo contrato: {c.motivoIndisponivel}. Cote mesmo assim.</p> : null}
      <div className={s.acoes}>
        {!c.motivoIndisponivel ? (
          <BotaoAcao
            dado={`item:${item.id}:contrato_ok:${c.id}`}
            rotulo={`Pedir direto a ${c.fornecedorNome}`}
            kind="primary"
            confirmar={{
              titulo: "Pedir direto pelo contrato?",
              texto: `${quantidade(item.quantidade, item.unidade)} de ${item.descricao} com ${c.fornecedorNome}${c.simulado ? " (simulado)" : ""}, a ${brl(c.precoUnitario)} por ${item.unidade} (${brl(total)} de produto), pelo contrato vigente até ${data(c.fim)}. O pedido de compra vai ao fornecedor do contrato, sem cotação.`,
              botao: "Sim, pedir direto",
            }}
          />
        ) : null}
        <BotaoAcao dado={`item:${item.id}:cotar_novo`} rotulo="Cotar mesmo assim" kind={c.motivoIndisponivel ? "primary" : "tertiary"} />
      </div>
    </Bloco>
  );
}
