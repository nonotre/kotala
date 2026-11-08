"use client";
// Conversar: o assistente, no chat da Carbon. Esta tela não responde nada sozinha:
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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pagina } from "@/components/Pagina";
import { enviarChat, type AnexoChat } from "@/lib/acoes";
import { AVATAR_ASSISTENTE } from "./avatar";
import {
  comecarEnvio,
  definirUltimaComBotoes,
  ehLink,
  falhaDoEnvio,
  guardarRotuloDoToque,
  marcarFalha,
  rotaInterna,
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
/** Anexos: foto do material, print de anúncio, PDF de orçamento ou áudio. */
const ACEITA = "image/*,application/pdf,audio/*";
const MAX_ARQUIVO = 10 * 1024 * 1024;
const MAX_ARQUIVOS = 3;
const NOME_TIPO: Record<string, string> = { foto: "imagem", pdf: "PDF", audio: "áudio" };

/** File → base64, sem o prefixo "data:...;base64,". */
function base64(file: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => erro(r.error);
    r.readAsDataURL(file);
  });
}

/** Para começar: tocar manda a frase ao assistente de verdade. */
const EXEMPLOS = ["o que está pendente pra mim?", "preciso de 40 sacos de cimento cp2 até quinta", "10 caixas de papel A4 para o escritório"];

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
  const anexos = (m.anexos ?? []).map((a) => `📎 ${a.nome ?? NOME_TIPO[a.tipo] ?? "arquivo"}`).join("  \n");
  if (anexos) return m.texto ? `${m.texto}  \n${anexos}` : anexos;
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

/**
 * A última mensagem do assistente com botões de ação: só ela mostra esses botões. Se o comprador já tocou
 * num botão depois dela, nenhuma fica ativa (senão "Sim, aprovar" podia ser tocado de novo).
 * Botões de link não entram na conta: só navegam, então uma mensagem só com links não apaga os botões de antes.
 */
function ultimaComBotoes(msgs: MensagemChat[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.direcao === "entrada" && !m.texto && !m.anexos?.length) return null; // toque num botão
    if (m.direcao === "saida" && m.botoes?.some((b) => !ehLink(b))) return m.id;
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
  homeScreenBeforeInputElement: <p className={s.dicaInicio}>Pergunte o que está pendente, como está um pedido, ou escreva o que precisa comprar, do seu jeito.</p>,
};

