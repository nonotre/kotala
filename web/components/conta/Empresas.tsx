"use client";
// Empresas compradoras (E4), no banco (empresa). A empresa em uso é a de quem entrou (usuario.empresa_id),
// a mesma do seletor no topo; ela define os locais de entrega e o faturamento.

import {
  Button,
  Column,
  InlineNotification,
  Layer,
  Modal,
  RadioTile,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  TileGroup,
} from "@carbon/react";
import { Add, Edit } from "@carbon/react/icons";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bloco } from "@/components/Bloco";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { salvarEmpresa, trocarEmpresaAtiva, type ContaCompleta, type Empresa } from "@/lib/contas";
import { AvisoErro, AvisoFeito, CabecalhoConta, cepValido, daEmpresaAtiva, formatarCep, ouAConfirmar, plural, useFeito } from "./Comum";
import s from "./conta.module.scss";

type Valores = { nome: string; cnpj: string; razaoSocial: string; enderecoFaturamento: string; cepFaturamento: string };
type Erros = Partial<Record<keyof Valores, string>>;
const VAZIO: Valores = { nome: "", cnpj: "", razaoSocial: "", enderecoFaturamento: "", cepFaturamento: "" };

function validar(v: Valores): Erros {
  const erros: Erros = {};
  if (!v.nome.trim()) erros.nome = "Diga o nome da empresa.";
  if (v.cepFaturamento && !cepValido(v.cepFaturamento)) erros.cepFaturamento = "Digite os 8 números do CEP, como 00000-000.";
  return erros;
}

const valoresDe = (e: Empresa): Valores => ({
  nome: e.nome,
  cnpj: e.cnpj ?? "",
  razaoSocial: e.razaoSocial ?? "",
  enderecoFaturamento: e.enderecoFaturamento ?? "",
  cepFaturamento: e.cepFaturamento ?? "",
});

type PropsForm = { inicial: Valores; editando: boolean; salvando: boolean; erroServidor: string | null; aoSalvar: (v: Valores) => void; aoFechar: () => void };

/** Nova empresa ou correção dos dados de faturamento. */
function FormEmpresa({ inicial, editando, salvando, erroServidor, aoSalvar, aoFechar }: PropsForm) {
  const [v, setV] = useState<Valores>(inicial);
  const [erros, setErros] = useState<Erros>({});

  function salvar() {
    if (salvando) return;
    const novos = validar(v);
    setErros(novos);
    const primeiro = (Object.keys(VAZIO) as (keyof Valores)[]).find((k) => novos[k]);
    if (primeiro) {
      document.getElementById(`empresa-${primeiro}`)?.focus();
      return;
    }
    aoSalvar(v);
  }

  function mudar(campo: keyof Valores, valor: string) {
    setV((atual) => ({ ...atual, [campo]: valor }));
    if (erros[campo]) setErros((atual) => ({ ...atual, [campo]: undefined }));
  }

  return (
    <Modal
      open
      size="sm"
      modalLabel="Empresas"
      modalHeading={editando ? "Corrigir dados da empresa" : "Adicionar empresa"}
      primaryButtonText={salvando ? "Salvando…" : "Salvar empresa"}
      primaryButtonDisabled={salvando}
      secondaryButtonText="Cancelar"
      closeButtonLabel="Fechar"
      preventCloseOnClickOutside
      shouldSubmitOnEnter
      selectorPrimaryFocus="#empresa-nome"
      onRequestClose={aoFechar}
      onRequestSubmit={salvar}
    >
      <Stack gap={5}>
        {erroServidor ? <InlineNotification kind="error" lowContrast hideCloseButton title={erroServidor} /> : null}
        <TextInput id="empresa-nome" labelText="Nome" placeholder="Filial Centro" value={v.nome} invalid={!!erros.nome} invalidText={erros.nome} onChange={(e) => mudar("nome", e.target.value)} />
        <TextInput id="empresa-razaoSocial" labelText="Razão social (opcional)" value={v.razaoSocial} onChange={(e) => mudar("razaoSocial", e.target.value)} />
        <TextInput id="empresa-cnpj" labelText="CNPJ (opcional)" placeholder="00.000.000/0001-00" value={v.cnpj} onChange={(e) => mudar("cnpj", e.target.value)} />
        <TextInput
          id="empresa-enderecoFaturamento"
          labelText="Endereço de faturamento (opcional)"
          helperText="Não vira destino: o destino é o local de entrega."
          value={v.enderecoFaturamento}
          onChange={(e) => mudar("enderecoFaturamento", e.target.value)}
        />
        <TextInput
          id="empresa-cepFaturamento"
          labelText="CEP do faturamento (opcional)"
          placeholder="00000-000"
          inputMode="numeric"
          value={v.cepFaturamento}
          invalid={!!erros.cepFaturamento}
          invalidText={erros.cepFaturamento}
          onChange={(e) => mudar("cepFaturamento", formatarCep(e.target.value))}
        />
      </Stack>
    </Modal>
  );
}

const PAPEL: Record<string, string> = { comprador: "Comprador", gestor: "Gestor de compras" };

