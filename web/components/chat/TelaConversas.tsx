"use client";
// Conversar (/chat): a coluna de conversas à esquerda e a conversa aberta à direita; abaixo de md, uma de
// cada vez. Só as conversas da conta de quem entrou (Frente 2): primeiro o Telegram ligado a ela (o espelho,
// só leitura, com "Continuar no Telegram"), depois as conversas do site, em que se escreve. "Nova conversa"
// abre um chat novo e limpo com o assistente; as anteriores ficam na lista. A escolha fica na URL (?c=<contato>).

import { Button, SkeletonText, Tag } from "@carbon/react";
import { Add, ArrowLeft } from "@carbon/react/icons";
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useSessao } from "@/components/conta/sessao";
import { useCelular } from "@/components/useCelular";
import { novaConversa } from "@/lib/conversas";
import type { ConversasDoUsuario, ItemConversa } from "@/lib/dados-conversas";
import { ChatWeb } from "./ChatWeb";
import { ConversaLeitura } from "./ConversaLeitura";
import { horaCompleta, horaRelativa } from "./tempo";
import s from "./conversas.module.scss";

/** A lista muda devagar: a conversa aberta já tem a própria consulta, mais rápida. */
const INTERVALO_LISTA_MS = 5000;

function useLista(usuarioId: string | null) {
  const [lista, setLista] = useState<ConversasDoUsuario | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!usuarioId) return;
    let vivo = true;
    // Com a guia escondida, a consulta para; a primeira vai sempre.
    let primeira = true;
    const buscar = async () => {
      if (!primeira && document.visibilityState !== "visible") return;
      primeira = false;
      try {
        const r = await fetch(`/api/conversas?usuario=${encodeURIComponent(usuarioId)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const nova = (await r.json()) as ConversasDoUsuario;
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
  }, [usuarioId, versao]);
  return { lista, falhou, recarregar: () => setVersao((v) => v + 1) };
}

/** Nome da conversa do site na lista: a data da última mensagem (o trecho dela vai embaixo). */
function nomeDaConversa(i: ItemConversa, n: number, total: number): string {
  if (total === 1) return "Conversa com o assistente";
  return i.ultimaEm ? `Conversa de ${new Date(i.ultimaEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : `Conversa ${total - n}`;
}

function Item({ item, nome, href, aberto, marca }: { item: ItemConversa; nome: string; href: string; aberto: boolean; marca?: string }) {
  return (
    <li>
      <NextLink href={href} scroll={false} className={s.item} aria-current={aberto ? "page" : undefined}>
        <span className={s.itemTopo}>
          <span className={s.itemNome}>{nome}</span>
          {item.ultimaEm ? (
            <time className={s.itemHora} dateTime={item.ultimaEm} title={horaCompleta(item.ultimaEm)}>
              {horaRelativa(item.ultimaEm)}
            </time>
          ) : null}
        </span>
        {marca ? (
          <Tag type="cyan" size="sm" className={s.itemMarca}>
            {marca}
          </Tag>
        ) : null}
        <span className={s.itemTrecho}>{item.trecho ?? (item.canal === "web" ? "Nenhuma mensagem ainda. Escreva aqui." : "Nenhuma mensagem ainda.")}</span>
      </NextLink>
    </li>
  );
}

export function TelaConversas({ linkTelegram }: { linkTelegram: string | null }) {
  const busca = useSearchParams();
  const rota = usePathname();
  const router = useRouter();
  const c = busca.get("c");
  const celular = useCelular();
  const sessao = useSessao();
  const { lista, falhou, recarregar } = useLista(sessao?.id ?? null);
  const [criando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const hrefCom = (contato: string | null) => {
    const p = new URLSearchParams(busca.toString());
    if (contato) p.set("c", contato);
    else p.delete("c");
    const q = p.toString();
    return q ? `${rota}?${q}` : rota;
  };

  const web = lista?.web ?? [];
  const telegram = lista?.telegram ?? [];
  // Sem escolha, abre a conversa do site mais recente.
  const aberta = c ? [...web, ...telegram].find((i) => i.contatoId === c) : web[0];
  const abertaWeb = aberta?.canal === "web" ? web.find((w) => w.contatoId === aberta.contatoId) : undefined;
  const vista = celular && !c ? "lista" : "conversa";

  const criar = () =>
    iniciar(async () => {
      if (!sessao) return;
      setErro(null);
      const r = await novaConversa(sessao.id);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      recarregar();
      router.push(hrefCom(r.contatoId), { scroll: false });
    });

  const voltar = (
    <NextLink href={hrefCom(null)} className={s.voltar}>
      <ArrowLeft size={20} aria-hidden="true" />
      Conversas
    </NextLink>
  );

  let painel = null;
  if (!lista) {
    painel = (
      <div className={s.painel} aria-hidden="true">
        <div className={s.mensagensCarregando}>
          <SkeletonText paragraph lineCount={4} />
        </div>
      </div>
    );
  } else if (abertaWeb) {
    painel = (
      <div className={s.painel}>
        <header className={s.painelTopo}>
          {celular ? voltar : null}
          <div className={s.painelTitulos}>
            <h2 className={s.painelTitulo}>{nomeDaConversa(abertaWeb, web.indexOf(abertaWeb), web.length)}</h2>
            <p className={s.painelContexto}>Seu chat com o assistente: você escreve aqui</p>
          </div>
        </header>
        <div className={s.painelCorpo}>
          <ChatWeb endereco={abertaWeb.endereco} />
        </div>
      </div>
    );
  } else if (aberta) {
    painel = (
      <ConversaLeitura
        contatoId={aberta.contatoId}
        linkTelegram={linkTelegram}
        seu
        voltar={celular ? voltar : undefined}
        verConversas={{ href: hrefCom(null) }}
        hrefDeste={hrefCom(web[0]?.contatoId ?? null)}
      />
    );
  } else {
    painel = (
      <div className={s.painel}>
        <p className={s.painelVazio}>Nenhuma conversa aberta. Comece uma pelo botão &quot;Nova conversa&quot;.</p>
      </div>
    );
  }

  return (
    <div className={s.tela} data-vista={vista}>
      <nav className={s.lista} aria-labelledby="titulo-conversas">
        <div className={s.listaTopo}>
          <h1 id="titulo-conversas" className={s.listaTitulo}>
            Conversas
          </h1>
          <Button kind="primary" size="sm" renderIcon={Add} onClick={criar} disabled={criando || !sessao}>
            Nova conversa
          </Button>
        </div>
        {erro ? (
          <p className={s.nota} role="alert">
            {erro}
          </p>
        ) : null}
        {falhou ? (
          <p className={s.nota} role="status">
            Não deu para atualizar a lista. Tentando de novo…
          </p>
        ) : null}

        {telegram.length ? (
          <section className={s.secao} aria-labelledby="secao-telegram">
            <h2 id="secao-telegram" className={s.secaoTitulo}>
              Telegram
            </h2>
            <ul className={s.itens}>
              {telegram.map((i) => (
                <Item key={i.contatoId} item={i} nome="Seu Telegram" marca="Só leitura" href={hrefCom(i.contatoId)} aberto={aberta?.contatoId === i.contatoId} />
              ))}
            </ul>
          </section>
        ) : null}

        <section className={s.secao} aria-labelledby="secao-web">
          <h2 id="secao-web" className={s.secaoTitulo}>
            No site
          </h2>
          {lista ? (
            web.length ? (
              <ul className={s.itens}>
                {web.map((i, n) => (
                  <Item key={i.contatoId} item={i} nome={nomeDaConversa(i, n, web.length)} href={hrefCom(i.contatoId)} aberto={aberta?.contatoId === i.contatoId} />
                ))}
              </ul>
            ) : (
              <p className={s.nota}>Nenhuma conversa no site ainda.</p>
            )
          ) : (
            <div className={s.listaCarregando} aria-hidden="true">
              <SkeletonText paragraph lineCount={3} />
            </div>
          )}
        </section>
      </nav>

      <div className={s.aberta}>{painel}</div>
    </div>
  );
}
