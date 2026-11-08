"use client";

import { CheckmarkOutline, CircleDash, Incomplete, Warning } from "@carbon/react/icons";
import NextLink from "next/link";
import type { EtapaId } from "./rotas";
import type { Etapa } from "./textos";
import s from "./pedido.module.scss";

const TEXTO_ESTADO: Record<Etapa["estado"], string> = { concluida: "Concluída", atual: "Etapa atual", futura: "Ainda não" };

/** Ícone e cor dizem o andamento; o texto escondido diz o mesmo ao leitor de tela. */
function IconeEtapa({ e }: { e: Etapa }) {
  const Icone = e.invalida ? Warning : e.estado === "concluida" ? CheckmarkOutline : e.estado === "atual" ? Incomplete : CircleDash;
  return <Icone size={16} className={s.etapaIcone} aria-hidden="true" />;
}

function ConteudoEtapa({ e }: { e: Etapa }) {
  return (
    <>
      <IconeEtapa e={e} />
      <span className={s.etapaTexto}>
        <span className={s.etapaRotulo}>{e.rotulo}</span>
        <span className={s.somenteLeitor}>, {e.invalida ? "cancelada aqui" : TEXTO_ESTADO[e.estado].toLowerCase()}. </span>
        <span className={s.etapaApoio}>{e.apoio}</span>
      </span>
    </>
  );
}

/**
 * As 4 etapas da compra: o progresso e a navegação ao mesmo tempo.
 * Concluída e atual levam às suas telas; futura sem conteúdo fica como texto, com o motivo à vista.
 * A etapa aberta tem `aria-current="page"` e o nome em negrito, além do fundo.
 */
export function EtapasCompra({ etapas, aberta }: { etapas: Etapa[]; aberta: EtapaId | null }) {
  return (
    <nav aria-label="Etapas da compra" className={s.etapas}>
      <ol className={s.etapasLista}>
        {etapas.map((e) => {
          const atributos = { "data-estado": e.invalida ? "invalida" : e.estado, "data-aberta": e.id === aberta ? "" : undefined };
          return (
            <li key={e.id} className={s.etapaItem}>
              {e.desabilitada ? (
                <span className={`${s.etapa} ${s.etapaDesabilitada}`} {...atributos}>
                  <ConteudoEtapa e={e} />
                </span>
              ) : (
                <NextLink href={e.href} className={s.etapa} aria-current={e.id === aberta ? "page" : undefined} {...atributos}>
                  <ConteudoEtapa e={e} />
                </NextLink>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