export function Empresas({ conta }: { conta: ContaCompleta }) {
  const { empresa, pessoas } = daEmpresaAtiva(conta);
  const [form, setForm] = useState<{ empresa: Empresa | null } | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { feito, confirmar, limpar } = useFeito();
  const [ocupado, iniciar] = useTransition();
  const botaoNovo = useRef<HTMLButtonElement>(null);
  const estavaAberto = useRef(false);

  // Fechado de qualquer jeito, o foco volta ao botão de adicionar. O modal é montado só quando abre.
  useEffect(() => {
    if (estavaAberto.current && !form) botaoNovo.current?.focus();
    estavaAberto.current = !!form;
  }, [form]);

  function locaisDe(id: string) {
    const locais = conta.locais.filter((l) => l.empresaId === id);
    return locais.length ? locais.map((l) => l.apelido).join(", ") : "Nenhum local de entrega ainda";
  }

  function trocar(id: string) {
    if (id === empresa.id) return;
    iniciar(async () => {
      limpar();
      setErro(null);
      const r = await trocarEmpresaAtiva(id).catch(() => ({ ok: false as const, erro: "Não deu para trocar a empresa agora." }));
      if (!r.ok) return setErro(r.erro);
      confirmar(`Agora você compra por ${conta.empresas.find((e) => e.id === id)?.nome ?? "outra empresa"}.`, "Os pedidos sem destino vão para o local padrão dela.");
    });
  }

  function salvar(v: Valores) {
    const editando = form?.empresa ?? null;
    iniciar(async () => {
      setErroForm(null);
      const r = await salvarEmpresa(v, editando?.id).catch(() => ({ ok: false as const, erro: "Não deu para salvar agora. Tente de novo." }));
      if (!r.ok) return setErroForm(r.erro);
      confirmar(editando ? `Dados de ${r.empresa.nome} corrigidos.` : `${r.empresa.nome} entrou na lista.`, editando ? undefined : "Escolha-a acima para comprar por ela.");
      setForm(null);
    });
  }

  return (
    <Pagina>
      <CabecalhoConta
        ativa="empresas"
        lado={
          <span className={s.acaoTopo}>
            <Button ref={botaoNovo} kind="tertiary" renderIcon={Add} onClick={() => setForm({ empresa: null })}>
              Adicionar empresa
            </Button>
          </span>
        }
      />
      <CorpoPagina>
        <AvisoFeito feito={feito} aoFechar={limpar} />
        <AvisoErro erro={erro} aoFechar={() => setErro(null)} />
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo="Em qual empresa você compra" descricao="A empresa em uso define os endereços e o faturamento. Também dá para trocar pelo botão da conta, no topo.">
              <TileGroup legend="Empresa em uso" name="empresa" valueSelected={empresa.id} onChange={(v) => trocar(String(v))} className={s.empresas}>
                {conta.empresas.map((e) => {
                  const n = conta.pessoas.filter((p) => p.empresaId === e.id).length;
                  return (
                    <RadioTile key={e.id} id={`empresa-${e.id}`} value={e.id} disabled={ocupado}>
                      <span className={s.empresa}>
                        <span className={s.empresaNome}>{e.nome}</span>
                        <span className={s.apoioLinha}>CNPJ {ouAConfirmar(e.cnpj)}</span>
                        <span className={s.apoioLinha}>{locaisDe(e.id)}</span>
                        <span className={s.empresaContagem}>{plural(n, "pessoa compra por ela", "pessoas compram por ela")}</span>
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
              titulo={`Quem compra por ${empresa.nome}`}
              descricao="Cada pessoa entra com a própria conta e escolhe a empresa em uso."
              acao={
                <Button kind="ghost" size="md" renderIcon={Edit} onClick={() => setForm({ empresa })}>
                  Corrigir dados da empresa
                </Button>
              }
            >
              {pessoas.length ? (
                <Layer level={0}>
                  <Table aria-label={`Quem compra por ${empresa.nome}`} size="lg" className={s.tabelaUsuarios}>
                    <TableHead>
                      <TableRow>
                        <TableHeader>Pessoa</TableHeader>
                        <TableHeader>Papel</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pessoas.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <span className={s.pessoa}>
                              <span className={s.pessoaNome}>
                                {p.nome}
                                {p.voce ? <span className={s.voce}>você</span> : null}
                              </span>
                              <span className={s.apoioLinha}>{p.login}</span>
                            </span>
                          </TableCell>
                          <TableCell>{PAPEL[p.papel] ?? p.papel}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Layer>
              ) : (
                <p className={s.apoioLinha}>Ninguém compra por esta empresa ainda.</p>
              )}
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>

      {form ? (
        <FormEmpresa
          key={form.empresa?.id ?? "nova"}
          inicial={form.empresa ? valoresDe(form.empresa) : VAZIO}
          editando={!!form.empresa}
          salvando={ocupado}
          erroServidor={erroForm}
          aoSalvar={salvar}
          aoFechar={() => {
            setForm(null);
            setErroForm(null);
          }}
        />
      ) : null}
    </Pagina>
  );
}
