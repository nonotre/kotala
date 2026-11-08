"use client";
// X5: ligação por voz no navegador com o Gemini Live. A chave é temporária
// (gerada no servidor); a ferramenta registrar_cotacao roda no servidor.
// Microfone em PCM 16 kHz; a voz do agente chega em PCM 24 kHz.
// Full duplex: com fone, o microfone segue aberto enquanto o agente fala e o fornecedor
// pode interromper (o Live manda `interrupted` e a fala do agente para na hora). Silêncio
// longo, tempo máximo e queda de conexão encerram a ligação e a transcrição vai para o rastro.
import { Button, Checkbox, InlineNotification, Tag, Tile } from "@carbon/react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { useEffect, useRef, useState } from "react";
import {
  acaoDaSessao,
  acrescentarFala,
  AVISO_ATENDIDA,
  AVISO_SILENCIO,
  AVISO_TEMPO,
  respostaDaFerramenta,
  TEXTO_FIM,
  type MotivoFim,
} from "../../src/agentes/voz/sessao.ts";
import estilos from "./ligacao.module.scss";

type Fala = { quem: "agente" | "fornecedor" | "sistema"; texto: string };

const WORKLET = `
class Captura extends AudioWorkletProcessor {
  constructor() { super(); this.razao = sampleRate / 16000; this.acc = []; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0][0]; if (!ch) return true;
    for (this.pos; this.pos < ch.length; this.pos += this.razao) {
      const a = Math.floor(this.pos), b = Math.min(ch.length, Math.floor(this.pos + this.razao));
      let m = 0; for (let k = a; k < b; k++) m += ch[k]; this.acc.push(m / Math.max(1, b - a));
    }
    this.pos -= ch.length;
    if (this.acc.length >= 1600) {
      const pcm = new Int16Array(this.acc.length);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, this.acc[i])) * 32767;
      this.port.postMessage(pcm.buffer, [pcm.buffer]); this.acc = [];
    }
    return true;
  }
}
registerProcessor("captura", Captura);`;