/** O chat de quem entrou: o endereço é o id do usuário (contato "web" dele, ver src/contas.ts). */
export function Conversa({ endereco, topo }: { endereco: string; topo?: ReactNode }) {
  // A conversa vem sempre do banco. O chat da Carbon guarda o estado da aba no sessionStorage e, num F5,
  // o restaura no lugar de pedir o histórico: a conversa do banco não aparecia. Apaga antes de o chat montar.
  useState(() => {
    try {
      sessionStorage.removeItem("CARBON_CHAT_SESSION");
    } catch {
      // Sem sessionStorage, não há o que restaurar.
    }
  });
  const [historicoPronto, setHistoricoPronto] = useState(false);
  const [chatPronto, setChatPronto] = useState(false);
  const [novas, setNovas] = useState(false);
  const router = useRouter();

  const enderecoAgora = useRef<string | null>(null);
  enderecoAgora.current = endereco;
  const instancia = useRef<ChatInstance | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  /** Mensagens do banco que já estão na conversa. */
  const vistas = useRef(new Set<string>());
  const pendentes = useRef<Pendente[]>([]);
  const especiais = useRef(new Map<string, Especial>());
  const noFim = useRef(true);
  /** Arquivos escolhidos ou colados, esperando o envio, pelo id do campo do chat. */
  const arquivos = useRef(new Map<string, File>());

  useEffect(() => () => zerarEstado(), []);

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
  const despachar = useCallback(async (envioId: string, texto: string, botao?: Botao, anexos?: AnexoChat[]) => {
    const end = enderecoAgora.current;
    if (!end) return;
    const pendente: Pendente = { chave: botao ? "" : texto, envioId, rotulo: botao?.rotulo, chegou: false };
    pendentes.current.push(pendente);
    marcarFalha(envioId, null);
    comecarEnvio();
    instancia.current?.updateIsMessageLoadingCounter("increase");
    try {
      const r = await enviarChat(end, botao ? "" : texto, botao?.dado, anexos);
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
      // Anexos: o chat manda o campo "file" de cada arquivo escolhido ou colado.
      const campos = (req.input.structured_data?.fields ?? []).filter((f) => f.type === "file");
      const files = campos.map((f) => arquivos.current.get(f.id)).filter((f): f is File => !!f);
      for (const f of campos) arquivos.current.delete(f.id);
      const anexos = files.length
        ? await Promise.all(files.map(async (f) => ({ nome: f.name || "imagem colada", mediaType: f.type, base64: await base64(f) })))
        : undefined;
      if (texto || anexos) await despachar(id, texto, undefined, anexos);
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
      abrir: (rota) => router.push(rota),
      tentarDeNovo: (envioId) => {
        const falha = falhaDoEnvio(envioId);
        if (!falha?.podeTentar) return;
        void despachar(envioId, falha.texto, falha.botao ? { rotulo: falha.texto, dado: falha.botao } : undefined);
      },
    }),
    [despachar, router],
  );

  // Links relativos no texto do assistente: a Carbon os desenha com target="_blank" dentro do shadow DOM.
  // Os da mesma origem navegam pelo router, na mesma aba e sem recarregar; os externos seguem como estão.
  useEffect(() => {
    if (!chatPronto) return;
    const raiz = document.querySelector("cds-aichat-container")?.shadowRoot;
    if (!raiz) return;
    const aoClicar = (e: Event) => {
      const ev = e as MouseEvent;
      // Ctrl, Cmd, Shift ou botão do meio: quem pediu outra aba ou janela recebe.
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      // O <a> fica no shadow DOM do Markdown da Carbon: de fora, e.target já é o elemento do Markdown.
      const link = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
      const rota = rotaInterna(link?.getAttribute("href") ?? "");
      if (!rota) return;
      e.preventDefault();
      router.push(rota);
    };
    raiz.addEventListener("click", aoClicar, true);
    return () => raiz.removeEventListener("click", aoClicar, true);
  }, [chatPronto, router]);

  // ---------- Anexos ----------

  /** Guarda o arquivo e devolve o campo que o chat junta à mensagem pendente. */
  const campoDoArquivo = useCallback(async (file: File) => {
    if (!ACEITA.split(",").some((t) => (t.endsWith("/*") ? file.type.startsWith(t.slice(0, -1)) : file.type === t))) {
      throw new Error("Mande uma imagem, um PDF ou um áudio.");
    }
    if (file.size > MAX_ARQUIVO) throw new Error("O arquivo passa de 10 MB.");
    const id = crypto.randomUUID();
    arquivos.current.set(id, file);
    return { fields: [{ id, type: "file", label: file.name, value: { type: "reference" as const, id, name: file.name || "imagem colada", mime_type: file.type, size: file.size } }] };
  }, []);

  // Colar uma imagem (Ctrl+V de um print) anexa como se tivesse escolhido o arquivo.
  useEffect(() => {
    if (!chatPronto) return;
    const raiz = document.querySelector("cds-aichat-container")?.shadowRoot;
    if (!raiz) return;
    const aoColar = (e: Event) => {
      const dados = (e as ClipboardEvent).clipboardData;
      const files = [...(dados?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const dt = new DataTransfer();
      for (const f of files.slice(0, MAX_ARQUIVOS)) {
        const nome = f.name && f.name !== "image.png" ? f.name : `print-${new Date().toLocaleTimeString("pt-BR").replace(/:/g, "")}.png`;
        dt.items.add(new File([f], nome, { type: f.type }));
      }
      // Passa pelo mesmo caminho do botão de anexo: o chat chama onFileUpload e mostra o arquivo no campo.
      const entrada = raiz.querySelector<HTMLInputElement>("input[type=file]");
      if (entrada) {
        entrada.files = dt.files;
        entrada.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      void (async () => {
        for (const arquivo of dt.files) {
          const campo = await campoDoArquivo(arquivo).catch(() => null);
          if (campo) instancia.current?.input.updateStructuredData((antes) => ({ ...antes, fields: [...(antes?.fields ?? []), ...campo.fields] }));
        }
      })();
    };
    raiz.addEventListener("paste", aoColar, true);
    return () => raiz.removeEventListener("paste", aoColar, true);
  }, [chatPronto, campoDoArquivo]);

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
        greeting: "Como posso ajudar?",
        starters: { isOn: true, buttons: EXEMPLOS.map((label) => ({ label })) },
      },
      upload: {
        isOn: true,
        accept: ACEITA,
        maxFileSizeBytes: MAX_ARQUIVO,
        maxFiles: MAX_ARQUIVOS,
        onFileUpload: async (file: File) => campoDoArquivo(file),
      },
      messaging: {
        skipWelcome: true,
        messageLoadingIndicatorTimeoutSecs: 0,
        customSendMessage: aoEnviar,
        customLoadHistory: carregarHistorico,
      },
    }),
    [aoEnviar, carregarHistorico, campoDoArquivo],
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
        {topo}
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
