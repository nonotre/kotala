"use client";
// X2: contratos anuais. O preço é negociado no início do período e o vencedor mantém o
// valor até o fim: o item com contrato vigente vai direto ao fornecedor do contrato, sem
// cotar (o comprador confirma em dois toques, ou cota mesmo assim). Aqui: listar, criar, encerrar.

import { Button, Column, ComboBox, InlineNotification, Modal, Select, SelectItem, Stack, Tag, TextArea, TextInput } from "@carbon/react";
import { Add } from "@carbon/react/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bloco } from "@/components/Bloco";
import { useSessao } from "@/components/conta/sessao";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { Tabela } from "@/components/Tabela";
import { brl } from "@/lib/formato";
import { criarContratoNaTela, encerrarContratoNaTela, type FormContrato } from "./acoes";
import type { DadosContratos, OpcaoItem } from "./dados";
import s from "./contratos.module.scss";

type Linha = DadosContratos["contratos"][number];

const SITUACAO: Record<Linha["situacao"], { texto: string; cor: "green" | "blue" | "gray" | "cool-gray" }> = {
  vigente: { texto: "Vigente", cor: "green" },
  agendado: { texto: "Começa depois", cor: "blue" },
  vencido: { texto: "Vencido", cor: "gray" },
  encerrado: { texto: "Encerrado", cor: "cool-gray" },
};

const data = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** "AAAA-MM-DD" no horário de Brasília, para o campo de data. */
const diaIso = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

function formVazio(): FormContrato {
  const hoje = new Date();
  const fim = new Date(hoje);
  fim.setFullYear(fim.getFullYear() + 1);
  fim.setDate(fim.getDate() - 1);
  return { itemChave: "", descricao: "", fornecedorId: "", preco: "", unidade: "", inicio: diaIso(hoje), fim: diaIso(fim), observacao: "" };
}

function ModalNovo({ dados, aoFechar, aoCriar }: { dados: DadosContratos; aoFechar: () => void; aoCriar: (texto: string) => void }) {
  const sessao = useSessao();
  const [f, setF] = useState<FormContrato>(formVazio);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const muda = (campo: keyof FormContrato, valor: string) => setF((x) => ({ ...x, [campo]: valor }));
  const item = dados.itens.find((i) => i.chave === f.itemChave) ?? null;
  const pronto = !!(f.itemChave && f.fornecedorId && f.preco.trim() && f.unidade.trim() && f.inicio && f.fim);

  const salvar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await criarContratoNaTela(f, sessao?.id ?? null);
      if (!r.ok) {
        setErro(r.erro ?? "Não deu certo.");
        return;
      }
      const forn = dados.fornecedores.find((x) => x.id === f.fornecedorId)?.nome ?? "o fornecedor";
      aoCriar(`Contrato de ${f.descricao} com ${forn} criado.`);
    });

  return (
    <Modal
      open
      size="md"
      modalHeading="Novo contrato"
      modalLabel="Contrato anual"
      primaryButtonText={pendente ? "Salvando…" : "Criar contrato"}
      secondaryButtonText="Cancelar"
      closeButtonLabel="Fechar"
      primaryButtonDisabled={pendente || !pronto}
      preventCloseOnClickOutside
      onRequestClose={aoFechar}
      onRequestSubmit={salvar}
    >
      <Stack gap={5}>
        <p className={s.ajuda}>Enquanto o contrato estiver vigente, o item vai direto a este fornecedor por este preço, sem cotação. O comprador confirma antes, e pode cotar mesmo assim.</p>
        <ComboBox<OpcaoItem>
          id="contrato-item"
          titleText="Item"
          placeholder="Busque pelo nome ou pelo código"
          helperText={item ? `Código ${item.chave}${item.categoria ? ` · ${item.categoria}` : ""} · unidade de compra: ${item.unidade}` : "Da base de itens e do catálogo."}
          items={dados.itens}
          itemToString={(i) => (i ? `${i.descricao} (${i.chave})` : "")}
          selectedItem={item}
          shouldFilterItem={({ item: i, inputValue }) => !inputValue || `${i.descricao} ${i.chave}`.toLowerCase().includes(inputValue.toLowerCase())}
          onChange={({ selectedItem }) => setF((x) => ({ ...x, itemChave: selectedItem?.chave ?? "", descricao: selectedItem?.descricao ?? "", unidade: selectedItem?.unidade ?? x.unidade }))}
        />
        <Select id="contrato-fornecedor" labelText="Fornecedor" value={f.fornecedorId} onChange={(e) => muda("fornecedorId", e.target.value)} helperText="Bloqueados e quem pediu para parar não aparecem.">
          <SelectItem value="" text="Escolha o fornecedor" />
          {dados.fornecedores.map((x) => (
            <SelectItem key={x.id} value={x.id} text={`${x.nome}${x.simulado ? " (simulado)" : ""}`} />
          ))}
        </Select>
        <div className={s.linhaCampos}>
          <TextInput id="contrato-preco" labelText="Preço unitário (R$)" placeholder="36,50" inputMode="decimal" value={f.preco} onChange={(e) => muda("preco", e.target.value)} />
          <TextInput id="contrato-unidade" labelText="Unidade" placeholder="saco" value={f.unidade} onChange={(e) => muda("unidade", e.target.value)} helperText="O pedido precisa vir nesta unidade." />
        </div>
        <div className={s.linhaCampos}>
          <TextInput id="contrato-inicio" type="date" labelText="Início" value={f.inicio} onChange={(e) => muda("inicio", e.target.value)} />
          <TextInput id="contrato-fim" type="date" labelText="Fim" value={f.fim} onChange={(e) => muda("fim", e.target.value)} helperText="Vale até o fim deste dia." />
        </div>
        <TextArea id="contrato-obs" labelText="Condições (opcional)" placeholder="Ex.: boleto 28 dias, frete incluso, entrega em 2 dias úteis" rows={2} maxCount={500} enableCounter value={f.observacao} onChange={(e) => muda("observacao", e.target.value)} />
        {erro ? <InlineNotification kind="error" lowContrast hideCloseButton title="Não deu para criar." subtitle={erro} /> : null}
      </Stack>
    </Modal>
  );
}

