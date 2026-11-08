"use client";
// Locais de entrega da empresa em uso (E8), no banco (local_entrega). O padrão é o destino quando o
// pedido não diz onde entregar. As ações (lib/contas.ts) agem sempre na empresa ativa de quem entrou.

import {
  Button,
  Column,
  InlineNotification,
  Link as CarbonLink,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  Stack,
  TextInput,
  preview__IconIndicator as IconIndicator,
} from "@carbon/react";
import { Add, ArrowRight } from "@carbon/react/icons";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BarraAcao } from "@/components/BarraAcao";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { removerLocal, salvarLocal, tornarLocalPadrao, type ContaCompleta, type Local } from "@/lib/contas";
import { AvisoErro, AvisoFeito, CabecalhoConta, Campo, cepValido, daEmpresaAtiva, formatarCep, ouAConfirmar, useFeito } from "./Comum";
import s from "./conta.module.scss";

// ---------- Formulário ----------

type Valores = { apelido: string; endereco: string; cep: string; janela: string; restricao: string };
type Erros = Partial<Record<keyof Valores, string>>;

const VAZIO: Valores = { apelido: "", endereco: "", cep: "", janela: "", restricao: "" };

function validar(v: Valores): Erros {
  const erros: Erros = {};
  if (!v.apelido.trim()) erros.apelido = "Diga como o local é chamado.";
  if (!v.endereco.trim()) erros.endereco = "Falta o endereço, com número e cidade.";
  if (!cepValido(v.cep)) erros.cep = "Digite os 8 números do CEP, como 00000-000.";
  return erros;
}

type PropsForm = {
  inicial: Valores;
  editando: boolean;
  salvando: boolean;
  /** O servidor recusou: o formulário fica aberto, com o que foi digitado. */
  erroServidor: string | null;
  aoSalvar: (v: Valores) => void;
  aoFechar: () => void;
};

