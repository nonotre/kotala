"use client";
// T2 a T7: o chat de um fornecedor simulado, visto como o fornecedor. As mensagens vêm do banco
// (a página relê a cada poucos segundos); escrever ou tocar num botão vai pela API interna,
// que faz a mensagem entrar como se o fornecedor tivesse respondido. Nada sai para um Telegram de verdade.

import { Button, InlineNotification, Tag, TextArea } from "@carbon/react";
import { Send } from "@carbon/react/icons";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { alterarAutomatico, enviarComoFornecedor } from "@/lib/acoes";
import type { BotaoSimulado, ChatSimulado as Chat, MensagemSimulada } from "@/lib/dados-simulado";
import s from "./telegram.module.scss";

const FUSO = "America/Sao_Paulo";
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: FUSO });
/** Perto do fim da lista: mensagem nova desce sozinha. Mais acima, quem está lendo não é puxado. */
const FOLGA_FIM_PX = 120;

type ItemChat = { id: number; pedidoId: number; titulo: string };

/** Cor do botão no Telegram simulado: o `estilo` sugerido pelo sistema, quando há. */
function tipoDoBotao(b: BotaoSimulado) {
  if (b.estilo === "primario" || b.estilo === "sucesso") return "primary" as const;
  if (b.estilo === "perigo") return "danger--tertiary" as const;
  return "tertiary" as const;
}

/**
 * Mensagens da cotação de `?item=`. As do sistema trazem o item; as do fornecedor não,
 * então valem as respostas que vieram logo depois de uma mensagem daquele item.
 */
function daCotacao(mensagens: MensagemSimulada[], itemId: number | null): Set<string> {
  const ids = new Set<string>();
  if (itemId === null) return ids;
  let atual: number | null = null;
  for (const m of mensagens) {
    if (m.direcao === "saida") atual = m.itemPedidoId;
    if (atual === itemId) ids.add(m.id);
  }
  return ids;
}

function textoDe(m: MensagemSimulada) {
  if (m.texto) return m.texto;
  return m.direcao === "entrada" ? "(tocou num botão)" : "";
}

