"use client";
// Quem é gestor de compras (`usuario.papel`). O gestor recebe os avisos de conduta dos guardrails
// e vê a tela de alertas de conduta. Sem permissão de verdade: qualquer um que entrou marca e desmarca.

import { InlineNotification, Link as CarbonLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Toggle } from "@carbon/react";
import { ArrowRight } from "@carbon/react/icons";
import NextLink from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Bloco } from "@/components/Bloco";
import { listarPessoas, marcarGestor, type Pessoa } from "@/lib/equipe";
import { useSessao } from "./sessao";

export function Gestores() {
  const sessao = useSessao();
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const carregar = () =>
    listarPessoas()
      .then(setPessoas)
      .catch(() => setPessoas([]));

  useEffect(() => {
    carregar();
  }, []);

  const trocar = (p: Pessoa, gestor: boolean) =>
    iniciar(async () => {
      setErro(null);
      const r = await marcarGestor(p.id, gestor);
      if (!r.ok) setErro(r.erro ?? "Não deu certo.");
      await carregar();
    });

  return (
    <Bloco
      titulo="Gestores de compras"
      descricao="O gestor recebe os avisos de conduta: pedidos barrados pelos guardrails e fornecedores que ofereceram propina, venda sem nota ou pagamento por fora."
      acao={
        <CarbonLink as={NextLink} href="/conduta" renderIcon={ArrowRight}>
          Ver alertas de conduta
        </CarbonLink>
      }
      plano
    >
      {pessoas === null ? (
        <p>Carregando…</p>
      ) : (
        <Table size="md" aria-label="Gestores de compras">
          <TableHead>
            <TableRow>
              <TableHeader>Nome</TableHeader>
              <TableHeader>Usuário</TableHeader>
              <TableHeader>Gestor de compras</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {pessoas.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {p.nome}
                  {sessao?.id === p.id ? " (você)" : ""}
                </TableCell>
                <TableCell>{p.login}</TableCell>
                <TableCell>
                  <Toggle
                    id={`gestor-${p.id}`}
                    size="sm"
                    labelText={`${p.nome} é gestor de compras`}
                    hideLabel
                    labelA="Não"
                    labelB="Sim"
                    toggled={p.papel === "gestor"}
                    disabled={pendente}
                    onToggle={(v) => trocar(p, v)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {erro ? <InlineNotification kind="error" lowContrast title="Não deu certo." subtitle={erro} onCloseButtonClick={() => setErro(null)} /> : null}
    </Bloco>
  );
}
