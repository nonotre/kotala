"use client";
// Frente 2: o espelho da sessão no navegador e o menu de quem entrou, no topo.
// A proteção das rotas é no servidor (proxy.ts): aqui só se acerta o que a interface mostra com o
// que o servidor disse (o layout lê o cookie) e se segue outra aba que saiu.

import { HeaderGlobalAction, HeaderPanel, Switcher, SwitcherDivider, SwitcherItem } from "@carbon/react";
import { UserAvatar } from "@carbon/react/icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { trocarEmpresaAtiva, type Sessao } from "@/lib/contas";
import { esquecerSessao, guardarSessao, sair, useSessao } from "./sessao";
import s from "../casca.module.scss";

/** O que o layout (servidor) sabe de quem entrou: a sessão do cookie e a empresa em uso. */
export type ContaDoTopo = {
  sessao: Sessao | null;
  empresas: { id: string; nome: string }[];
  empresaAtiva: string | null;
};

/** Acerta o espelho com o servidor; se outra aba saiu (o espelho sumiu), vai para a entrada. */
export function useGuardaSessao(servidor: Sessao | null) {
  const espelho = useSessao();
  const rota = usePathname();
  const router = useRouter();
  const anterior = useRef<Sessao | null | undefined>(undefined);

  useEffect(() => {
    if (servidor) {
      if (espelho?.id !== servidor.id || espelho.nome !== servidor.nome || espelho.login !== servidor.login) guardarSessao(servidor);
    } else if (espelho) {
      esquecerSessao();
    }
  }, [servidor, espelho]);

  useEffect(() => {
    if (espelho === undefined) return;
    const antes = anterior.current;
    anterior.current = espelho;
    // Saiu em outra aba: o cookie é o mesmo, então esta aba também não tem mais sessão.
    if (antes && !espelho && rota !== "/login") window.location.assign("/login");
  }, [espelho, rota]);

  useEffect(() => {
    // Sem sessão no servidor fora da entrada (o proxy já deveria ter mandado para lá).
    if (!servidor && rota !== "/login") router.replace("/login");
  }, [servidor, rota, router]);
}

/** Botão do topo e o painel: quem entrou, a empresa em uso (para trocar), Configurações e Sair. */
export function QuemEntrou({ conta }: { conta: ContaDoTopo }) {
  const espelho = useSessao();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [, iniciar] = useTransition();
  const sessao = conta.sessao ?? espelho;
  if (!sessao) return null;
  const ativa = conta.empresas.find((e) => e.id === conta.empresaAtiva);

  const trocar = (id: string) =>
    iniciar(async () => {
      if (id !== conta.empresaAtiva) await trocarEmpresaAtiva(id);
      setAberto(false);
      router.refresh();
    });

  return (
    <>
      {ativa ? (
        <span className={s.empresaNoTopo} aria-hidden="true">
          {ativa.nome}
        </span>
      ) : null}
      <HeaderGlobalAction
        aria-label={`Conta de ${sessao.nome}${ativa ? `, comprando por ${ativa.nome}` : ""}`}
        aria-expanded={aberto}
        aria-controls="painel-conta"
        isActive={aberto}
        tooltipAlignment="end"
        onClick={() => setAberto((a) => !a)}
      >
        <UserAvatar size={20} />
      </HeaderGlobalAction>
      <HeaderPanel expanded={aberto} onHeaderPanelFocus={() => setAberto(false)} className={s.painelConta}>
        <div id="painel-conta">
          <div className={s.painelQuem}>
            <p className={s.painelNome}>{sessao.nome}</p>
            <p className={s.painelApoio}>{sessao.login}</p>
          </div>
          {conta.empresas.length ? <p className={s.painelRotulo}>Empresa em uso</p> : null}
          <Switcher aria-label="Empresa em uso e conta" expanded={aberto}>
            {[
              ...conta.empresas.map((e) => (
                <SwitcherItem
                  key={e.id}
                  aria-label={e.id === conta.empresaAtiva ? `${e.nome}, empresa em uso` : `Comprar por ${e.nome}`}
                  isSelected={e.id === conta.empresaAtiva}
                  href="#"
                  onClick={(ev) => {
                    ev.preventDefault();
                    trocar(e.id);
                  }}
                >
                  {e.nome}
                </SwitcherItem>
              )),
              <SwitcherDivider key="divisor" />,
              <SwitcherItem
                key="config"
                aria-label="Configurações"
                href="/configuracoes"
                onClick={(ev) => {
                  ev.preventDefault();
                  setAberto(false);
                  router.push("/configuracoes");
                }}
              >
                Configurações
              </SwitcherItem>,
              <SwitcherItem
                key="sair"
                aria-label="Sair"
                href="/login"
                onClick={(ev) => {
                  ev.preventDefault();
                  void sair();
                }}
              >
                Sair
              </SwitcherItem>,
            ]}
          </Switcher>
        </div>
      </HeaderPanel>
    </>
  );
}