function base64(buf: ArrayBuffer) {
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

type Relogio = { inicio: number; ultimaAtividade: number; avisouSilencio: boolean; avisouTempo: boolean; timer?: ReturnType<typeof setInterval> };

export function Ligacao({ cotacaoId, modelo, instrucoes, ferramenta }: { cotacaoId: string; modelo: string; instrucoes: string; ferramenta: object }) {
  const [estado, setEstado] = useState<"parada" | "conectando" | "ligada" | "encerrada">("parada");
  const [falas, setFalas] = useState<Fala[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [registro, setRegistro] = useState<{ ok: boolean; resposta: string } | null>(null);
  // Sem fone, o microfone fica mudo enquanto o agente fala (senão ele ouve a própria voz e se interrompe).
  const [comFone, setComFone] = useState(true);
  const comFoneRef = useRef(true);
  const sessao = useRef<Session | null>(null);
  const audio = useRef<{ mic?: MediaStream; micCtx?: AudioContext; playCtx?: AudioContext; fila: AudioBufferSourceNode[]; cabeca: number }>({ fila: [], cabeca: 0 });
  const transcricao = useRef("");
  const relogio = useRef<Relogio>({ inicio: 0, ultimaAtividade: 0, avisouSilencio: false, avisouTempo: false });
  /** A ligação em curso já terminou (o fim vai uma vez só ao servidor). */
  const terminada = useRef(true);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [falas.length]);
  useEffect(() => () => finalizar("saiu"), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    comFoneRef.current = comFone;
  }, [comFone]);

  const acrescentar = (quem: Fala["quem"], texto: string) =>
    setFalas((f) => {
      const ultima = f[f.length - 1];
      if (ultima && ultima.quem === quem && quem !== "sistema") return [...f.slice(0, -1), { quem, texto: ultima.texto + texto }];
      return [...f, { quem, texto }];
    });

  const atividade = () => {
    relogio.current.ultimaAtividade = Date.now();
  };

  function tocar(b64: string) {
    const a = audio.current;
    if (!a.playCtx) return;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    const buf = a.playCtx.createBuffer(1, pcm.length, 24000);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i]! / 32768;
    const fonte = a.playCtx.createBufferSource();
    fonte.buffer = buf;
    fonte.connect(a.playCtx.destination);
    a.cabeca = Math.max(a.cabeca, a.playCtx.currentTime);
    fonte.start(a.cabeca);
    a.cabeca += buf.duration;
    a.fila.push(fonte);
    fonte.onended = () => {
      a.fila = a.fila.filter((x) => x !== fonte);
      atividade(); // o silêncio conta a partir do fim da fala do agente
    };
  }

  function silenciar() {
    const a = audio.current;
    a.fila.forEach((f) => {
      try {
        f.stop();
      } catch {
        // já parou
      }
    });
    a.fila = [];
    a.cabeca = 0;
  }

  function avisarAgente(texto: string) {
    sessao.current?.sendClientContent({ turns: [{ role: "user", parts: [{ text: texto }] }], turnComplete: true });
  }

  async function registrar(fc: { id?: string; name?: string; args?: unknown }) {
    acrescentar("sistema", "Registrando a proposta…");
    let r: { ok: boolean; resposta: string };
    try {
      const resp = await fetch("/api/voz/cotacao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cotacaoId, args: fc.args ?? {}, transcricao: transcricao.current }),
      });
      r = respostaDaFerramenta(resp.ok ? await resp.json() : null);
    } catch {
      r = respostaDaFerramenta(null);
    }
    if (r.ok) setRegistro(r);
    acrescentar("sistema", r.ok ? "Proposta registrada no mapa de cotação." : r.resposta);
    atividade();
    // A ferramenta sempre responde, mesmo com falha: o agente não fica esperando.
    sessao.current?.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: r }] });
  }

  async function aoMensagem(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc?.interrupted) {
      silenciar();
      atividade();
    }
    for (const p of sc?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) {
        tocar(p.inlineData.data);
        atividade();
      }
    }
    if (sc?.inputTranscription?.text) {
      transcricao.current = acrescentarFala(transcricao.current, "fornecedor", sc.inputTranscription.text);
      acrescentar("fornecedor", sc.inputTranscription.text);
      atividade();
      relogio.current.avisouSilencio = false;
    }
    if (sc?.outputTranscription?.text) {
      transcricao.current = acrescentarFala(transcricao.current, "agente", sc.outputTranscription.text);
      acrescentar("agente", sc.outputTranscription.text);
      atividade();
    }
    if (msg.goAway) acrescentar("sistema", "O servidor de voz vai encerrar a conexão em instantes.");
    for (const fc of msg.toolCall?.functionCalls ?? []) await registrar(fc);
  }

  /** Relógio da ligação: silêncio longo e tempo máximo (regras em src/agentes/voz/sessao.ts). */
  function conferirRelogio() {
    const r = relogio.current;
    const acao = acaoDaSessao({
      agora: Date.now(),
      inicio: r.inicio,
      ultimaAtividade: r.ultimaAtividade,
      agenteFalando: audio.current.fila.length > 0,
      avisouSilencio: r.avisouSilencio,
      avisouTempo: r.avisouTempo,
    });
    if (acao === "avisar_silencio") {
      r.avisouSilencio = true;
      acrescentar("sistema", "Silêncio na linha: o assistente vai perguntar se o fornecedor ainda está aí.");
      avisarAgente(AVISO_SILENCIO);
    } else if (acao === "avisar_tempo") {
      r.avisouTempo = true;
      acrescentar("sistema", "Falta um minuto para o tempo máximo da ligação.");
      avisarAgente(AVISO_TEMPO);
    } else if (acao === "encerrar_silencio") finalizar("silencio");
    else if (acao === "encerrar_tempo") finalizar("tempo");
  }

  async function ligar() {
    setErro(null);
    setRegistro(null);
    setFalas([]);
    transcricao.current = "";
    terminada.current = false;
    setEstado("conectando");
    try {
      const { token, apiVersion, erro: e } = (await (await fetch("/api/voz/token", { method: "POST" })).json()) as { token?: string; apiVersion?: string; erro?: string };
      if (!token) throw new Error(e ?? "Sem chave temporária");
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion } });
      const a = audio.current;
      a.playCtx = new AudioContext({ sampleRate: 24000 });
      const s = await ai.live.connect({
        model: modelo,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { languageCode: "pt-BR" },
          systemInstruction: instrucoes,
          tools: [{ functionDeclarations: [ferramenta as never] }],
        },
        callbacks: {
          onopen: () => setEstado("ligada"),
          // Fechou sem ninguém encerrar: a conexão caiu no meio.
          onclose: () => finalizar("queda"),
          onerror: (ev) => setErro(String((ev as ErrorEvent).message ?? "erro na ligação")),
          onmessage: (m) => void aoMensagem(m),
        },
      });
      sessao.current = s;
      a.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      a.micCtx = new AudioContext();
      await a.micCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
      const no = new AudioWorkletNode(a.micCtx, "captura");
      a.micCtx.createMediaStreamSource(a.mic).connect(no);
      no.port.onmessage = ({ data }) => {
        if (!comFoneRef.current && audio.current.fila.length) return; // sem fone: ignora o eco da voz do agente
        sessao.current?.sendRealtimeInput({ audio: { data: base64(data as ArrayBuffer), mimeType: "audio/pcm;rate=16000" } });
      };
      const agora = Date.now();
      relogio.current = { inicio: agora, ultimaAtividade: agora, avisouSilencio: false, avisouTempo: false, timer: setInterval(conferirRelogio, 1000) };
      // O agente abre a conversa.
      avisarAgente(AVISO_ATENDIDA);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      finalizar("erro");
    }
  }

  /** Encerra a ligação uma vez só, por qualquer motivo, e manda a transcrição para o rastro. */
  function finalizar(motivo: MotivoFim) {
    if (terminada.current) return;
    terminada.current = true;
    const r = relogio.current;
    if (r.timer) clearInterval(r.timer);
    r.timer = undefined;
    const s = sessao.current;
    sessao.current = null;
    s?.close();
    silenciar();
    const a = audio.current;
    a.mic?.getTracks().forEach((t) => t.stop());
    void a.micCtx?.close();
    void a.playCtx?.close();
    a.mic = undefined;
    a.micCtx = undefined;
    a.playCtx = undefined;
    // keepalive: o fim chega ao servidor mesmo saindo da página.
    void fetch("/api/voz/fim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ cotacaoId, motivo, transcricao: transcricao.current, duracaoSeg: r.inicio ? (Date.now() - r.inicio) / 1000 : null }),
    }).catch(() => undefined);
    if (motivo === "saiu") return;
    acrescentar("sistema", TEXTO_FIM[motivo]);
    setEstado("encerrada");
  }

  return (
    <Tile className={estilos.ligacao}>
      <div className={estilos.topo}>
        {estado === "ligada" || estado === "conectando" ? (
          <Button kind="danger" onClick={() => finalizar("desligou")}>
            Encerrar ligação
          </Button>
        ) : (
          <Button kind="primary" onClick={() => void ligar()}>
            {estado === "encerrada" ? "Ligar de novo" : "Ligar"}
          </Button>
        )}
        <Tag type={estado === "ligada" ? "green" : "gray"} size="md">
          {{ parada: "Pronta para ligar", conectando: "Conectando…", ligada: "Em ligação: pode falar", encerrada: "Ligação encerrada" }[estado]}
        </Tag>
        {registro?.ok ? <Tag type="purple">Proposta registrada</Tag> : null}
        <Checkbox
          id={`fone-${cotacaoId}`}
          labelText="Estou de fone (pode interromper o assistente)"
          checked={comFone}
          onChange={(_, { checked }) => setComFone(checked)}
        />
      </div>
      {erro ? <InlineNotification kind="error" lowContrast title="A ligação falhou." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
      <div className={estilos.conversa} aria-live="polite">
        {falas.length === 0 ? <p className={estilos.vazio}>A conversa aparece aqui, escrita, enquanto acontece.</p> : null}
        {falas.map((f, i) => (
          <p key={i} className={estilos[f.quem]}>
            <strong>{f.quem === "agente" ? "Assistente" : f.quem === "fornecedor" ? "Fornecedor" : "Sistema"}:</strong> {f.texto}
          </p>
        ))}
        <div ref={fim} />
      </div>
    </Tile>
  );
}
