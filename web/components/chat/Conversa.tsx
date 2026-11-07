"use client";
// Conversar: o mesmo assistente do Telegram, no chat da Carbon. Esta tela não responde nada sozinha:
// o que o comprador escreve (ou toca) vai para enviarChat(), que passa pela API interna do processo dos bots,
// e tudo o que aparece na conversa vem do banco, por /api/chat, consultado a cada 1,5 s.

import {
  BusEventType,
  ChatCustomElement,
  MessageResponseTypes,
  type ChatInstance,
  type CustomSendMessageOptions,
  type GenericItem,
  type HistoryItem,
  type MessageRequest,
  type PublicConfig,
  type RenderCustomRequestFooter,
  type RenderUserDefinedResponse,
} from "@carbon/ai-chat";
import { Button, SkeletonText } from "@carbon/react";
import { ArrowDown } from "@carbon/react/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pagina } from "@/components/Pagina";
import { enviarChat } from "@/lib/acoes";
import { AVATAR_ASSISTENTE } from "./avatar";
import {
  comecarEnvio,
  definirUltimaComBotoes,
  falhaDoEnvio,
  guardarRotuloDoToque,
  marcarFalha,
  rotuloDoToque,
  terminarEnvio,
  zerarEstado,
  type Botao,
  type MensagemChat,
} from "./estado";
import { BotoesDoAssistente, ContextoConversa, RodapeEnvio, type AcoesConversa } from "./Pecas";
import { textosPtBr } from "./textos-pt-br";
import s from "./conversa.module.scss";

/** Intervalo da consulta ao banco. */
const INTERVALO_MS = 1500;
/** Os botões só têm a altura final depois de montar. */
const ROLAGEM_MS = 150;
/** Até esta distância do fim, cerca de duas linhas, quem lê ainda está no fim. */
const LIMITE_DO_FIM_PX = 40;
const ROLAGEM_DO_CHAT = ".cds-aichat--messages__wrapper";
/** O banco guarda o toque num botão sem texto. Sem o rótulo guardado neste navegador, a conversa mostra isto. */
const TOQUE_SEM_ROTULO = "(toquei num botão)";
const ERRO_PADRAO = "Não deu certo.";

/** Para começar: tocar manda a frase ao assistente de verdade. */
const EXEMPLOS = ["preciso de 40 sacos de cimento cp2 até quinta", "20 barras de ferro 3/8", "1 carrada de areia e 2 milheiros de tijolo"];

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

