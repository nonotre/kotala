"use client";
// Uma conversa só para ler: o espelho do Telegram (o seu, ligado à conta, ou de outro comprador) ou o chat web de outra pessoa.
// Sem campo de envio e sem botões que façam algo: os botões que o assistente ofereceu aparecem como rótulos.
// Tudo vem do banco, por /api/conversas/<id>, consultado a cada 2 s. Lista simples, e não o chat da Carbon:
// nada de shadow root, de estado global nem de envio para esconder.

import { Button, Link as CarbonLink, SkeletonText, Tag, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { ArrowDown, Document } from "@carbon/react/icons";
import NextLink from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LinkExterno } from "@/components/LinkExterno";
import type { ConversaAberta, MensagemConversa } from "@/lib/dados-conversas";
import { AVATAR_ASSISTENTE } from "./avatar";
import { horaCompleta, horaCurta } from "./tempo";
import s from "./conversas.module.scss";

const INTERVALO_MS = 2000;
/** Até esta distância do fim, quem lê ainda está no fim. */
const LIMITE_DO_FIM_PX = 40;
const NOME_TIPO: Record<string, string> = { foto: "Imagem", pdf: "PDF", audio: "Áudio" };
const FUSO = "America/Sao_Paulo";

type Estado = { tipo: "carregando" } | { tipo: "pronta"; conversa: ConversaAberta } | { tipo: "nao-encontrada" } | { tipo: "falhou" };

const diaDe = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO });

/** "Hoje", "Ontem" ou a data, entre as mensagens de dias diferentes. */
function rotuloDoDia(iso: string): string {
  const agora = Date.now();
  if (diaDe(iso) === diaDe(new Date(agora).toISOString())) return "Hoje";
  if (diaDe(iso) === diaDe(new Date(agora - 86_400_000).toISOString())) return "Ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: FUSO });
}

function Anexos({ anexos }: { anexos: MensagemConversa["anexos"] }) {
  if (!anexos.length) return null;
  return (
    <ul className={s.anexos} aria-label="Anexos">
      {anexos.map((a, i) => (
        <li key={i} className={s.anexo}>
          <Document size={16} aria-hidden="true" />
          <span>{a.nome ?? NOME_TIPO[a.tipo] ?? "Arquivo"}</span>
        </li>
      ))}
    </ul>
  );
}

function Mensagem({ m }: { m: MensagemConversa }) {
  const hora = (
    <time className={s.msgHora} dateTime={m.criadoEm} title={horaCompleta(m.criadoEm)}>
      {horaCurta(m.criadoEm)}
    </time>
  );
  if (m.direcao === "entrada") {
    const vazia = !m.texto && !m.anexos.length;
    return (
      <li className={s.msgComprador}>
        <span className={s.somenteLeitor}>Comprador:</span>
        <div className={s.balao}>
          {m.texto ? <p className={s.msgTexto}>{m.texto}</p> : null}
          {/* O banco guarda o toque num botão sem texto, e sem o dado: não dá para saber qual foi. */}
          {vazia ? <p className={`${s.msgTexto} ${s.msgToque}`}>(tocou num botão)</p> : null}
          <Anexos anexos={m.anexos} />
        </div>
        {hora}
      </li>
    );
  }
  return (
    <li className={s.msgAssistente}>
      {/* Imagem em data: URI, a mesma do chat da Carbon: decorativa, o nome vem logo ao lado. */}
      <img className={s.avatar} src={AVATAR_ASSISTENTE} alt="" width={32} height={32} />
      <div className={s.msgCorpo}>
        <span className={s.msgAutor}>
          Assistente {hora}
        </span>
        {m.texto ? <p className={s.msgTexto}>{m.texto}</p> : null}
        <Anexos anexos={m.anexos} />
        {m.botoes?.length ? (
          <div className={s.rotulos}>
            <span className={s.somenteLeitor}>Botões oferecidos ao comprador:</span>
            {m.botoes.map((rotulo, i) => (
              <Tag key={i} type="gray" size="md">
                {rotulo}
              </Tag>
            ))}
          </div>
        ) : null}
        {m.naoEntregue ? <IconIndicator kind="failed" size={16} label="Não entregue ao comprador" /> : null}
      </div>
    </li>
  );
}

type Props = {
  contatoId: string;
  /** Link do bot do comprador no Telegram (https://t.me/...). Nulo sem token ou se o Telegram não respondeu. */
  linkTelegram: string | null;
  /** Botão de voltar à lista, abaixo de md. */
  voltar?: ReactNode;
  /** O caminho até a lista de conversas: no painel do Início, abre a lista ali; na tela inteira, o endereço sem `c`. */
  verConversas: { href?: string; aoClicar?: () => void };
  /** O Telegram ligado à conta de quem entrou (Frente 2): o espelho dele, com "Continuar no Telegram". */
  seu?: boolean;
  /** A conversa de quem entrou, com o resto do endereço (vista, filtro) como está. */
  hrefDeste: string;
  /** No painel do Início: ao abrir a conversa deste navegador, o foco vai para ela. */
  aoIrParaDeste?: () => void;
};

