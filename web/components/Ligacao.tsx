"use client";
// X5: ligação por voz no navegador com o Gemini Live. A chave é temporária
// (gerada no servidor); a ferramenta registrar_cotacao roda no servidor.
// Microfone em PCM 16 kHz; a voz do agente chega em PCM 24 kHz.
import { Button, InlineNotification, Tag, Tile } from "@carbon/react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { useEffect, useRef, useState } from "react";
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

export function Ligacao({ cotacaoId, modelo, instrucoes, ferramenta }: { cotacaoId: string; modelo: string; instrucoes: string; ferramenta: object }) {
  const [estado, setEstado] = useState<"parada" | "conectando" | "ligada" | "encerrada">("parada");
  const [falas, setFalas] = useState<Fala[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [registro, setRegistro] = useState<{ ok: boolean; resposta: string } | null>(null);
  const sessao = useRef<Session | null>(null);
  const audio = useRef<{ mic?: MediaStream; micCtx?: AudioContext; playCtx?: AudioContext; fila: AudioBufferSourceNode[]; cabeca: number }>({ fila: [], cabeca: 0 });
  const transcricao = useRef("");
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [falas.length]);
  useEffect(() => () => encerrar(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const acrescentar = (quem: Fala["quem"], texto: string) =>
    setFalas((f) => {
      const ultima = f[f.length - 1];
      if (ultima && ultima.quem === quem && quem !== "sistema") return [...f.slice(0, -1), { quem, texto: ultima.texto + texto }];
      return [...f, { quem, texto }];
    });

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
    fonte.onended = () => (a.fila = a.fila.filter((x) => x !== fonte));
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

  async function aoMensagem(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc?.interrupted) silenciar();
    for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) tocar(p.inlineData.data);
    if (sc?.inputTranscription?.text) {
      transcricao.current += `\n[fornecedor] ${sc.inputTranscription.text}`;
      acrescentar("fornecedor", sc.inputTranscription.text);
    }
    if (sc?.outputTranscription?.text) {
      transcricao.current += `\n[agente] ${sc.outputTranscription.text}`;
      acrescentar("agente", sc.outputTranscription.text);
    }
    if (msg.toolCall) {
      for (const fc of msg.toolCall.functionCalls ?? []) {
        acrescentar("sistema", "Registrando a proposta…");
        const r = (await (
          await fetch("/api/voz/cotacao", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cotacaoId, args: fc.args, transcricao: transcricao.current }) })
        ).json()) as { ok: boolean; resposta: string };
        setRegistro(r);
        acrescentar("sistema", r.ok ? "Proposta registrada no mapa de cotações." : r.resposta);
        sessao.current?.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: r }] });
      }
    }
  }

  async function ligar() {
    setErro(null);
    setRegistro(null);
    setFalas([]);
    transcricao.current = "";
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
          onclose: () => setEstado((x) => (x === "parada" ? x : "encerrada")),
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
        // Ignora o microfone enquanto o agente fala (eco).
        if (!audio.current.fila.length) sessao.current?.sendRealtimeInput({ audio: { data: base64(data as ArrayBuffer), mimeType: "audio/pcm;rate=16000" } });
      };
      // O agente abre a conversa.
      s.sendClientContent({ turns: [{ role: "user", parts: [{ text: "(a ligação foi atendida)" }] }], turnComplete: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      encerrar();
    }
  }

  function encerrar() {
    sessao.current?.close();
    sessao.current = null;
    silenciar();
    const a = audio.current;
    a.mic?.getTracks().forEach((t) => t.stop());
    void a.micCtx?.close();
    void a.playCtx?.close();
    a.mic = undefined;
    a.micCtx = undefined;
    a.playCtx = undefined;
    setEstado((x) => (x === "parada" ? x : "encerrada"));
  }

  return (
    <Tile className={estilos.ligacao}>
      <div className={estilos.topo}>
        {estado === "ligada" || estado === "conectando" ? (
          <Button kind="danger" onClick={encerrar}>
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
