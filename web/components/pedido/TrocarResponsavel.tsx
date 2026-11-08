"use client";
// Responsável pela cotação, com a troca. Mora nos Detalhes da cotação (Frente 1); `semRotulo` quando a linha já diz "Responsável".
// Fica dentro de um texto corrido:
// o gatilho é um link-botão e o modal vai para o body, para não aninhar blocos no parágrafo.

import { InlineNotification, Link as CarbonLink, Modal, Select, SelectItem } from "@carbon/react";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { listarPessoas, trocarResponsavel, type Pessoa } from "@/lib/equipe";

/** Valor do Select para "volta ao padrão" (quem fez o pedido). */
const PADRAO = "";

type Props = { pedidoId: number; responsavelId: string | null; dono: string | null };

export function TrocarResponsavel({ pedidoId, responsavelId, dono, semRotulo = false }: Props & { semRotulo?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [escolha, setEscolha] = useState(responsavelId ?? PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setEscolha(responsavelId ?? PADRAO);
    listarPessoas()
      .then((l) => vivo && setPessoas(l))
      .catch(() => vivo && setPessoas([]));
    return () => {
      vivo = false;
    };
  }, [aberto, responsavelId]);

  const salvar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await trocarResponsavel(pedidoId, escolha || null);
      if (!r.ok) setErro(r.erro ?? "Não deu certo.");
      else setAberto(false);
    });

  return (
    <>
      {semRotulo ? (dono ?? "Sem responsável") : dono ? `Responsável: ${dono}` : "Sem responsável"}{" "}
      <CarbonLink as="button" type="button" inline onClick={() => setAberto(true)}>
        Trocar
      </CarbonLink>
      {aberto
        ? createPortal(
            <Modal
              open
              size="sm"
              modalHeading={`Responsável pelo pedido ${pedidoId}`}
              primaryButtonText={pendente ? "Salvando…" : "Salvar"}
              secondaryButtonText="Voltar"
              primaryButtonDisabled={pendente || pessoas === null}
              onRequestClose={() => setAberto(false)}
              onRequestSubmit={salvar}
            >
              <p>O responsável aparece no Quadro, na Lista e aqui. A troca não muda quem recebe as mensagens do pedido.</p>
              <Select
                id={`responsavel-${pedidoId}`}
                labelText="Responsável"
                value={escolha}
                disabled={pessoas === null}
                onChange={(e) => setEscolha(e.target.value)}
              >
                <SelectItem value={PADRAO} text="Quem fez o pedido (padrão)" />
                {(pessoas ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} text={p.papel === "gestor" ? `${p.nome} (gestor)` : p.nome} />
                ))}
              </Select>
              {erro ? <InlineNotification kind="error" lowContrast title="Não deu certo." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
            </Modal>,
            document.body,
          )
        : null}
    </>
  );
}
