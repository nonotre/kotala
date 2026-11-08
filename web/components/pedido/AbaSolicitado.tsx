// Etapa Solicitado: a confirmação do pedido. Enquanto espera, os itens que o assistente
// separou, o que ele assumiu e os botões Confirmar e Cancelar. Depois, só a leitura de
// quando você confirmou ou cancelou: a etapa não muda mais.

import { Column } from "@carbon/react";
import Link from "next/link";
import { Bloco } from "@/components/Bloco";
import { BotaoAcao } from "@/components/BotaoAcao";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import type { DadosPedido } from "@/lib/dados-pedido";
import { dataHora } from "@/lib/formato";
import { textoEntrega, textoPrazo, Urgencia } from "./CabecalhoPedido";
import { TabelaItens } from "./DetalhesPedido";
import { Campos, ListaTextos } from "./Item";
import { Status, StatusPedido } from "./Status";
import { CANAL, hrefAba, MOTIVOS_CANCELAMENTO } from "./textos";
import s from "./pedido.module.scss";

const recebido = (p: DadosPedido["pedido"]) => `${CANAL[p.canalOrigem] ?? p.canalOrigem}, em ${dataHora(p.criadoEm)}`;

function Confirmar({ d }: { d: DadosPedido }) {
  const { pedido: p, itens } = d;
  return (
    <Bloco titulo="Entendi assim, confirma?" descricao={`Recebida por ${recebido(p)}. Nada é cotado antes de você confirmar.`} acao={<StatusPedido estado={p.estado} />}>
      <div className={s.grupo}>
        <div className={s.grupoTopo}>
          <h3 className={s.grupoTitulo}>O que o assistente entendeu</h3>
          <SeloIA titulo={`O assistente leu a sua mensagem e separou ${itens.length === 1 ? "1 item" : `${itens.length} itens`}.`} tamanho="mini">
            Quantidade, unidade e descrição saíram do seu texto. O que ele assumiu sem você dizer aparece em “O assistente considerou”.
          </SeloIA>
        </div>
        <TabelaItens d={d} rotulo="Itens a confirmar" />
      </div>
      <Campos
        linhas={[
          ["Entrega", textoEntrega(p)],
          ["Janela de recebimento", p.janelaRecebimento],
          ["Setor", p.setor],
          ["Prazo", textoPrazo(p) ?? "Não informado"],
          ["Urgência", p.urgencia !== "normal" ? <Urgencia key="u" urgencia={p.urgencia} /> : null],
        ]}
      />
      <ListaTextos titulo="O assistente considerou" itens={p.suposicoes} />
      <ListaTextos titulo="Faltou dizer" itens={p.faltando} />
      <ListaTextos titulo="Correções" itens={p.correcoes} />
      <div className={s.acoes}>
        <BotaoAcao dado={`pedido:${p.id}:confirmar`} rotulo="Confirmar cotação" kind="primary" />
        <BotaoAcao
          dado={`pedido:${p.id}:cancelar`}
          rotulo="Cancelar"
          kind="ghost"
          confirmar={{
            titulo: `Cancelar a cotação ${p.id}?`,
            texto: "Nada será cotado. Por que cancelar?",
            botao: "Cancelar cotação",
            opcoes: Object.entries(MOTIVOS_CANCELAMENTO).map(([k, rotulo]) => ({ rotulo, dado: `pedido:${p.id}:cancelar_${k}` })),
          }}
        />
      </div>
    </Bloco>
  );
}

/** Só leitura: a confirmação já aconteceu (ou o pedido foi cancelado antes dela). */
function Decidida({ d }: { d: DadosPedido }) {
  const { pedido: p, confirmadoEm, canceladoEm } = d;
  const cancelado = p.estado === "cancelado";
  // Sem a transição na linha do tempo (pedido antigo), o estado basta para saber que foi confirmado.
  const confirmou = !!confirmadoEm || !cancelado;
  return (
    <Bloco
      titulo={confirmou ? "Você confirmou a cotação" : "Você cancelou a cotação"}
      descricao={!confirmou ? "Nada foi cotado." : cancelado ? "A cotação foi cancelada depois da confirmação." : "Depois da confirmação, o assistente cota os itens um por vez."}
      acao={confirmou ? <Status tipo="succeeded" rotulo="Confirmada" /> : <StatusPedido estado={p.estado} />}
    >
      <Campos
        linhas={[
          ["Recebida por", recebido(p)],
          ["Confirmada em", confirmadoEm ? dataHora(confirmadoEm) : null],
          [confirmou ? "Cotação cancelada depois, em" : "Cancelada em", canceladoEm ? dataHora(canceladoEm) : null],
          ["Motivo do cancelamento", p.motivoCancelamento],
        ]}
      />
      <p className={s.ajuda}>
        Os itens, a entrega e o prazo estão em <Link href={hrefAba(p.id, "resumo")}>Detalhes da cotação</Link>. A sua mensagem e o que o assistente entendeu, no fim do{" "}
        <Link href={hrefAba(p.id, "historico")}>Histórico</Link>.
      </p>
    </Bloco>
  );
}

export function AbaSolicitado({ d }: { d: DadosPedido }) {
  const { estado } = d.pedido;
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        {estado === "interpretando" ? (
          <EstadoVazio titulo="O assistente ainda está lendo a cotação." proximoPasso="Quando terminar, você confere aqui o que ele entendeu e confirma." />
        ) : estado === "aguardando_confirmacao" ? (
          <Confirmar d={d} />
        ) : (
          <Decidida d={d} />
        )}
      </Column>
    </GradePagina>
  );
}
