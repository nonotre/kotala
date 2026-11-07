"use client";
// Botão que age como o comprador. Com "confirmar", abre um Modal antes:
// a aprovação de compra sempre leva dois toques.
import { Button, InlineNotification, Modal, RadioButton, RadioButtonGroup } from "@carbon/react";
import { useState, useTransition } from "react";
import { tocarBotao } from "@/lib/acoes";

type Props = {
  dado: string;
  rotulo: string;
  kind?: "primary" | "secondary" | "tertiary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  confirmar?: { titulo: string; texto: string; botao: string; opcoes?: { rotulo: string; dado: string }[] };
};

export function BotaoAcao({ dado, rotulo, kind = "secondary", size = "md", confirmar }: Props) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  // Com opções (ex.: motivo do cancelamento), o botão manda o dado da opção escolhida.
  const [escolha, setEscolha] = useState(confirmar?.opcoes?.[0]?.dado ?? dado);

  const executar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await tocarBotao(confirmar?.opcoes ? escolha : dado);
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
          {confirmar.opcoes ? (
            <RadioButtonGroup legendText="Motivo" name={`opcoes-${dado}`} orientation="vertical" valueSelected={escolha} onChange={(v) => setEscolha(String(v))}>
              {confirmar.opcoes.map((o) => (
                <RadioButton key={o.dado} id={`${dado}-${o.dado}`} labelText={o.rotulo} value={o.dado} />
              ))}
            </RadioButtonGroup>
          ) : null}
        </Modal>
      ) : null}
      {erro ? <InlineNotification kind="error" lowContrast title="Não deu certo." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
    </>
  );
}