function Encerrar({ c, aoEncerrar }: { c: Linha; aoEncerrar: (texto: string) => void }) {
  const sessao = useSessao();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const encerrar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await encerrarContratoNaTela(c.id, sessao?.id ?? null, motivo);
      if (!r.ok) {
        setErro(r.erro ?? "Não deu certo.");
        return;
      }
      setAberto(false);
      aoEncerrar(`Contrato de ${c.descricao} com ${c.fornecedorNome} encerrado.`);
    });
  return (
    <>
      <Button size="sm" kind="danger--ghost" disabled={pendente} onClick={() => setAberto(true)}>
        Encerrar
      </Button>
      {aberto ? (
        <Modal
          open
          danger
          size="sm"
          modalHeading={`Encerrar o contrato de ${c.descricao}?`}
          primaryButtonText={pendente ? "Encerrando…" : "Encerrar"}
          secondaryButtonText="Voltar"
          primaryButtonDisabled={pendente}
          onRequestClose={() => setAberto(false)}
          onRequestSubmit={encerrar}
        >
          <Stack gap={5}>
            <p>Os próximos pedidos deste item voltam a ser cotados. O que já foi pedido pelo contrato não muda.</p>
            <TextInput id={`motivo-${c.id}`} labelText="Motivo (opcional)" placeholder="Ex.: preço renegociado" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            {erro ? <InlineNotification kind="error" lowContrast hideCloseButton title="Não deu certo." subtitle={erro} /> : null}
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}

export function TelaContratos({ dados }: { dados: DadosContratos }) {
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const botaoNovo = useRef<HTMLButtonElement>(null);
  const estavaAberto = useRef(false);

  // Fechado de qualquer jeito, o foco volta ao botão.
  useEffect(() => {
    if (estavaAberto.current && !novo) botaoNovo.current?.focus();
    estavaAberto.current = novo;
  }, [novo]);

  const avisar = (texto: string) => {
    setFeito(texto);
    router.refresh();
  };
  const vigentes = dados.contratos.filter((c) => c.situacao === "vigente").length;

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Contratos"
        contexto={`Contratos anuais com preço fechado. Item com contrato vigente vai direto ao fornecedor do contrato, sem cotação.${vigentes ? ` ${vigentes === 1 ? "1 contrato vigente" : `${vigentes} contratos vigentes`}.` : ""}`}
        lado={
          <Button ref={botaoNovo} kind="primary" size="md" renderIcon={Add} onClick={() => setNovo(true)} disabled={!dados.itens.length || !dados.fornecedores.length}>
            Novo contrato
          </Button>
        }
      />
      <CorpoPagina>
        {feito ? (
          <GradePagina>
            <Column sm={4} md={8} lg={16}>
              <InlineNotification kind="success" lowContrast title="Feito." subtitle={feito} onCloseButtonClick={() => setFeito(null)} />
            </Column>
          </GradePagina>
        ) : null}
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Contratos"
              descricao="O pedido de compra sai pelo preço do contrato, ao fornecedor do contrato, depois que o comprador confirma. Contrato com fornecedor bloqueado, sem canal ou com outra unidade não vale: o item é cotado e o comprador é avisado."
              plano
            >
              <Tabela
                rotulo="Contratos anuais"
                vazio="Nenhum contrato ainda. Crie o primeiro em Novo contrato."
                apagadas={dados.contratos.flatMap((c, n) => (c.situacao === "encerrado" || c.situacao === "vencido" ? [n] : []))}
                colunas={["Item", "Fornecedor", "Preço unitário", "Período", "Situação", "Ação"]}
                linhas={dados.contratos.map((c) => [
                  <span key="i">
                    {c.descricao}
                    <span className={s.apoio}>{c.itemChave}</span>
                  </span>,
                  <span key="f">
                    {c.fornecedorNome}
                    {c.simulado ? <SeloSimulado /> : null}
                  </span>,
                  <span key="p" className={s.numero}>
                    {brl(c.precoUnitario)} por {c.unidade}
                    {c.observacao ? <span className={s.apoio}>{c.observacao}</span> : null}
                  </span>,
                  <span key="d" className={s.periodo}>
                    {data(c.inicio)} a {data(c.fim)}
                    {c.criadoPor ? <span className={s.apoio}>Criado por {c.criadoPor}</span> : null}
                  </span>,
                  <Tag key="s" size="sm" type={SITUACAO[c.situacao].cor}>
                    {SITUACAO[c.situacao].texto}
                  </Tag>,
                  c.ativo ? <Encerrar key="a" c={c} aoEncerrar={avisar} /> : <span key="a" className={s.apoio}>—</span>,
                ])}
              />
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>
      {novo ? (
        <ModalNovo
          dados={dados}
          aoFechar={() => setNovo(false)}
          aoCriar={(t) => {
            setNovo(false);
            avisar(t);
          }}
        />
      ) : null}
    </Pagina>
  );
}
