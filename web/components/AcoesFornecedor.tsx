"use client";
// Homologar e bloquear um fornecedor (lista de bloqueio, com motivo obrigatório).
import { Button, InlineNotification, Modal, TextInput } from "@carbon/react";
import { useState, useTransition } from "react";
import { alterarFornecedor } from "@/lib/acoes";

/** `soBloqueio`: só bloquear e desbloquear, como na tela de alertas de conduta. */
export function AcoesFornecedor({ id, nome, homologado, bloqueado, soBloqueio = false }: { id: string; nome: string; homologado: boolean; bloqueado: boolean; soBloqueio?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const fazer = (acao: "bloquear" | "desbloquear" | "homologar" | "desomologar", m = "") =>
    iniciar(async () => {
      setErro(null);
      const r = await alterarFornecedor(id, acao, m);
      if (!r.ok) setErro(r.erro ?? "Não deu certo.");
      setAberto(false);
      setMotivo("");
    });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {!bloqueado && !soBloqueio ? (
        <Button size="sm" kind="ghost" disabled={pendente} onClick={() => fazer(homologado ? "desomologar" : "homologar")}>
          {homologado ? "Tirar homologação" : "Homologar"}
        </Button>
      ) : null}
      {bloqueado ? (
        <Button size="sm" kind="ghost" disabled={pendente} onClick={() => fazer("desbloquear")}>
          Desbloquear
        </Button>
      ) : (
        <Button size="sm" kind="danger--ghost" disabled={pendente} onClick={() => setAberto(true)}>
          Bloquear
        </Button>
      )}
      <Modal
        open={aberto}
        danger
        modalHeading={`Bloquear ${nome}?`}
        primaryButtonText={pendente ? "Enviando…" : "Bloquear"}
        secondaryButtonText="Voltar"
        primaryButtonDisabled={pendente || !motivo.trim()}
        onRequestClose={() => setAberto(false)}
        onRequestSubmit={() => fazer("bloquear", motivo)}
      >
        <p>Ele deixa de entrar nas buscas e na recompra. As solicitações de proposta em andamento continuam.</p>
        <TextInput id={`motivo-${id}`} labelText="Motivo" placeholder="Ex.: atrasou a entrega e não avisou" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Modal>
      {erro ? <InlineNotification kind="error" lowContrast title="Não deu certo." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
    </div>
  );
}
