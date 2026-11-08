"use client";

import {
  Button,
  Column,
  Layer,
  Modal,
  RadioTile,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  TileGroup,
} from "@carbon/react";
import { UserFollow } from "@carbon/react/icons";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Bloco } from "@/components/Bloco";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { AvisoDemonstracao, AvisoFeito, CabecalhoConta, plural, useFeito } from "./Comum";
import { CONTA_EXEMPLO, EMPRESAS, PAPEIS, emailDeExemplo, useConta } from "./demo";
import s from "./conta.module.scss";

type PropsConvite = {
  nomeEmpresa: string;
  /** Quem já é usuário ou já foi convidado nesta empresa. */
  emailsComAcesso: string[];
  aoEnviar: (email: string, papel: string) => void;
  aoFechar: () => void;
};

/** Convite de demonstração: nada é enviado, e só aceita e-mail fictício. */
function ModalConvite({ nomeEmpresa, emailsComAcesso, aoEnviar, aoFechar }: PropsConvite) {
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState(PAPEIS[0]);
  const [erro, setErro] = useState("");

  function enviar(evento: SyntheticEvent<HTMLElement>) {
    // Enviado pelo Enter, o foco volta ao botão de convidar: sem isto, o mesmo Enter o aciona e o modal reabre.
    evento.preventDefault();
    const limpo = email.trim();
    const problema = !emailDeExemplo(limpo)
      ? "Na demonstração, use um e-mail terminado em .exemplo."
      : emailsComAcesso.some((e) => e.toLowerCase() === limpo.toLowerCase())
        ? "Este e-mail já tem acesso a esta empresa."
        : "";
    if (problema) {
      setErro(problema);
      document.getElementById("convite-email")?.focus();
      return;
    }
    aoEnviar(limpo, papel);
  }

  return (
    <Modal
      open
      size="sm"
      modalLabel={nomeEmpresa}
      modalHeading="Convidar usuário"
      primaryButtonText="Convidar"
      secondaryButtonText="Cancelar"
      closeButtonLabel="Fechar"
      preventCloseOnClickOutside
      shouldSubmitOnEnter
      selectorPrimaryFocus="#convite-email"
      onRequestClose={aoFechar}
      onRequestSubmit={enviar}
    >
      <Stack gap={5}>
        <TextInput
          id="convite-email"
          labelText="E-mail"
          placeholder="nome@empresa.exemplo"
          helperText="Demonstração: nenhum convite é enviado."
          value={email}
          invalid={!!erro}
          invalidText={erro}
          onChange={(e) => {
            setEmail(e.target.value);
            setErro("");
          }}
        />
        <Select id="convite-papel" labelText="Papel" value={papel} onChange={(e) => setPapel(e.target.value)}>
          {PAPEIS.map((p) => (
            <SelectItem key={p} value={p} text={p} />
          ))}
        </Select>
      </Stack>
    </Modal>
  );
}

export function Empresas() {
  const { empresa, convites, todosConvites, todosLocais, trocarEmpresa, convidar } = useConta();
  const [convidando, setConvidando] = useState(false);
  const { feito, confirmar, limpar } = useFeito();
  const botaoConvidar = useRef<HTMLButtonElement>(null);
  const estavaAberto = useRef(false);

  // Fechado de qualquer jeito, o foco volta ao botão. O modal é montado só quando abre.
  useEffect(() => {
    if (estavaAberto.current && !convidando) botaoConvidar.current?.focus();
    estavaAberto.current = convidando;
  }, [convidando]);

  function locaisDe(id: string) {
    const locais = todosLocais.filter((l) => l.empresaId === id);
    return locais.length ? locais.map((l) => l.apelido).join(", ") : "Nenhum local de entrega ainda";
  }

  return (
    <Pagina>
      <CabecalhoConta ativa="empresas" />
      <CorpoPagina>
        <AvisoDemonstracao />
        <AvisoFeito feito={feito} aoFechar={limpar} />
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo="Em qual empresa você compra" descricao="A empresa em uso define os endereços e o faturamento.">
              <TileGroup
                legend="Empresa em uso"
                name="empresa"
                valueSelected={empresa.id}
                onChange={(v) => {
                  trocarEmpresa(String(v));
                  limpar();
                }}
                className={s.empresas}
              >
                {EMPRESAS.map((e) => {
                  const pessoas = e.usuarios.length + todosConvites.filter((c) => c.empresaId === e.id).length;
                  return (
                    <RadioTile key={e.id} id={`empresa-${e.id}`} value={e.id}>
                      <span className={s.empresa}>
                        <span className={s.empresaNome}>{e.nome}</span>
                        <span className={s.apoioLinha}>CNPJ (fictício) {e.cnpj}</span>
                        <span className={s.apoioLinha}>{locaisDe(e.id)}</span>
                        <span className={s.empresaContagem}>{plural(pessoas, "usuário", "usuários")}</span>
                      </span>
                    </RadioTile>
                  );
                })}
              </TileGroup>
            </Bloco>
          </Column>
        </GradePagina>

        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo={`Quem acessa ${empresa.nome}`}
              acao={
                <Button ref={botaoConvidar} kind="tertiary" size="md" renderIcon={UserFollow} onClick={() => setConvidando(true)}>
                  Convidar usuário
                </Button>
              }
            >
              <Layer level={0}>
                <Table aria-label={`Usuários de ${empresa.nome}`} size="lg" className={s.tabelaUsuarios}>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Pessoa</TableHeader>
                      <TableHeader>Papel</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {empresa.usuarios.map((u) => (
                      <TableRow key={u.email}>
                        <TableCell>
                          <span className={s.pessoa}>
                            <span className={s.pessoaNome}>
                              {u.nome}
                              {u.email === CONTA_EXEMPLO.email ? <span className={s.voce}>você</span> : null}
                            </span>
                            <span className={s.apoioLinha}>{u.email}</span>
                          </span>
                        </TableCell>
                        <TableCell>{u.papel}</TableCell>
                      </TableRow>
                    ))}
                    {convites.map((c) => (
                      <TableRow key={c.email}>
                        <TableCell>
                          <span className={s.pessoa}>
                            <span className={s.pessoaNome}>{c.email}</span>
                            <Tag as="span" type="gray" size="sm">
                              convite de demonstração
                            </Tag>
                          </span>
                        </TableCell>
                        <TableCell>{c.papel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Layer>
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>

      {convidando ? (
        <ModalConvite
          nomeEmpresa={empresa.nome}
          emailsComAcesso={[...empresa.usuarios.map((u) => u.email), ...convites.map((c) => c.email)]}
          aoFechar={() => setConvidando(false)}
          aoEnviar={(email, papel) => {
            convidar({ email, papel, empresaId: empresa.id });
            setConvidando(false);
            confirmar("Convite registrado na demonstração.", "Nada foi enviado.");
          }}
        />
      ) : null}
    </Pagina>
  );
}