export function ConversaLeitura({ contatoId, linkTelegram, seu = false, voltar, verConversas, hrefDeste, aoIrParaDeste }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [novas, setNovas] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);
  /** Id da última mensagem desenhada: rola só quando chega mensagem nova. */
  const ultima = useRef<string | null>(null);

  // Troca de conversa: começa do zero, no fim.
  useEffect(() => {
    setEstado({ tipo: "carregando" });
    setNovas(false);
    noFim.current = true;
    ultima.current = null;
    let vivo = true;
    // Com a guia escondida, a consulta para; a primeira vai sempre.
    let primeira = true;
    const buscar = async () => {
      if (!primeira && document.visibilityState !== "visible") return;
      primeira = false;
      try {
        const r = await fetch(`/api/conversas/${contatoId}`, { cache: "no-store" });
        if (!vivo) return;
        if (r.status === 404 || r.status === 400) return setEstado({ tipo: "nao-encontrada" });
        if (!r.ok) return setEstado((e) => (e.tipo === "pronta" ? e : { tipo: "falhou" }));
        const conversa = (await r.json()) as ConversaAberta;
        if (vivo) setEstado({ tipo: "pronta", conversa });
      } catch {
        // Tenta de novo no próximo ciclo; o que já está na tela fica.
        if (vivo) setEstado((e) => (e.tipo === "pronta" ? e : { tipo: "falhou" }));
      }
    };
    void buscar();
    const t = setInterval(buscar, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [contatoId]);

  const mensagens = estado.tipo === "pronta" ? estado.conversa.mensagens : null;

  // Mensagem nova: quem está no fim acompanha; quem lê mais acima vê "Novas mensagens".
  useLayoutEffect(() => {
    const el = rolagem.current;
    const id = mensagens?.at(-1)?.id ?? null;
    if (!el || !id || id === ultima.current) return;
    const primeira = ultima.current === null;
    ultima.current = id;
    if (primeira || noFim.current) el.scrollTop = el.scrollHeight;
    else setNovas(true);
  }, [mensagens]);

  const aoRolar = useCallback(() => {
    const el = rolagem.current;
    if (!el) return;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < LIMITE_DO_FIM_PX;
    if (noFim.current) setNovas(false);
  }, []);

  const irAoFim = useCallback(() => {
    const el = rolagem.current;
    if (!el) return;
    noFim.current = true;
    setNovas(false);
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  if (estado.tipo === "nao-encontrada") {
    return (
      <div className={s.painel}>
        <div className={s.painelVazio}>
          {voltar}
          <EstadoVazio titulo="Conversa não encontrada" proximoPasso="O link pode estar errado, ou a conversa não é de um comprador. Escolha outra na lista." acao={{ texto: "Ver as conversas", ...verConversas }} />
        </div>
      </div>
    );
  }

  const conversa = estado.tipo === "pronta" ? estado.conversa : null;
  const telegram = conversa?.contato.canal === "telegram";

  return (
    <div className={s.painel}>
      <header className={s.painelTopo}>
        {voltar}
        <div className={s.painelTitulos}>
          {conversa ? <h2 className={s.painelTitulo}>{conversa.contato.nome}</h2> : <SkeletonText heading width="40%" />}
          {conversa ? <p className={s.painelContexto}>{telegram ? (seu ? "Seu Telegram · só leitura" : "Telegram · só leitura") : "Chat web de outra pessoa · só leitura"}</p> : null}
        </div>
      </header>

      <div className={s.mensagensArea}>
        {/* Região rolável: precisa receber foco para quem usa só o teclado. */}
        <div ref={rolagem} className={s.mensagens} role="log" aria-label="Mensagens" tabIndex={0} onScroll={aoRolar}>
          {estado.tipo === "carregando" ? (
            <div className={s.mensagensCarregando} aria-hidden="true">
              <SkeletonText paragraph lineCount={4} />
            </div>
          ) : null}
          {estado.tipo === "falhou" ? <p className={s.nota}>Não deu para ler a conversa. Tentando de novo…</p> : null}
          {mensagens && !mensagens.length ? <p className={s.nota}>Nenhuma mensagem ainda.</p> : null}
          {mensagens?.length ? (
            <ol className={s.listaMensagens}>
              {mensagens.map((m, i) => (
                <Fragment key={m.id}>
                  {i === 0 || diaDe(m.criadoEm) !== diaDe(mensagens[i - 1]!.criadoEm) ? (
                    <li className={s.dia} aria-hidden="true">
                      <span>{rotuloDoDia(m.criadoEm)}</span>
                    </li>
                  ) : null}
                  <Mensagem m={m} />
                </Fragment>
              ))}
            </ol>
          ) : null}
        </div>
        {novas ? (
          <div className={s.novas}>
            <Button kind="secondary" size="sm" renderIcon={ArrowDown} onClick={irAoFim}>
              Novas mensagens
            </Button>
          </div>
        ) : null}
      </div>

      {/* No lugar do campo de envio: por que não dá para escrever e, no Telegram, o caminho até o bot. */}
      {conversa ? (
        <footer className={s.rodapeLeitura}>
          {telegram ? (
            <>
              <p className={s.rodapeTexto}>
                {linkTelegram
                  ? seu
                    ? "Só leitura: você responde no Telegram. O botão abre o bot."
                    : "Só leitura: o comprador responde no Telegram. O botão abre o bot, não esta conversa."
                  : "Só leitura. O link para o bot não está disponível: falta TELEGRAM_TOKEN_COMPRADOR ou o Telegram não respondeu."}
              </p>
              {linkTelegram ? (
                <LinkExterno href={linkTelegram} botao="primary" tamanho="md">
                  {seu ? "Continuar no Telegram" : "Abrir no Telegram"}
                </LinkExterno>
              ) : null}
            </>
          ) : (
            <p className={s.rodapeTexto}>
              Só leitura: esta conversa é de outra pessoa. Para escrever, use{" "}
              {/* Sem rolar a página: no Início, a lista de cotações fica onde estava. */}
              <CarbonLink as={NextLink} href={hrefDeste} scroll={false} onClick={aoIrParaDeste} inline>
                a sua conversa
              </CarbonLink>
              .
            </p>
          )}
        </footer>
      ) : null}
    </div>
  );
}
