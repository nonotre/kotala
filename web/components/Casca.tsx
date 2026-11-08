"use client";
// Casca do app: Header e menu em zona escura nos dois temas. As telas só trazem o conteúdo.

import { Content, Header, HeaderGlobalAction, HeaderGlobalBar, HeaderMenuButton, HeaderName, SkipToContent, Tag } from "@carbon/react";
import { Asleep, Light, Notification } from "@carbon/react/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTema } from "@/lib/tema";
import { QuemEntrou, useGuardaSessao } from "./conta/Guarda";
import { MenuLateral } from "./MenuLateral";
import s from "./casca.module.scss";

const NOME_PRODUTO = "Kotala";
/** O `lg` do Carbon: a partir daí, o menu muda de forma. */
const A_PARTIR_DE_LG = "(min-width: 66rem)";

const NOMES_ABA: Record<string, string> = { busca: "Busca", cotacoes: "Cotações", comparacao: "Comparação", negociacao: "Negociação", decisao: "Decisão", historico: "Histórico" };

const NOMES_ROTA: Record<string, string> = {
  "/": "Início",
  "/quadro": "Quadro",
  "/pedidos": "Lista de pedidos",
  "/chat": "Conversar",
  "/fornecedores": "Fornecedores",
  "/itens": "Itens",
  "/dashboard": "Dashboard",
  "/avisos": "Avisos",
  "/convite": "Convite",
  "/configuracoes": "Configurações",
  "/configuracoes/enderecos": "Endereços",
  "/configuracoes/empresas": "Empresas",
  "/login": "Entrar",
};

/** Título da guia, com pedido e aba. */
function tituloDaRota(rota: string): string {
  const pedido = rota.match(/^\/pedidos\/(\d+)(?:\/([a-z]+))?/);
  if (pedido) return [`Pedido ${pedido[1]}`, NOMES_ABA[pedido[2] ?? ""]].filter(Boolean).join(", ");
  if (rota.startsWith("/fornecedores/")) return "Ficha do fornecedor";
  if (rota.startsWith("/voz/")) return "Ligação por voz";
  return NOMES_ROTA[rota] ?? "Cotações";
}

function Sino({ n }: { n: number }) {
  const router = useRouter();
  const aqui = usePathname() === "/avisos";
  const rotulo = n === 0 ? "Avisos" : n === 1 ? "1 aviso precisa de você" : `${n} avisos precisam de você`;
  return (
    <HeaderGlobalAction aria-label={rotulo} isActive={aqui} aria-current={aqui ? "page" : undefined} onClick={() => router.push("/avisos")}>
      <span className={s.sino}>
        <Notification size={20} />
        {n ? (
          <span className={s.sinoConta} aria-hidden="true">
            {n > 99 ? "99+" : n}
          </span>
        ) : null}
      </span>
    </HeaderGlobalAction>
  );
}

function TrocaTema() {
  const { escuro, alternarTema } = useTema();
  return (
    <HeaderGlobalAction aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"} onClick={alternarTema}>
      {escuro ? <Light size={20} /> : <Asleep size={20} />}
    </HeaderGlobalAction>
  );
}

export function Casca({ children, avisos }: { children: ReactNode; avisos: number }) {
  const rota = usePathname();
  const [aberto, setAberto] = useState(false);
  const noPedido = /^\/pedidos\/[^/]+/.test(rota);
  const rotaAnterior = useRef(rota);
  // Frente 2: sem sessão, vai para /login.
  useGuardaSessao();

  useEffect(() => {
    setAberto(false);
    // Troca de rota leva o foco ao conteúdo. Na primeira carga, fica onde o navegador pôs.
    // Compara a rota, e não a vez do efeito: em desenvolvimento, o StrictMode roda o efeito duas vezes.
    if (rotaAnterior.current === rota) return;
    rotaAnterior.current = rota;
    document.getElementById("conteudo")?.focus({ preventScroll: true });
  }, [rota]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAberto(false);
      document.querySelector<HTMLElement>("[data-botao-menu]")?.focus();
    };
    // Ao cruzar lg fora do pedido, o botão some: o menu não pode ficar aberto com o conteúdo bloqueado.
    const largura = window.matchMedia(A_PARTIR_DE_LG);
    const aoCruzar = () => setAberto(false);
    document.addEventListener("keydown", aoTeclar);
    largura.addEventListener("change", aoCruzar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      largura.removeEventListener("change", aoCruzar);
    };
  }, [aberto]);

  const titulo = <title>{`${tituloDaRota(rota)} · ${NOME_PRODUTO}`}</title>;

  // Telegram simulado: tela de outro "aplicativo", sem nada do site em volta. O título da aba vem da própria rota.
  if (/^\/telegram-simulado(\/|$)/.test(rota)) return <>{children}</>;

  // A entrada fica fora da casca: sem menu, sem sino.
  if (rota === "/login") {
    return (
      <>
        {titulo}
        <main id="conteudo" className={s.conteudoLogin}>
          {children}
        </main>
      </>
    );
  }

  return (
    <>
      {titulo}
      <Header aria-label={NOME_PRODUTO} className="cds--g100">
        <SkipToContent href="#conteudo">Pular para o conteúdo</SkipToContent>
        <HeaderMenuButton aria-label={aberto ? "Fechar menu" : "Abrir menu"} isActive={aberto} isCollapsible={noPedido} onClick={() => setAberto(!aberto)} data-botao-menu="" />
        <HeaderName as={Link} href="/" prefix="">
          {/* Logo do Kotala, desenhada pela Liria; a versão branca vai sobre a casca escura. */}
          <span className={s.marca}>
            <img src="/logo-branco.svg" alt="Kotala" className={s.logo} />
            <span className={s.nomeProduto}>Cotações</span>
          </span>
        </HeaderName>
        <HeaderGlobalBar>
          <div className={s.seloFicticio}>
            <Tag type="outline" size="sm" title="Fornecedores simulados aparecem marcados como simulados">
              Simulados marcados
            </Tag>
          </div>
          <Sino n={avisos} />
          <TrocaTema />
          <QuemEntrou />
        </HeaderGlobalBar>
      </Header>
      <MenuLateral aberto={aberto} aoFechar={() => setAberto(false)} />
      {/* Menu aberto cobre o conteúdo: o teclado também não passa por trás dele. */}
      <Content id="conteudo" tabIndex={-1} inert={aberto} className={`${s.conteudo} ${noPedido ? s.comTrilho : s.comMenu}`}>
        {children}
      </Content>
    </>
  );
}
