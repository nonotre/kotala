"use client";
// E3: chat web com o mesmo assistente do Telegram. A conversa fica no banco;
// a tela consulta a cada 1,5 s e manda pela API interna do processo dos bots.
import { Button, InlineNotification, TextArea } from "@carbon/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { enviarChat } from "@/lib/acoes";
import estilos from "./chat.module.scss";

type Msg = { id: string; direcao: "entrada" | "saida"; texto: string; botoes: { rotulo: string; dado: string }[] | null; criadoEm: string };

function enderecoDoNavegador(): string {
  try {
    const salvo = localStorage.getItem("kotala-chat");
    if (salvo) return salvo;
    const novo = crypto.randomUUID();
    localStorage.setItem("kotala-chat", novo);
    return novo;
  } catch {
    return crypto.randomUUID();
  }
}

export function Chat() {
  const [endereco, setEndereco] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEndereco(enderecoDoNavegador());
  }, []);
  useEffect(() => {
    if (!endereco) return;
    let vivo = true;
    const buscar = async () => {
      try {
        const r = await fetch(`/api/chat?endereco=${endereco}`, { cache: "no-store" });
        if (vivo && r.ok) setMsgs(await r.json());
      } catch {
        // tenta de novo no próximo ciclo
      }
    };
    buscar();
    const t = setInterval(buscar, 1500);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [endereco]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  const mandar = (t: string, botao?: string) =>
    iniciar(async () => {
      if (!endereco) return;
      setErro(null);
      const r = await enviarChat(endereco, t, botao);
      if (!r.ok) setErro(r.erro ?? "Não deu certo.");
      else if (!botao) setTexto("");
    });

  const ultimaComBotoes = [...msgs].reverse().find((m) => m.direcao === "saida" && m.botoes?.length)?.id;

  return (
    <div className={estilos.chat}>
      <div className={estilos.mensagens} aria-live="polite">
        {msgs.length === 0 ? <p className={estilos.vazio}>Comece com algo como “preciso de 40 sacos de cimento cp2 até quinta”.</p> : null}
        {msgs.map((m) => (
          <div key={m.id} className={m.direcao === "entrada" ? estilos.eu : estilos.assistente}>
            <div className={estilos.balao}>{m.texto || (m.direcao === "entrada" ? "(toquei num botão)" : "")}</div>
            {m.botoes?.length && m.id === ultimaComBotoes ? (
              <div className={estilos.botoes}>
                {m.botoes.map((b) => (
                  <Button key={b.dado} size="sm" kind="tertiary" disabled={pendente} onClick={() => mandar("", b.dado)}>
                    {b.rotulo}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={fim} />
      </div>
      {erro ? <InlineNotification kind="error" lowContrast title="Não enviou." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
      <form
        className={estilos.envio}
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) mandar(texto.trim());
        }}
      >
        <TextArea
          id="mensagem"
          labelText="Sua mensagem"
          hideLabel
          rows={2}
          value={texto}
          placeholder="Escreva aqui"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (texto.trim()) mandar(texto.trim());
            }
          }}
        />
        <Button type="submit" disabled={pendente || !texto.trim()}>
          {pendente ? "Enviando…" : "Enviar"}
        </Button>
      </form>
    </div>
  );
}
