"use client";

import { Button, Column, Modal, OverflowMenu, OverflowMenuItem, Stack, TextInput, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { Add } from "@carbon/react/icons";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarraAcao } from "@/components/BarraAcao";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { AvisoDemonstracao, AvisoFeito, CabecalhoConta, Campo, useFeito } from "./Comum";
import { cepValido, formatarCep, useConta, type LocalEntrega } from "./demo";
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
  aoSalvar: (v: Valores) => void;
  aoFechar: () => void;
};

/** Novo local ou correção. O erro fica no campo, e nada do que foi digitado se perde. */
function FormLocal({ inicial, editando, aoSalvar, aoFechar }: PropsForm) {
  const [v, setV] = useState<Valores>(inicial);
  const [erros, setErros] = useState<Erros>({});

  function salvar() {
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
      primaryButtonText="Salvar local"
      secondaryButtonText="Cancelar"
      closeButtonLabel="Fechar"
      preventCloseOnClickOutside
      shouldSubmitOnEnter
      selectorPrimaryFocus="#local-apelido"
      onRequestClose={aoFechar}
      onRequestSubmit={salvar}
    >
      <Stack gap={5}>
        <p className={s.apoioLinha}>Demonstração: o local fica só neste navegador.</p>
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

function LinhaLocal({ local, aoTornarPadrao, aoCorrigir, aoRemover }: { local: LocalEntrega; aoTornarPadrao: () => void; aoCorrigir: () => void; aoRemover: () => void }) {
  return (
    <li className={s.local}>
      <div className={s.localNome}>
        <h3 id={idTitulo(local.id)} tabIndex={-1} className={s.localApelido}>
          {local.apelido}
        </h3>
        <p className={s.localEndereco}>{local.endereco}</p>
        <p className={s.localEndereco}>CEP {local.cep}</p>
      </div>
      <dl className={s.camposLocal}>
        <Campo rotulo="Janela de recebimento">{local.janela || "A confirmar"}</Campo>
        <Campo rotulo="Restrição de acesso">{local.restricao || "Sem restrição anotada"}</Campo>
      </dl>
      {/* A marca de padrão ocupa a vaga do botão: trocar o padrão não muda a altura de nenhuma linha. */}
      <div className={s.localAcoes}>
        {local.padrao ? (
          <span id={idMarca(local.id)} tabIndex={-1} className={s.marcaPadrao}>
            <IconIndicator kind="succeeded" label="Padrão" size={16} />
          </span>
        ) : (
          <Button kind="ghost" size="sm" className={s.tornarPadrao} onClick={aoTornarPadrao}>
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

type Formulario = { local: LocalEntrega | null };

export function Enderecos() {
  const { empresa, locais, guardarLocais } = useConta();
  const [form, setForm] = useState<Formulario | null>(null);
  const [removendo, setRemovendo] = useState<LocalEntrega | null>(null);
  const { feito, confirmar, limpar } = useFeito();
  const [foco, setFoco] = useState<string | null>(null);
  const params = useSearchParams();
  const pedidoNovo = useRef(params.get("novo") === "1");

  // Vindo de "Adicionar local", na visão geral: já abre o formulário.
  useEffect(() => {
    if (!pedidoNovo.current) return;
    pedidoNovo.current = false;
    setForm({ local: null });
  }, []);

  // O botão clicado pode ter sumido: o foco vai para a linha que mudou.
  useEffect(() => {
    if (!foco) return;
    (foco === BOTAO_ABRIR ? botaoAbrirVisivel() : document.getElementById(foco))?.focus();
    setFoco(null);
  }, [foco]);

  function salvar(v: Valores) {
    const base = { apelido: v.apelido.trim(), endereco: v.endereco.trim(), cep: v.cep, janela: v.janela.trim(), restricao: v.restricao.trim() };
    if (form?.local) {
      const id = form.local.id;
      guardarLocais(locais.map((l) => (l.id === id ? { ...l, ...base } : l)));
      confirmar(`${base.apelido} corrigido.`);
      setFoco(idTitulo(id));
    } else {
      const novo: LocalEntrega = { ...base, id: `l-${crypto.randomUUID()}`, empresaId: empresa.id, padrao: locais.length === 0 };
      guardarLocais([...locais, novo]);
      confirmar(`${base.apelido} entrou na lista.`);
      setFoco(idTitulo(novo.id));
    }
    setForm(null);
  }

  function tornarPadrao(id: string) {
    guardarLocais(locais.map((l) => ({ ...l, padrao: l.id === id })));
    confirmar(`${locais.find((l) => l.id === id)?.apelido ?? "O local"} agora é o local padrão.`);
    setFoco(idMarca(id));
  }

  function remover(local: LocalEntrega) {
    const restantes = locais.filter((l) => l.id !== local.id);
    const herdeiro = local.padrao ? restantes[0] : undefined;
    guardarLocais(restantes.map((l) => (herdeiro && l.id === herdeiro.id ? { ...l, padrao: true } : l)));
    confirmar(`${local.apelido} saiu da lista.`, herdeiro ? `${herdeiro.apelido} passou a ser o padrão.` : undefined);
    setFoco(restantes[0] ? idTitulo(restantes[0].id) : BOTAO_ABRIR);
    setRemovendo(null);
  }

  /** Desistiu: o foco volta a quem abriu. */
  function fecharForm() {
    setFoco(form?.local ? idMenu(form.local.id) : BOTAO_ABRIR);
    setForm(null);
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
        <AvisoDemonstracao />
        <AvisoFeito feito={feito} aoFechar={limpar} />
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo={locais.length ? frase(locais.length) : "Onde você pode receber"} descricao="O local que recebe é o destino da cotação. O frete é calculado até o CEP dele.">
              {locais.length ? (
                <ul className={s.locais}>
                  {locais.map((l) => (
                    <LinhaLocal key={l.id} local={l} aoTornarPadrao={() => tornarPadrao(l.id)} aoCorrigir={() => setForm({ local: l })} aoRemover={() => setRemovendo(l)} />
                  ))}
                </ul>
              ) : (
                <div data-abrir-local>
                  <EstadoVazio headingAs="h3" titulo="Nenhum local de entrega ainda." proximoPasso={`Cadastre onde ${empresa.nome} recebe.`} acao={{ texto: "Adicionar local", aoClicar: abrirNovo }} />
                </div>
              )}
            </Bloco>
          </Column>
        </GradePagina>

        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo="Endereço de faturamento" descricao="Fica separado do local que recebe. Não vira destino nem entra na conta do frete.">
              <dl className={s.camposFatura}>
                <Campo rotulo="Razão social">{empresa.faturamento.razaoSocial}</Campo>
                <Campo rotulo="Endereço">{empresa.faturamento.endereco}</Campo>
                <Campo rotulo="CEP">{empresa.faturamento.cep}</Campo>
                <Campo rotulo="CNPJ (fictício)">{empresa.cnpj}</Campo>
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
          inicial={form.local ? { apelido: form.local.apelido, endereco: form.local.endereco, cep: form.local.cep, janela: form.local.janela, restricao: form.local.restricao } : VAZIO}
          editando={!!form.local}
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
          primaryButtonText="Sim, remover"
          secondaryButtonText="Cancelar"
          closeButtonLabel="Fechar"
          preventCloseOnClickOutside
          onRequestClose={fecharRemover}
          onRequestSubmit={() => remover(removendo)}
        >
          <p>Se precisar dele de novo, é só cadastrar.</p>
        </Modal>
      ) : null}
    </Pagina>
  );
}
