"use client";
// Botão que age como o comprador. Com "confirmar", abre um Modal antes:
// a aprovação de compra sempre leva dois toques.
import { Button, InlineNotification, Modal } from "@carbon/react";
import { useState, useTransition } from "react";
import { tocarBotao } from "@/lib/acoes";

type Props = {
  dado: string;
  rotulo: string;
  kind?: "primary" | "secondary" | "tertiary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  confirmar?: { titulo: string; texto: string; botao: string };
};

export function BotaoAcao({ dado, rotulo, kind = "secondary", size = "md", confirmar }: Props) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const executar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await tocarBotao(dado);
      if (!r.ok) setErro(r.erro ?? "Não deu certo.");
      setAberto(false);
    });

  return (
    <>
      <Button kind={kind} size={size} disabled={pendente} onClick={() => (confirmar ? setAberto(true) : executar())}>
        {pendente ? "Enviando…" : rotulo}
      </Button>
      {confirmar ? (
        <Modal
          open={aberto}
          modalHeading={confirmar.titulo}
          primaryButtonText={pendente ? "Enviando…" : confirmar.botao}
          secondaryButtonText="Voltar"
          primaryButtonDisabled={pendente}
          onRequestClose={() => setAberto(false)}
          onRequestSubmit={executar}
        >
          <p>{confirmar.texto}</p>
        </Modal>
      ) : null}
      {erro ? <InlineNotification kind="error" lowContrast title="Não deu certo." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
    </>
  );
}