export function ChatSimulado({ chat, item }: { chat: Chat; item: ItemChat | null }) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** O que acabou de ser enviado, até aparecer no banco. */
  const [pendente, setPendente] = useState<{ texto: string; desde: string } | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const pertoDoFim = useRef(true);
  const primeira = useRef(true);
  const total = useRef(0);

  const { mensagens } = chat;
  const destacadas = useMemo(() => daCotacao(mensagens, item?.id ?? null), [mensagens, item?.id]);
  const primeiraDestacada = mensagens.find((m) => destacadas.has(m.id))?.id ?? null;

  // A resposta pode chegar ao banco (pela atualização sozinha) antes de a ação voltar: não mostra duas vezes.
  const pendenteVisivel =
    pendente && !mensagens.some((m) => m.direcao === "entrada" && m.criadoEm >= pendente.desde && m.texto === pendente.texto) ? pendente : null;

  // Ao abrir: vai à primeira mensagem da cotação pedida, ou ao fim. Depois, desce quando chega mensagem nova.
  useLayoutEffect(() => {
    const el = lista.current;
    if (!el) return;
    const n = mensagens.length + (pendenteVisivel ? 1 : 0);
    if (primeira.current) {
      primeira.current = false;
      total.current = n;
      const alvo = primeiraDestacada ? document.getElementById(`msg-${primeiraDestacada}`) : null;
      if (alvo) alvo.scrollIntoView({ block: "start" });
      else el.scrollTop = el.scrollHeight;
      return;
    }
    if (n !== total.current && pertoDoFim.current) el.scrollTop = el.scrollHeight;
    total.current = n;
  }, [mensagens.length, pendenteVisivel, primeiraDestacada]);

  useEffect(() => {
    if (pendente && !pendenteVisivel) setPendente(null);
  }, [pendente, pendenteVisivel]);

  function aoRolar() {
    const el = lista.current;
    if (el) pertoDoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLGA_FIM_PX;
  }

  async function enviar(conteudo: string, botao?: BotaoSimulado) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    pertoDoFim.current = true;
    if (!botao) setPendente({ texto: conteudo, desde: new Date().toISOString() });
    try {
      const r = await enviarComoFornecedor(chat.contatoId, conteudo, botao?.dado);
      if (!r.ok) {
        setErro(r.erro ?? "Não deu para enviar.");
        // Não chegou: o texto volta para o campo, para não ter que escrever de novo.
        if (!botao) setTexto((atual) => atual || conteudo);
      }
    } catch {
      setErro("Não deu para falar com o servidor. Tente de novo.");
      if (!botao) setTexto((atual) => atual || conteudo);
    } finally {
      setPendente(null);
      setOcupado(false);
    }
  }

  function enviarTexto() {
    const t = texto.trim();
    if (!t || ocupado) return;
    setTexto("");
    void enviar(t);
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha. Durante a composição de acentos, o Enter é do teclado.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    enviarTexto();
  }

  async function alternar() {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await alterarAutomatico(chat.contatoId, !chat.automatico);
      if (!r.ok) setErro(r.erro ?? "Não deu para mudar quem responde.");
    } catch {
      setErro("Não deu para falar com o servidor. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }

  let diaAnterior = "";
  return (
    <div className={s.tela}>
      <div className={s.faixa} role="note">
        <span>
          <span className={s.faixaTitulo}>Telegram simulado</span> — Você é o fornecedor <strong>{chat.fornecedor.nome}</strong>. Nada aqui vai para um Telegram de verdade.
        </span>
        <Link href="/telegram-simulado">Todos os chats simulados</Link>
      </div>

      <header className={s.topo}>
        <div className={s.quem}>
          <span className={s.avatar} aria-hidden="true">
            K
          </span>
          <div>
            <h1 className={s.nome}>Kotala</h1>
            <p className={s.subtitulo}>bot de cotações · conversa com {chat.fornecedor.nome}</p>
            {/* X5: o mesmo papel por voz, enquanto a cotação estiver aberta e sem resposta deste fornecedor. */}
            {chat.ligacoes.map((l) => (
              <p key={l.cotacaoId} className={s.subtitulo}>
                <Link href={`/voz/${l.cotacaoId}`}>Ligar por voz: cotação {l.pedidoId}, {l.descricao}</Link>
              </p>
            ))}
          </div>
        </div>
        <div className={s.modo}>
          {chat.automatico ? (
            <Tag type="green" size="md" title="A persona do simulador responde sozinha">
              Automático
            </Tag>
          ) : (
            <Tag type="purple" size="md" title="A persona do simulador não responde: quem responde é você">
              Você assumiu
            </Tag>
          )}
          <Button kind={chat.automatico ? "secondary" : "tertiary"} size="sm" disabled={ocupado} onClick={alternar}>
            {chat.automatico ? "Assumir" : "Devolver ao automático"}
          </Button>
        </div>
      </header>

      {item ? (
        <div className={s.contexto}>
          <span>
            Cotação do <Link href={`/pedidos/${item.pedidoId}#item-${item.id}`}>pedido {item.pedidoId}</Link>: {item.titulo}.
          </span>
          <span className={s.contextoAjuda}>{destacadas.size ? "As mensagens desta cotação estão marcadas." : "Ainda não há mensagem desta cotação neste chat."}</span>
        </div>
      ) : null}

      <div ref={lista} className={s.lista} onScroll={aoRolar} aria-live="polite" aria-label={`Mensagens com ${chat.fornecedor.nome}`}>
        <div className={s.coluna}>
          {mensagens.length === 0 && !pendenteVisivel ? <p className={s.vazio}>Nenhuma mensagem ainda. Quando o sistema mandar uma cotação a {chat.fornecedor.nome}, ela aparece aqui.</p> : null}
          {mensagens.map((m) => {
            const d = dia(m.criadoEm);
            const separador = d !== diaAnterior ? (
              <p key={`dia-${m.id}`} className={s.dia}>
                {d}
              </p>
            ) : null;
            diaAnterior = d;
            const doSistema = m.direcao === "saida";
            const destaque = destacadas.has(m.id);
            const naoEntregue = m.situacao === "falhou" || m.situacao === "bloqueada_parar";
            return [
              separador,
              <div key={m.id} id={`msg-${m.id}`} className={`${s.mensagem} ${doSistema ? s.doSistema : s.doFornecedor} ${destaque ? s.destaque : ""}`}>
                {destaque && m.id === primeiraDestacada ? <span className={s.marcaCotacao}>Desta cotação</span> : null}
                <div className={s.balao}>
                  {textoDe(m)}
                  <span className={s.rodapeBalao}>
                    {naoEntregue ? <span className={s.falhou}>{m.situacao === "falhou" ? "não entregue · " : "fornecedor pediu para parar · "}</span> : null}
                    <time dateTime={m.criadoEm}>{hora(m.criadoEm)}</time>
                  </span>
                </div>
                {doSistema && m.botoes.length ? (
                  <div className={s.botoes}>
                    {m.botoes.map((b) => (
                      <Button key={b.dado} kind={tipoDoBotao(b)} size="sm" disabled={ocupado} onClick={() => void enviar("", b)}>
                        {b.rotulo}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>,
            ];
          })}
          {pendenteVisivel ? (
            <div className={`${s.mensagem} ${s.doFornecedor} ${s.pendente}`}>
              <div className={s.balao}>
                {pendenteVisivel.texto}
                <span className={s.rodapeBalao}>enviando…</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={s.rodape}>
        <div className={s.rodapeColuna}>
          {erro ? <InlineNotification kind="error" lowContrast title="Não deu certo." subtitle={erro} onCloseButtonClick={() => setErro(null)} statusIconDescription="Erro" /> : null}
          <div className={s.escrever}>
            <TextArea
              id="mensagem-simulada"
              labelText={`Mensagem como ${chat.fornecedor.nome}`}
              hideLabel
              rows={2}
              placeholder={`Escreva como ${chat.fornecedor.nome}`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={aoTeclar}
            />
            <Button kind="primary" size="lg" hasIconOnly renderIcon={Send} iconDescription="Enviar" tooltipPosition="top" disabled={ocupado || !texto.trim()} onClick={enviarTexto} />
          </div>
          <p className={s.dica}>
            {chat.automatico
              ? "Enter envia; Shift+Enter quebra a linha. Ao escrever ou tocar num botão, você assume o chat e a persona para de responder."
              : "Enter envia; Shift+Enter quebra a linha. A persona não responde enquanto você estiver no chat."}
          </p>
        </div>
      </div>
    </div>
  );
}