async function lerConversa(endereco: string): Promise<MensagemChat[] | null> {
  try {
    const r = await fetch(`/api/chat?endereco=${endereco}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as MensagemChat[]) : null;
  } catch {
    return null; // tenta de novo no próximo ciclo
  }
}

/** O chat lê o texto como Markdown: a quebra de linha simples do assistente vira quebra de verdade. */
function textoDoAssistente(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").replace(/\n/g, "  \n");
}

function itensDaResposta(m: MensagemChat): GenericItem[] {
  const itens: GenericItem[] = [];
  if (m.texto) itens.push({ response_type: MessageResponseTypes.TEXT, text: textoDoAssistente(m.texto) });
  if (m.botoes?.length) {
    itens.push({ response_type: MessageResponseTypes.USER_DEFINED, user_defined: { user_defined_type: "botoes", mensagemId: m.id, botoes: m.botoes } });
  }
  return itens;
}

function textoDoComprador(m: MensagemChat): string {
  return m.texto || rotuloDoToque(m.id) || TOQUE_SEM_ROTULO;
}

function paraHistorico(m: MensagemChat): HistoryItem | null {
  const timestamp = Date.parse(m.criadoEm) || Date.now();
  const time = new Date(timestamp).toISOString();
  if (m.direcao === "entrada") {
    // Sem esta marca, o chat salta até a última fala antiga do comprador quando chega a primeira mensagem nova.
    return { time, message: { id: m.id, input: { text: textoDoComprador(m) }, history: { timestamp, is_welcome_request: true } } };
  }
  const generic = itensDaResposta(m);
  return generic.length ? { time, message: { id: m.id, output: { generic }, history: { timestamp } } } : null;
}

/** A última mensagem do assistente com botões: só ela mostra os botões. */
function ultimaComBotoes(msgs: MensagemChat[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.direcao === "saida" && m.botoes?.length) return m.id;
  }
  return null;
}

/** Envio feito por esta tela, esperando a própria mensagem aparecer no banco. */
type Pendente = {
  /** O texto que o banco vai guardar: o digitado, ou vazio para um botão. */
  chave: string;
  envioId: string;
  rotulo?: string;
  /** A mensagem já apareceu no banco. */
  chegou: boolean;
};

/** Envios que o chat recebe mas que não são do comprador digitando. */
type Especial = { tipo: "eco" } | { tipo: "botao"; botao: Botao };

const renderBotoes: RenderUserDefinedResponse = (estado) => {
  const u = estado.messageItem?.user_defined;
  if (u?.user_defined_type !== "botoes") return undefined;
  return <BotoesDoAssistente mensagemId={String(u.mensagemId)} botoes={u.botoes as Botao[]} />;
};

const renderRodape: RenderCustomRequestFooter = (_slot, mensagem) => (mensagem.id ? <RodapeEnvio id={mensagem.id} /> : null);

const escritos = {
  homeScreenBeforeInputElement: <p className={s.dicaInicio}>O mesmo assistente do Telegram, aqui no navegador. Escreva o que precisa comprar, do seu jeito.</p>,
};

export function Conversa() {
  const [endereco, setEndereco] = useState<string | null>(null);
  const [historicoPronto, setHistoricoPronto] = useState(false);
  const [chatPronto, setChatPronto] = useState(false);
  const [novas, setNovas] = useState(false);

  const enderecoAgora = useRef<string | null>(null);
  enderecoAgora.current = endereco;
  const instancia = useRef<ChatInstance | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  /** Mensagens do banco que já estão na conversa. */
  const vistas = useRef(new Set<string>());
  const pendentes = useRef<Pendente[]>([]);
  const especiais = useRef(new Map<string, Especial>());
  const noFim = useRef(true);

  useEffect(() => {
    setEndereco(enderecoDoNavegador());
    return () => zerarEstado();
  }, []);

  // ---------- Rolagem ----------
  // Quem está lendo mais acima não é puxado para baixo; aparece "Novas mensagens".

  useEffect(() => {
    if (!chatPronto) return;
    const raiz = document.querySelector("cds-aichat-container")?.shadowRoot;
    if (!raiz) return;
    let topo = 0;
    const aoRolar = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches(ROLAGEM_DO_CHAT)) return;
      const subiu = el.scrollTop < topo;
      topo = el.scrollTop;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < LIMITE_DO_FIM_PX) {
        noFim.current = true;
        setNovas(false);
      } else if (subiu) noFim.current = false;
    };
    raiz.addEventListener("scroll", aoRolar, true);
    return () => raiz.removeEventListener("scroll", aoRolar, true);
  }, [chatPronto]);

  // Duas passadas: a segunda pega os botões que montaram depois da primeira.
  const rolar = useCallback((sempre = false) => {
    for (const ms of [ROLAGEM_MS, ROLAGEM_MS * 3]) {
      setTimeout(() => {
        if (sempre || noFim.current) instancia.current?.doAutoScroll?.({ scrollToBottom: 0 });
      }, ms);
    }
  }, []);

  const irAoFim = useCallback(() => {
    noFim.current = true;
    setNovas(false);
    instancia.current?.doAutoScroll?.({ scrollToBottom: 0 });
  }, []);

  // ---------- Enviar ----------

  /** Manda ao assistente. O chat mostra o "pensando" até a API interna responder. */
  const despachar = useCallback(async (envioId: string, texto: string, botao?: Botao) => {
    const end = enderecoAgora.current;
    if (!end) return;
    const pendente: Pendente = { chave: botao ? "" : texto, envioId, rotulo: botao?.rotulo, chegou: false };
    pendentes.current.push(pendente);
    marcarFalha(envioId, null);
    comecarEnvio();
    instancia.current?.updateIsMessageLoadingCounter("increase");
    try {
      const r = await enviarChat(end, botao ? "" : texto, botao?.dado);
      if (!r.ok) {
        // Se a mensagem já chegou ao banco, mandar de novo duplicaria: fica só o aviso.
        pendentes.current = pendentes.current.filter((p) => p !== pendente);
        marcarFalha(envioId, { erro: r.erro ?? ERRO_PADRAO, texto, botao: botao?.dado, podeTentar: !pendente.chegou });
      }
    } catch {
      pendentes.current = pendentes.current.filter((p) => p !== pendente);
      marcarFalha(envioId, { erro: "O assistente não respondeu. Ele está ligado?", texto, botao: botao?.dado, podeTentar: !pendente.chegou });
    } finally {
      instancia.current?.updateIsMessageLoadingCounter("decrease");
      terminarEnvio();
    }
  }, []);

  /** Tudo o que o chat envia passa por aqui: o digitado, os exemplos, os botões e os ecos do banco. */
  const aoEnviar = useCallback(
    async (req: MessageRequest, _opcoes: CustomSendMessageOptions) => {
      const id = req.id ?? crypto.randomUUID();
      const especial = req.id ? especiais.current.get(req.id) : undefined;
      if (especial) especiais.current.delete(id);
      if (especial?.tipo === "eco") return;
      noFim.current = true;
      setNovas(false);
      if (especial?.tipo === "botao") {
        await despachar(id, especial.botao.rotulo, especial.botao);
        return;
      }
      const texto = String(req.input.text ?? "").trim().slice(0, 4000);
      if (texto) await despachar(id, texto);
    },
    [despachar],
  );

  // ---------- Mostrar o que veio do banco ----------

  const enfileirar = useCallback((tarefa: () => Promise<void>) => {
    fila.current = fila.current.then(tarefa, tarefa);
  }, []);

  const receber = useCallback(
    (msgs: MensagemChat[]) => {
      definirUltimaComBotoes(ultimaComBotoes(msgs));
      for (const m of msgs) {
        if (vistas.current.has(m.id)) continue;
        vistas.current.add(m.id);
        if (m.direcao === "entrada") {
          // A própria mensagem desta tela: o chat já a mostra desde o envio.
          const p = pendentes.current.find((x) => !x.chegou && x.chave === (m.texto ?? ""));
          if (p) {
            p.chegou = true;
            pendentes.current = pendentes.current.filter((x) => x !== p);
            if (p.rotulo) guardarRotuloDoToque(m.id, p.rotulo);
            continue;
          }
          // Escrita em outra guia, com o mesmo endereço: entra na conversa sem ir de novo ao assistente.
          enfileirar(async () => {
            especiais.current.set(m.id, { tipo: "eco" });
            await instancia.current?.send({ id: m.id, input: { text: textoDoComprador(m) } });
            rolar();
          });
          continue;
        }
        const generic = itensDaResposta(m);
        if (!generic.length) continue;
        enfileirar(async () => {
          await instancia.current?.messaging.addMessage({ id: m.id, output: { generic } });
          rolar();
          if (!noFim.current) setNovas(true);
        });
      }
    },
    [enfileirar, rolar],
  );

  const carregarHistorico = useCallback(async (): Promise<HistoryItem[]> => {
    const end = enderecoAgora.current;
    const msgs = end ? await lerConversa(end) : null;
    const itens: HistoryItem[] = [];
    if (msgs) {
      definirUltimaComBotoes(ultimaComBotoes(msgs));
      for (const m of msgs) {
        vistas.current.add(m.id);
        const h = paraHistorico(m);
        if (h) itens.push(h);
      }
    }
    setHistoricoPronto(true);
    return itens;
  }, []);

  // A consulta ao banco começa depois do histórico: o que já estava lá não entra duas vezes.
  useEffect(() => {
    if (!endereco || !historicoPronto) return;
    let vivo = true;
    const buscar = async () => {
      const msgs = await lerConversa(endereco);
      if (vivo && msgs) receber(msgs);
    };
    void buscar();
    const t = setInterval(buscar, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [endereco, historicoPronto, receber]);

  // ---------- Ações dos botões e do rodapé ----------

  const acoes = useMemo<AcoesConversa>(
    () => ({
      tocar: (botao) => {
        const inst = instancia.current;
        if (!inst) return;
        // O rótulo entra na conversa como fala do comprador; ao assistente vai o dado do botão.
        const id = crypto.randomUUID();
        especiais.current.set(id, { tipo: "botao", botao });
        void inst.send({ id, input: { text: botao.rotulo } });
      },
      tentarDeNovo: (envioId) => {
        const falha = falhaDoEnvio(envioId);
        if (!falha?.podeTentar) return;
        void despachar(envioId, falha.texto, falha.botao ? { rotulo: falha.texto, dado: falha.botao } : undefined);
      },
    }),
    [despachar],
  );

  // ---------- O chat ----------

  const config = useMemo<PublicConfig>(
    () => ({
      assistantName: "Assistente",
      assistantAvatarUrl: AVATAR_ASSISTENTE,
      locale: "pt-br",
      strings: textosPtBr,
      openChatByDefault: true,
      // O texto vem de um modelo de linguagem: HTML nele não é desenhado.
      shouldSanitizeHTML: true,
      layout: { showFrame: false },
      header: { isOn: false },
      homescreen: {
        isOn: true,
        disableReturn: true,
        greeting: "Diga o que precisa comprar.",
        starters: { isOn: true, buttons: EXEMPLOS.map((label) => ({ label })) },
      },
      messaging: {
        skipWelcome: true,
        messageLoadingIndicatorTimeoutSecs: 0,
        customSendMessage: aoEnviar,
        customLoadHistory: carregarHistorico,
      },
    }),
    [aoEnviar, carregarHistorico],
  );

  const aoCriar = useCallback(
    (inst: ChatInstance) => {
      instancia.current = inst;
      fila.current = Promise.resolve();
      inst.on({ type: BusEventType.CHAT_READY, handler: () => setChatPronto(true) });
      inst.on({ type: BusEventType.HISTORY_END, handler: () => rolar(true) });
    },
    [rolar],
  );

  // O campo do pacote traz `aria-multiline` numa `div` sem papel, e o axe reprova. Quem é lido é o campo de dentro.
  useEffect(() => {
    if (!chatPronto) return;
    const raiz = document.querySelector("cds-aichat-container")?.shadowRoot;
    const limpar = () => raiz?.querySelectorAll("[data-aichat-editor-host][aria-multiline]").forEach((h) => h.removeAttribute("aria-multiline"));
    const vigia = new MutationObserver(limpar);
    if (raiz) vigia.observe(raiz, { childList: true, subtree: true });
    limpar();
    return () => vigia.disconnect();
  }, [chatPronto]);

  return (
    <Pagina>
      <div className={s.tela}>
        <h1 className={s.tituloOculto}>Conversar com o assistente</h1>
        <ContextoConversa.Provider value={acoes}>
          <div className={s.chatArea}>
            {endereco ? (
              <ChatCustomElement
                className={s.chat}
                {...config}
                onBeforeRender={aoCriar}
                renderUserDefinedResponse={renderBotoes}
                renderCustomRequestFooter={renderRodape}
                renderWriteableElements={escritos}
              />
            ) : null}
            {novas ? (
              <div className={s.novas}>
                <Button kind="secondary" size="sm" renderIcon={ArrowDown} onClick={irAoFim}>
                  Novas mensagens
                </Button>
              </div>
            ) : null}
            {!chatPronto ? (
              <div className={s.chatCarregando} aria-hidden="true">
                <SkeletonText paragraph lineCount={3} />
              </div>
            ) : null}
          </div>
        </ContextoConversa.Provider>
      </div>
    </Pagina>
  );
}
