"use client";
// Conversas: a lista à esquerda e a conversa aberta à direita. Abaixo de md, uma de cada vez.
// `compacto` (a lateral do Início): sempre uma de cada vez. Abre na conversa deste navegador, e o botão
// "Conversas" do topo mostra a lista.
// A conversa de quem entrou é a única em que dá para escrever (o chat da Carbon, com envio);
// as outras, do chat web e do Telegram, abrem só para ler. O Telegram ligado à conta (Frente 2) aparece
// como "Seu Telegram": é o espelho dele. A escolha fica na URL (?c=<contato>), junto com o que a tela
// já tinha nela, para dar para mandar o link. Todos veem as conversas de todos, como os cards.

import { SkeletonText, Tag } from "@carbon/react";
import { ArrowLeft, ListBulleted } from "@carbon/react/icons";
import NextLink from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSessao } from "@/components/conta/sessao";
import { useCelular } from "@/components/useCelular";
import type { ItemConversa, ListaConversas } from "@/lib/dados-conversas";
import { ChatWeb } from "./ChatWeb";
import { ConversaLeitura } from "./ConversaLeitura";
import { horaCompleta, horaRelativa } from "./tempo";
import s from "./conversas.module.scss";

/** A lista muda devagar: a conversa aberta já tem a própria consulta, mais rápida. */
const INTERVALO_LISTA_MS = 5000;
/** Na URL, a conversa deste navegador antes de ela existir no banco. */
const ESTE = "este";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useLista(endereco: string | null) {
  const [lista, setLista] = useState<ListaConversas | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (!endereco) return;
    let vivo = true;
    // Com a guia escondida, a consulta para; a primeira vai sempre.
    let primeira = true;
    const buscar = async () => {
      if (!primeira && document.visibilityState !== "visible") return;
      primeira = false;
      try {
        const r = await fetch(`/api/conversas?endereco=${encodeURIComponent(endereco)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const nova = (await r.json()) as ListaConversas;
        if (vivo) {
          setLista(nova);
          setFalhou(false);
        }
      } catch {
        if (vivo) setFalhou(true); // a lista que já está na tela fica; tenta de novo no próximo ciclo
      }
    };
    void buscar();
    const t = setInterval(buscar, INTERVALO_LISTA_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [endereco]);
  return { lista, falhou };
}

type PropsItem = { item: ItemConversa; href: string; aberto: boolean; aoEscolher?: () => void };
/** Para onde vai o foco depois da troca de lista e conversa feita aqui; na conversa, só quando o `c` já for o dela. */
type Foco = { alvo: "lista" } | { alvo: "conversa"; contato: string | null };

function Item({ item, href, aberto, aoEscolher }: PropsItem) {
  return (
    <li>
      {/* Sem rolar a página: no Início, quem escolhe uma conversa na lateral não perde o lugar nas cotações. */}
      <NextLink href={href} scroll={false} onClick={aoEscolher} className={s.item} aria-current={aberto ? "page" : undefined}>
        <span className={s.itemTopo}>
          <span className={s.itemNome}>{item.nome}</span>
          {item.ultimaEm ? (
            <time className={s.itemHora} dateTime={item.ultimaEm} title={horaCompleta(item.ultimaEm)}>
              {horaRelativa(item.ultimaEm)}
            </time>
          ) : null}
        </span>
        {item.meu ? (
          <Tag type="blue" size="sm" className={s.itemMarca}>
            Você
          </Tag>
        ) : item.seu ? (
          <Tag type="cyan" size="sm" className={s.itemMarca}>
            Seu Telegram
          </Tag>
        ) : null}
        <span className={s.itemTrecho}>{item.trecho ?? "Nenhuma mensagem ainda. Escreva aqui."}</span>
      </NextLink>
    </li>
  );
}

/** Item da conversa deste navegador antes de ela existir no banco (nada foi escrito ainda). */
const MEU_VAZIO: ItemConversa = { contatoId: "", canal: "web", nome: "Você", meu: true, seu: true, trecho: null, ultimaEm: null };

type Props = {
  linkTelegram: string | null;
  /** Para uma coluna estreita: lista e conversa alternadas em qualquer largura, e o chat em modo painel. */
  compacto?: boolean;
};

export function TelaConversas({ linkTelegram, compacto = false }: Props) {
  const busca = useSearchParams();
  const rota = usePathname();
  const c = busca.get("c");
  const celular = useCelular();
  // O endereço do chat web de quem entrou é o id do usuário (src/contas.ts).
  const sessao = useSessao();
  const { lista, falhou } = useLista(sessao?.id ?? null);
  // No modo compacto, a lista é aberta pelo botão do topo e vale só para a conversa em que foi aberta:
  // mudou o `c` (escolheu outra, ou o voltar do navegador), a lista fecha. `false` é fechada.
  const [listaAbertaEm, setListaAbertaEm] = useState<string | null | false>(false);
  const focarDepois = useRef<Foco | null>(null);
  const tituloLista = useRef<HTMLHeadingElement>(null);
  const aberta = useRef<HTMLDivElement>(null);

  /** Mesmo endereço, com outra conversa (ou nenhuma): o resto da URL (vista, filtro) fica como está. */
  const hrefCom = (contato: string | null) => {
    const p = new URLSearchParams(busca.toString());
    if (contato) p.set("c", contato);
    else p.delete("c");
    const q = p.toString();
    return q ? `${rota}?${q}` : rota;
  };

  const meu = lista?.web.find((i) => i.meu) ?? MEU_VAZIO;
  const outrasWeb = lista?.web.filter((i) => !i.meu) ?? [];
  // No compacto, a deste navegador é a que abre sem escolha: o endereço dela não leva `c`.
  const hrefMeu = compacto ? hrefCom(null) : hrefCom(meu.contatoId || ESTE);
  const total = lista ? lista.web.length + lista.telegram.length : null;

  // Qual conversa abre. Sem escolha, a deste navegador (abaixo de md, a lista).
  // Um id só é a deste navegador depois que a lista disse qual é: até lá, espera.
  const ehMeu = !c || c === ESTE || (!!meu.contatoId && c === meu.contatoId);
  const esperandoLista = !ehMeu && !lista && UUID.test(c ?? "");
  const vista = compacto ? (listaAbertaEm !== false && listaAbertaEm === c ? "lista" : "conversa") : celular && !c ? "lista" : "conversa";

  // A conversa espera o endereço novo: o chat deste navegador, ao sair, leva o foco junto.
  useEffect(() => {
    const f = focarDepois.current;
    if (f?.alvo === "lista" && vista === "lista") {
      focarDepois.current = null;
      tituloLista.current?.focus();
    }
    if (f?.alvo === "conversa" && vista === "conversa" && c === f.contato) {
      focarDepois.current = null;
      aberta.current?.focus();
    }
  }, [vista, c]);

  const abrirLista = () => {
    focarDepois.current = { alvo: "lista" };
    setListaAbertaEm(c);
  };
  const escolher = (contato: string | null) => () => {
    focarDepois.current = { alvo: "conversa", contato };
    setListaAbertaEm(false);
  };

  // No compacto, o botão do topo abre a lista. Na conversa deste navegador, aberta sem escolha, ele leva a contagem;
  // numa conversa escolhida na lista, é o caminho de volta a ela.
  const voltar = compacto ? (
    <button type="button" className={s.voltar} onClick={abrirLista}>
      {c ? <ArrowLeft size={20} aria-hidden="true" /> : <ListBulleted size={20} aria-hidden="true" />}
      Conversas
      {!c && total ? (
        <span className={s.contagem}>
          <span className={s.somenteLeitor}>, </span>
          {total}
        </span>
      ) : null}
    </button>
  ) : (
    <NextLink href={hrefCom(null)} className={s.voltar}>
      <ArrowLeft size={20} aria-hidden="true" />
      Conversas
    </NextLink>
  );
  const Titulo = compacto ? "h2" : "h1";
  const TituloSecao = compacto ? "h3" : "h2";

  let painel = null;
  if (vista === "conversa") {
    if (ehMeu) {
      painel = (
        <div className={s.painel}>
          <header className={s.painelTopo}>
            {voltar}
            <div className={s.painelTitulos}>
              <h2 className={s.painelTitulo}>{meu.nome}</h2>
              <p className={s.painelContexto}>Seu chat com o assistente: você escreve aqui</p>
            </div>
          </header>
          <div className={s.painelCorpo}>
            <ChatWeb modo={compacto ? "painel" : "pagina"} />
          </div>
        </div>
      );
    } else if (esperandoLista) {
      painel = (
        <div className={s.painel} aria-hidden="true">
          <div className={s.mensagensCarregando}>
            <SkeletonText paragraph lineCount={4} />
          </div>
        </div>
      );
    } else {
      painel = (
        <ConversaLeitura
          contatoId={c ?? ""}
          linkTelegram={linkTelegram}
          seu={!!lista?.telegram.some((i) => i.contatoId === c && i.seu)}
          voltar={voltar}
          verConversas={compacto ? { aoClicar: abrirLista } : { href: hrefCom(null) }}
          hrefDeste={hrefMeu}
          aoIrParaDeste={compacto ? escolher(null) : undefined}
        />
      );
    }
  }

  return (
    <div className={s.tela} data-vista={vista} data-compacto={compacto ? "" : undefined}>
      <nav className={s.lista} aria-labelledby="titulo-conversas">
        {/* No compacto, recebe o foco quando o botão "Conversas" abre a lista. */}
        <Titulo id="titulo-conversas" ref={tituloLista} tabIndex={-1} className={s.somenteLeitor}>
          Conversas
        </Titulo>
        {falhou ? (
          <p className={s.nota} role="status">
            Não deu para atualizar a lista. Tentando de novo…
          </p>
        ) : null}

        <section className={s.secao} aria-labelledby="secao-web">
          <TituloSecao id="secao-web" className={s.secaoTitulo}>
            Conversas
          </TituloSecao>
          <ul className={s.itens}>
            <Item item={meu} href={hrefMeu} aberto={(compacto || vista === "conversa") && ehMeu} aoEscolher={compacto ? escolher(null) : undefined} />
            {outrasWeb.map((i) => (
              <Item key={i.contatoId} item={i} href={hrefCom(i.contatoId)} aberto={c === i.contatoId} aoEscolher={compacto ? escolher(i.contatoId) : undefined} />
            ))}
          </ul>
          {!lista && !falhou ? (
            <div className={s.listaCarregando} aria-hidden="true">
              <SkeletonText paragraph lineCount={3} />
            </div>
          ) : null}
        </section>

        <section className={s.secao} aria-labelledby="secao-telegram">
          <TituloSecao id="secao-telegram" className={s.secaoTitulo}>
            Conversas Telegram
          </TituloSecao>
          {lista?.telegram.length ? (
            <ul className={s.itens}>
              {lista.telegram.map((i) => (
                <Item key={i.contatoId} item={i} href={hrefCom(i.contatoId)} aberto={c === i.contatoId} aoEscolher={compacto ? escolher(i.contatoId) : undefined} />
              ))}
            </ul>
          ) : lista ? (
            <p className={s.nota}>Nenhum comprador falou com o bot do Telegram ainda.</p>
          ) : (
            <div className={s.listaCarregando} aria-hidden="true">
              <SkeletonText paragraph lineCount={2} />
            </div>
          )}
        </section>
      </nav>

      {/* No compacto, recebe o foco quando uma conversa é escolhida na lista. */}
      <div ref={aberta} className={s.aberta} tabIndex={compacto ? -1 : undefined}>
        {painel}
      </div>
    </div>
  );
}
