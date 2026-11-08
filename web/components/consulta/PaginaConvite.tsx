"use client";
// Convite do fornecedor: QR e link do bot, para a banca virar fornecedor pelo celular.

import { Column, ListItem, OrderedList } from "@carbon/react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LinkExterno } from "@/components/LinkExterno";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import s from "./consulta.module.scss";

/** `svg` é o QR já desenhado no servidor, a partir do link. */
export function PaginaConvite({ link, svg }: { link: string | null; svg: string | null }) {
  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Seja um fornecedor"
        contexto="Aponte a câmera do celular para o código. Você entra no bot do fornecedor, informa o nome da empresa e passa a receber as solicitações de proposta. Responda do seu jeito: texto, áudio, foto ou PDF."
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            {svg && link ? (
              <Bloco titulo="Código do convite">
                <div className={s.convite}>
                  <div className={s.qrCodigo} role="img" aria-label={`Código QR para ${link}`} dangerouslySetInnerHTML={{ __html: svg }} />
                  <div className={s.conviteTexto}>
                    <p className={s.conviteLink}>{link.replace("https://", "")}</p>
                    <LinkExterno href={link}>Abrir o link</LinkExterno>
                    <div>
                      <h3 className={s.subtitulo}>O que acontece</h3>
                      <OrderedList className={s.passos}>
                        <ListItem>O fornecedor lê o QR ou abre o link e entra no bot do fornecedor.</ListItem>
                        <ListItem>Informa o nome da empresa.</ListItem>
                        <ListItem>Passa a receber as solicitações de proposta e responde do jeito dele.</ListItem>
                      </OrderedList>
                    </div>
                    <p className={s.apoioCorpo}>É uma demonstração: a empresa compradora é fictícia e nenhuma compra é feita sem aprovação do comprador.</p>
                  </div>
                </div>
              </Bloco>
            ) : (
              <Bloco titulo="Código do convite">
                <EstadoVazio compacto titulo="O bot do fornecedor não está configurado (falta TELEGRAM_TOKEN_FORNECEDOR) ou o Telegram não respondeu." />
              </Bloco>
            )}
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