/** Novo local ou correção. O erro fica no campo, e nada do que foi digitado se perde. */
function FormLocal({ inicial, editando, salvando, erroServidor, aoSalvar, aoFechar }: PropsForm) {
  const [v, setV] = useState<Valores>(inicial);
  const [erros, setErros] = useState<Erros>({});

  function salvar() {
    if (salvando) return;
    const novos = validar(v);
    setErros(novos);
    const primeiro = (Object.keys(VAZIO) as (keyof Valores)[]).find((k) => novos[k]);
    if (primeiro) {
      document.getElementById(`local-${primeiro}`)?.focus();
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
      modalLabel="Onde você recebe"
      modalHeading={editando ? "Corrigir local" : "Adicionar local"}
      primaryButtonText={salvando ? "Salvando…" : "Salvar local"}
      primaryButtonDisabled={salvando}
      secondaryButtonText="Cancelar"
      closeButtonLabel="Fechar"
      preventCloseOnClickOutside
      shouldSubmitOnEnter
      selectorPrimaryFocus="#local-apelido"
      onRequestClose={aoFechar}
      onRequestSubmit={salvar}
    >
      <Stack gap={5}>
        {erroServidor ? <InlineNotification kind="error" lowContrast hideCloseButton title={erroServidor} /> : null}
        <TextInput
          id="local-apelido"
          labelText="Nome do local"
          placeholder="Depósito Centro"
          value={v.apelido}
          invalid={!!erros.apelido}
          invalidText={erros.apelido}
          onChange={(e) => mudar("apelido", e.target.value)}
        />
        <TextInput
          id="local-endereco"
          labelText="Endereço"
          placeholder="Rua de Exemplo, 500, Cidade Exemplo"
          value={v.endereco}
          invalid={!!erros.endereco}
          invalidText={erros.endereco}
          onChange={(e) => mudar("endereco", e.target.value)}
        />
        <TextInput
          id="local-cep"
          labelText="CEP"
          placeholder="00000-000"
          inputMode="numeric"
          helperText="O frete é calculado até este CEP."
          value={v.cep}
          invalid={!!erros.cep}
          invalidText={erros.cep}
          onChange={(e) => mudar("cep", formatarCep(e.target.value))}
          onBlur={() => {
            if (v.cep && !cepValido(v.cep)) setErros((atual) => ({ ...atual, cep: validar(v).cep }));
          }}
        />
        <TextInput
          id="local-janela"
          labelText="Janela de recebimento (opcional)"
          placeholder="Segunda a sexta, das 7h às 16h"
          helperText="Vai junto no pedido quando ele não diz outra."
          value={v.janela}
          onChange={(e) => mudar("janela", e.target.value)}
        />
        <TextInput
          id="local-restricao"
          labelText="Restrição de acesso (opcional)"
          placeholder="Rua estreita: só caminhão pequeno"
          value={v.restricao}
          onChange={(e) => mudar("restricao", e.target.value)}
        />
      </Stack>
    </Modal>
  );
}

// ---------- Linha ----------

const idTitulo = (id: string) => `local-${id}-titulo`;
const idMarca = (id: string) => `local-${id}-marca`;
const idMenu = (id: string) => `local-${id}-menu`;
/** Alvo de foco: o botão de abrir o formulário que estiver à vista, no topo, na barra do pé ou no estado vazio. */
const BOTAO_ABRIR = "botao-abrir-local";

function botaoAbrirVisivel() {
  const botoes = document.querySelectorAll<HTMLElement>("button[data-abrir-local], [data-abrir-local] button");
  return Array.from(botoes).find((b) => b.getClientRects().length > 0);
}

type PropsLinha = { local: Local; ocupado: boolean; aoTornarPadrao: () => void; aoCorrigir: () => void; aoRemover: () => void };

function LinhaLocal({ local, ocupado, aoTornarPadrao, aoCorrigir, aoRemover }: PropsLinha) {
  return (
    <li className={s.local}>
      <div className={s.localNome}>
        <h3 id={idTitulo(local.id)} tabIndex={-1} className={s.localApelido}>
          {local.apelido}
        </h3>
        <p className={s.localEndereco}>{local.endereco}</p>
        <p className={s.localEndereco}>{local.cep ? `CEP ${local.cep}` : "CEP a confirmar"}</p>
      </div>
      <dl className={s.camposLocal}>
        <Campo rotulo="Janela de recebimento">{ouAConfirmar(local.janelaRecebimento)}</Campo>
        <Campo rotulo="Restrição de acesso">{ouAConfirmar(local.restricao, "Sem restrição anotada")}</Campo>
      </dl>
      {/* A marca de padrão ocupa a vaga do botão: trocar o padrão não muda a altura de nenhuma linha. */}
      <div className={s.localAcoes}>
        {local.padrao ? (
          <span id={idMarca(local.id)} tabIndex={-1} className={s.marcaPadrao}>
            <IconIndicator kind="succeeded" label="Padrão" size={16} />
          </span>
        ) : (
          <Button kind="ghost" size="sm" className={s.tornarPadrao} onClick={aoTornarPadrao} disabled={ocupado}>
            Tornar padrão
          </Button>
        )}
        <OverflowMenu id={idMenu(local.id)} aria-label={`Mais ações de ${local.apelido}`} iconDescription={`Mais ações de ${local.apelido}`} size="sm" flipped>
          <OverflowMenuItem itemText="Corrigir" onClick={aoCorrigir} />
          <OverflowMenuItem itemText="Remover" hasDivider isDelete onClick={aoRemover} />
        </OverflowMenu>
      </div>
    </li>
  );
}

// ---------- Tela ----------

function frase(n: number) {
  return n === 1 ? "1 local pode receber as suas compras" : `${n} locais podem receber as suas compras`;
}

type Formulario = { local: Local | null };

export function Enderecos({ conta }: { conta: ContaCompleta }) {
  const { empresa, locais } = daEmpresaAtiva(conta);
  const [form, setForm] = useState<Formulario | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<Local | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { feito, confirmar, limpar } = useFeito();
  const [foco, setFoco] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const params = useSearchParams();
  const pedidoNovo = useRef(params.get("novo") === "1");

  // Vindo de "Adicionar local", na visão geral: já abre o formulário.
  useEffect(() => {
    if (!pedidoNovo.current) return;
    pedidoNovo.current = false;
    setForm({ local: null });
  }, []);

  // O botão clicado pode ter sumido: o foco vai para a linha que mudou. A lista nova chega do servidor
  // depois da ação, então tenta de novo quando ela muda.
  useEffect(() => {
    if (!foco) return;
    const alvo = foco === BOTAO_ABRIR ? botaoAbrirVisivel() : document.getElementById(foco);
    if (!alvo) return;
    alvo.focus();
    setFoco(null);
  }, [foco, locais]);

  function salvar(v: Valores) {
    const dados = { apelido: v.apelido, endereco: v.endereco, cep: v.cep, janelaRecebimento: v.janela || null, restricao: v.restricao || null };
    const id = form?.local?.id;
    iniciar(async () => {
      setErroForm(null);
      const r = await salvarLocal(dados, id).catch(() => ({ ok: false as const, erro: "Não deu para salvar agora. Tente de novo." }));
      if (!r.ok) {
        setErroForm(r.erro);
        return;
      }
      confirmar(id ? `${r.local.apelido} corrigido.` : `${r.local.apelido} entrou na lista.`, r.local.padrao && !id ? "É o local padrão da empresa." : undefined);
      setFoco(idTitulo(r.local.id));
      setForm(null);
    });
  }

  function tornarPadrao(l: Local) {
    iniciar(async () => {
      setErro(null);
      const r = await tornarLocalPadrao(l.id).catch(() => ({ ok: false as const, erro: "Não deu para trocar o padrão agora." }));
      if (!r.ok) return setErro(r.erro);
      confirmar(`${l.apelido} agora é o local padrão.`, "Os pedidos sem destino vão para ele.");
      setFoco(idMarca(l.id));
    });
  }

  function remover(local: Local) {
    iniciar(async () => {
      setErro(null);
      const r = await removerLocal(local.id).catch(() => ({ ok: false as const, erro: "Não deu para remover agora." }));
      setRemovendo(null);
      if (!r.ok) return setErro(r.erro);
      confirmar(`${local.apelido} saiu da lista.`, r.herdeiro ? `${r.herdeiro.apelido} passou a ser o padrão.` : undefined);
      const restantes = locais.filter((l) => l.id !== local.id);
      setFoco(restantes[0] ? idTitulo(restantes[0].id) : BOTAO_ABRIR);
    });
  }

  /** Desistiu: o foco volta a quem abriu. */
  function fecharForm() {
    setFoco(form?.local ? idMenu(form.local.id) : BOTAO_ABRIR);
    setForm(null);
    setErroForm(null);
  }

  function fecharRemover() {
    if (removendo) setFoco(idMenu(removendo.id));
    setRemovendo(null);
  }

  const abrirNovo = () => setForm({ local: null });

  return (
    <Pagina>
      <CabecalhoConta
        ativa="enderecos"
        lado={
          locais.length ? (
            <span className={s.acaoTopo}>
              <Button renderIcon={Add} data-abrir-local onClick={abrirNovo}>
                Adicionar local
              </Button>
            </span>
          ) : undefined
        }
      />
      <CorpoPagina>
        <AvisoFeito feito={feito} aoFechar={limpar} />
        <AvisoErro erro={erro} aoFechar={() => setErro(null)} />
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo={locais.length ? frase(locais.length) : "Onde você pode receber"}
              descricao={`Locais de ${empresa.nome}. O padrão é o destino da cotação quando o pedido não diz outro; o frete é calculado até o CEP dele.`}
            >
              {locais.length ? (
                <ul className={s.locais}>
                  {locais.map((l) => (
                    <LinhaLocal key={l.id} local={l} ocupado={ocupado} aoTornarPadrao={() => tornarPadrao(l)} aoCorrigir={() => setForm({ local: l })} aoRemover={() => setRemovendo(l)} />
                  ))}
                </ul>
              ) : (
                <div data-abrir-local>
                  <EstadoVazio
                    headingAs="h3"
                    titulo="Nenhum local de entrega ainda."
                    proximoPasso={`Cadastre onde ${empresa.nome} recebe. Até lá, vale o endereço padrão do servidor.`}
                    acao={{ texto: "Adicionar local", aoClicar: abrirNovo }}
                  />
                </div>
              )}
            </Bloco>
          </Column>
        </GradePagina>

        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Endereço de faturamento"
              descricao="Fica separado do local que recebe. Não vira destino nem entra na conta do frete."
              acao={
                <CarbonLink as={NextLink} href="/configuracoes/empresas" renderIcon={ArrowRight}>
                  Corrigir em Empresas
                </CarbonLink>
              }
            >
              <dl className={s.camposFatura}>
                <Campo rotulo="Razão social">{ouAConfirmar(empresa.razaoSocial)}</Campo>
                <Campo rotulo="Endereço">{ouAConfirmar(empresa.enderecoFaturamento)}</Campo>
                <Campo rotulo="CEP">{ouAConfirmar(empresa.cepFaturamento)}</Campo>
                <Campo rotulo="CNPJ">{ouAConfirmar(empresa.cnpj)}</Campo>
              </dl>
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>

      {locais.length ? (
        <BarraAcao>
          <Button size="lg" renderIcon={Add} data-abrir-local onClick={abrirNovo}>
            Adicionar local
          </Button>
        </BarraAcao>
      ) : null}

      {form ? (
        <FormLocal
          key={form.local?.id ?? "novo"}
          inicial={
            form.local
              ? { apelido: form.local.apelido, endereco: form.local.endereco, cep: form.local.cep ?? "", janela: form.local.janelaRecebimento ?? "", restricao: form.local.restricao ?? "" }
              : VAZIO
          }
          editando={!!form.local}
          salvando={ocupado}
          erroServidor={erroForm}
          aoSalvar={salvar}
          aoFechar={fecharForm}
        />
      ) : null}

      {removendo ? (
        <Modal
          open
          danger
          size="xs"
          modalLabel="Onde você recebe"
          modalHeading={`Remover ${removendo.apelido}?`}
          primaryButtonText={ocupado ? "Removendo…" : "Sim, remover"}
          primaryButtonDisabled={ocupado}
          secondaryButtonText="Cancelar"
          closeButtonLabel="Fechar"
          preventCloseOnClickOutside
          onRequestClose={fecharRemover}
          onRequestSubmit={() => remover(removendo)}
        >
          <p>{removendo.padrao ? "É o local padrão: o mais antigo que sobrar passa a ser o padrão." : "Se precisar dele de novo, é só cadastrar."}</p>
        </Modal>
      ) : null}
    </Pagina>
  );
}
