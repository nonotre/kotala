"use client";

import { Button, Form, InlineLoading, Select, SelectItem, Stack, TextInput } from "@carbon/react";
import { Chat, DocumentTasks, UserCertification } from "@carbon/react/icons";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Pagina } from "@/components/Pagina";
import { SeloDemonstracao } from "./Comum";
import { CONTA_EXEMPLO, EMPRESAS, useConta } from "./demo";
import s from "./entrar.module.scss";

const ESPERA_ENTRAR_MS = 700;

const PASSOS = [
  { icone: Chat, titulo: "Peça em uma mensagem.", texto: "O assistente entende o item, a quantidade e o prazo, no Telegram ou no navegador." },
  { icone: DocumentTasks, titulo: "Compare as propostas.", texto: "Cada fornecedor com o custo total, o frete e o prazo." },
  { icone: UserCertification, titulo: "Quem aprova é você.", texto: "A IA não fecha compra sozinha." },
];

/** Entrar, em demonstração: nada é verificado nem salvo no servidor, e nada no app depende desta tela. */
export function Entrar() {
  const router = useRouter();
  const { empresa, trocarEmpresa } = useConta();
  const [entrando, setEntrando] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (espera.current) clearTimeout(espera.current);
    },
    [],
  );

  function entrar() {
    if (entrando) return;
    setEntrando(true);
    espera.current = setTimeout(() => router.push("/"), ESPERA_ENTRAR_MS);
  }

  return (
    <Pagina>
      <div className={s.tela}>
        <section className={s.formulario}>
          <Form
            className={s.miolo}
            onSubmit={(e) => {
              e.preventDefault();
              entrar();
            }}
          >
            <Stack gap={6}>
              <div className={s.topo}>
                <div>
                  <SeloDemonstracao />
                </div>
                <h1 className={s.titulo}>Entrar</h1>
                <p className={s.frase}>O kotala ainda não tem login: esta tela é uma demonstração. Nada é verificado e nenhum dado sai deste navegador.</p>
              </div>
              <Stack gap={5}>
                <TextInput id="entrar-email" labelText="E-mail" value={CONTA_EXEMPLO.email} readOnly helperText="Conta de exemplo, sem senha." />
                <Select id="entrar-empresa" labelText="Empresa" value={empresa.id} onChange={(e) => trocarEmpresa(e.target.value)}>
                  {EMPRESAS.map((e) => (
                    <SelectItem key={e.id} value={e.id} text={e.nome} />
                  ))}
                </Select>
              </Stack>
              <div className={s.acoes}>
                {entrando ? (
                  <div className={s.entrando}>
                    <InlineLoading status="active" description="Entrando" iconDescription="Carregando" />
                  </div>
                ) : (
                  <>
                    <Button type="submit">Entrar</Button>
                    <Button as={NextLink} href="/" kind="ghost">
                      Continuar sem entrar
                    </Button>
                  </>
                )}
              </div>
            </Stack>
          </Form>
        </section>

        <aside className={`cds--g100 ${s.painel}`} aria-label="O que o Kotala faz">
          <div className={s.painelMiolo}>
            <img src="/logo-branco.svg" alt="Kotala" className={s.logo} />
            <p className={s.promessa}>Da mensagem da obra à compra aprovada.</p>
            <ul className={s.passos}>
              {PASSOS.map(({ icone: Icone, titulo, texto }) => (
                <li key={titulo} className={s.passo}>
                  <Icone size={24} className={s.passoIcone} aria-hidden="true" />
                  <div>
                    <p className={s.passoTitulo}>{titulo}</p>
                    <p className={s.passoTexto}>{texto}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </Pagina>
  );
}
