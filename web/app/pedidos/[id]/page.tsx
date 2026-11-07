import Link from "next/link";
import { notFound } from "next/navigation";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { BotaoAcao } from "@/components/BotaoAcao";
import { Etiquetas } from "@/components/Etiquetas";
import { LinhaDoTempo, type EntradaSerial } from "@/components/LinhaDoTempo";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Tile } from "@/components/carbon";
import { detalhePedido, type Linha } from "@/lib/dados";
import { brl, dataHora, dias, hora, nota, quantidade } from "@/lib/formato";
import estilos from "./pedido.module.scss";

export const dynamic = "force-dynamic";

const ESTADO_ITEM: Record<string, string> = {
  na_fila: "Na fila",
  buscando: "Buscando fornecedores",
  aguardando_recompra: "Compra repetida: repetir ou cotar de novo?",
  cotando: "Esperando propostas",
  comparando: "Montando o mapa",
  aguardando_decisao: "Aguardando sua decisão",
  aprovado: "Aprovado",
  pedido_enviado: "Pedido enviado ao fornecedor",
  confirmado: "Confirmado pelo fornecedor",
  sem_proposta: "Sem proposta válida",
  cancelado: "Cancelado",
};
const ESTADO_PEDIDO: Record<string, string> = {
  interpretando: "Lendo o pedido",
  aguardando_confirmacao: "Aguardando sua confirmação",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
const SITUACAO: Record<string, string> = {
  aguardando: "Aguardando",
  respondeu: "Respondeu",
  sem_resposta: "Sem resposta",
  parou: "Pediu para parar",
  desistiu: "Desistiu",
  encerrada: "Não atende",
};

const nome = (l: Linha) => (
  <>
    {l.oferta.fornecedorNome} {l.oferta.simulado ? <Tag size="sm" type="gray">simulado</Tag> : null}
  </>
);

export default async function Pedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await detalhePedido(Number(id));
  if (!d) notFound();
  const { pedido: p } = d;
  const tempo: EntradaSerial[] = d.linhaDoTempo.map((e) => ({ ...e, em: e.em.toISOString() }) as EntradaSerial);

  return (
    <>
      <AtualizaSozinho segundos={4} />
      <p className={estilos.trilha}>
        <Link href="/">Quadro</Link> / <Link href="/pedidos">Pedidos</Link> / Pedido {p.id}
      </p>
      <h1 className={estilos.titulo}>Pedido {p.id}</h1>
      <p className={estilos.contexto}>
        {ESTADO_PEDIDO[p.estado]} · {p.modoEntrega === "retirada" ? "Retirada na loja" : `Entrega: ${p.destino ?? "não informado"}${p.cep ? `, CEP ${p.cep}` : ""}`}
        {p.prazoTexto ? ` · Prazo: ${p.prazoTexto}${p.prazoMaxDias !== null ? ` (${dias(p.prazoMaxDias)})` : ""}` : ""}
        {p.urgencia !== "normal" ? " · " : ""}
        {p.urgencia === "obra_parada" ? <Tag type="red" size="sm">Obra parada</Tag> : p.urgencia === "urgente" ? <Tag type="red" size="sm">Urgente</Tag> : null}
      </p>
      <Tile className={estilos.bloco}>
        <h2>O que você pediu</h2>
        <blockquote className={estilos.original}>{p.textoOriginal}</blockquote>
        {p.correcoes.length ? <p className={estilos.ajuda}>Correções: {p.correcoes.join(" · ")}</p> : null}
        {p.suposicoes.length ? <p className={estilos.ajuda}>O assistente considerou: {p.suposicoes.join("; ")}</p> : null}
        {p.estado === "aguardando_confirmacao" ? (
          <div className={estilos.acoes}>
            <BotaoAcao dado={`pedido:${p.id}:confirmar`} rotulo="Confirmar pedido" kind="primary" />
            <BotaoAcao dado={`pedido:${p.id}:cancelar`} rotulo="Cancelar" kind="ghost" confirmar={{ titulo: `Cancelar o pedido ${p.id}?`, texto: "Nada será cotado.", botao: "Cancelar pedido" }} />
          </div>
        ) : null}
      </Tile>

      {d.itens.map(({ item, recompra, mapa, cotacoes, referencias, verificacoes }) => {
        const c = mapa?.comparacao;
        const aguardando = item.estado === "aguardando_decisao";
        return (
          <section key={item.id} id={`item-${item.id}`} className={estilos.item}>
            <h2 className={estilos.itemTitulo}>
              {item.ordem}. {quantidade(item.quantidade, item.unidade)} de {item.descricao}
            </h2>
            <p className={estilos.contexto}>
              {ESTADO_ITEM[item.estado]}
              {item.rodada > 1 ? ` · rodada ${item.rodada}` : ""}
              {item.prazoRespostasEm && item.estado === "cotando" ? ` · respostas até ${hora(item.prazoRespostasEm)}` : ""}
              {item.aceitaSimilar ? " · aceita equivalente" : ""}
            </p>

            {recompra ? (
              <Tile className={estilos.bloco}>
                <h3>Você comprou este item há pouco tempo</h3>
                <p>
                  Última compra: <strong>{recompra.fornecedorNome}</strong> {recompra.simulado ? <Tag size="sm" type="gray">simulado</Tag> : null}, em {dataHora(recompra.data)}, a {brl(recompra.precoUnitario)} por {item.unidade}
                  {recompra.frete !== null ? `, frete ${brl(recompra.frete)}` : ""}.
                </p>
                {recompra.prazoPrometidoDias !== null ? (
                  <p className={estilos.ajuda}>
                    Prazo combinado: {dias(recompra.prazoPrometidoDias)}
                    {recompra.prazoCumprido === true ? ", cumprido" : ""}. {recompra.comprasNoPeriodo > 1 ? `Comprou ${recompra.comprasNoPeriodo} vezes com ele nos últimos 90 dias.` : ""}
                  </p>
                ) : null}
                <p className={estilos.ajuda}>Compras repetidas em menos de 3 meses quase não mudam de preço. A decisão é sua.</p>
                <div className={estilos.acoes}>
                  <BotaoAcao
                    dado={`item:${item.id}:repetir_ok`}
                    rotulo={`Repetir com ${recompra.fornecedorNome}`}
                    kind="primary"
                    confirmar={{
                      titulo: "Repetir a compra?",
                      texto: `${quantidade(item.quantidade, item.unidade)} de ${item.descricao} com ${recompra.fornecedorNome}${recompra.simulado ? " (simulado)" : ""}, a ${brl(recompra.precoUnitario)} por ${item.unidade}. O pedido de compra vai para o fornecedor, que confirma se mantém o preço.`,
                      botao: "Sim, repetir",
                    }}
                  />
                  <BotaoAcao dado={`item:${item.id}:cotar_novo`} rotulo="Cotar de novo" kind="tertiary" />
                </div>
              </Tile>
            ) : null}

            {cotacoes.length ? (
              <Tile className={estilos.bloco}>
                <h3>{item.rodada > 1 ? `Consultados na rodada ${item.rodada}` : "Fornecedores consultados"}</h3>
                {item.rodada > 1 ? <p className={estilos.ajuda}>Quem não foi consultado nesta rodada mantém a proposta anterior no mapa.</p> : null}
                <ul className={estilos.chips}>
                  {cotacoes.map(({ cotacao: ct, nome: n, origem }) => (
                    <li key={ct.id}>
                      {n} {origem === "simulado" ? <Tag size="sm" type="gray">simulado</Tag> : null} <Tag size="sm" type={ct.situacao === "respondeu" ? "green" : ct.situacao === "aguardando" ? "blue" : "gray"}>{SITUACAO[ct.situacao]}</Tag>
                      {/* X5: quem não respondeu ao texto pode receber uma ligação por voz. */}
                      {item.estado === "cotando" && ct.situacao === "aguardando" ? <Link href={`/voz/${ct.id}`}> Ligar por voz</Link> : null}
                    </li>
                  ))}
                </ul>
              </Tile>
            ) : null}

            {c ? (
              <Tile className={estilos.bloco}>
                <h3>
                  Mapa de cotação{mapa!.rodada > 1 ? `, rodada ${mapa!.rodada}` : ""}: {c.validas.length} {c.validas.length === 1 ? "proposta válida" : "propostas válidas"}
                </h3>
                <div className={estilos.tabela}>
                  <Table size="md" aria-label="Mapa de cotação">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Fornecedor</TableHeader>
                        <TableHeader>Custo total</TableHeader>
                        <TableHeader>Produto</TableHeader>
                        <TableHeader>Frete</TableHeader>
                        <TableHeader>Entrega</TableHeader>
                        <TableHeader>Pagamento</TableHeader>
                        <TableHeader>Confiança</TableHeader>
                        <TableHeader>Nota</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {c.validas.map((l, i) => {
                        const v = verificacoes[l.oferta.fornecedorId] as { nivel?: string; pontos?: number } | null;
                        return (
                          <TableRow key={l.oferta.id} className={i === 0 ? estilos.vencedora : undefined}>
                            <TableCell>
                              {nome(l)}
                              {!l.oferta.itemExato ? <div className={estilos.ajuda}>Equivalente: {l.oferta.itemOferecido}</div> : null}
                              {l.alertas.length ? <div className={estilos.alerta}>Atenção: {l.alertas.join("; ")}</div> : null}
                            </TableCell>
                            <TableCell>
                              <strong>{brl(l.custo)}</strong>
                              {l.oferta.produtoAnterior && l.produto !== null && l.oferta.produtoAnterior - l.produto >= 0.01 ? (
                                <div className={estilos.ajuda}>Negociado: produto era {brl(l.oferta.produtoAnterior)}</div>
                              ) : null}
                            </TableCell>
                            <TableCell>{brl(l.produto)}</TableCell>
                            <TableCell>{l.origemFrete === "nao_se_aplica" ? "Retirada" : `${brl(l.frete)} (${l.origemFrete})`}</TableCell>
                            <TableCell>{l.oferta.prazoDias !== null ? dias(l.oferta.prazoDias) : "—"}</TableCell>
                            <TableCell>{l.oferta.pagamento ?? "—"}</TableCell>
                            <TableCell>{l.oferta.simulado ? "simulado" : v?.nivel ? `${v.nivel} (${v.pontos})` : "—"}</TableCell>
                            <TableCell>{nota(l.nota)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {c.cortadas.length ? (
                  <>
                    <h4 className={estilos.sub}>Fora da comparação</h4>
                    <ul className={estilos.lista}>
                      {c.cortadas.map((l) => (
                        <li key={l.oferta.id}>
                          {nome(l)}: {l.motivos.join("; ")}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <div className={estilos.recomendacao}>
                  <Tag type="purple" size="sm">
                    Assistente
                  </Tag>
                  <p>
                    <strong>{c.podeDizerMelhor ? "Recomendo" : "Na frente"}: {c.vencedora?.oferta.fornecedorNome}.</strong> {mapa!.recomendacao}
                  </p>
                  <p className={estilos.ajuda}>
                    Pesos: preço {c.pesos.preco}, prazo {c.pesos.prazo}, confiança {c.pesos.confianca}, aderência {c.pesos.aderencia}, pagamento {c.pesos.pagamento}
                    {c.urgente ? " (prazo em dobro: pedido urgente)" : ""}.{c.aMaisQueAMaisBarata > 0 ? ` Custa ${brl(c.aMaisQueAMaisBarata)} a mais que a mais barata.` : ""}
                  </p>
                  {item.justificativaMenosDeTres ? <p className={estilos.ajuda}>{item.justificativaMenosDeTres}</p> : null}
                </div>
                {aguardando && c.vencedora ? (
                  <div className={estilos.acoes}>
                    {c.validas.map((l, i) => (
                      <BotaoAcao
                        key={l.oferta.id}
                        dado={`item:${item.id}:confirmar:${l.oferta.id}`}
                        rotulo={`Aprovar ${l.oferta.fornecedorNome}`}
                        kind={i === 0 ? "primary" : "tertiary"}
                        confirmar={{
                          titulo: "Confirmar a compra?",
                          texto: `${quantidade(item.quantidade, item.unidade)} de ${item.descricao} com ${l.oferta.fornecedorNome}${l.oferta.simulado ? " (simulado)" : ""} por ${brl(l.custo)}, entrega em ${l.oferta.prazoDias !== null ? dias(l.oferta.prazoDias) : "prazo não informado"}. O pedido de compra vai para o fornecedor.`,
                          botao: "Sim, aprovar",
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                {aguardando && c.vencedora ? (
                  <>
                    <h4 className={estilos.sub}>Reprovar</h4>
                    <p className={estilos.ajuda}>Cada motivo leva a um caminho diferente.</p>
                    <div className={estilos.acoes}>
                      {item.rodada < 3 ? <BotaoAcao dado={`item:${item.id}:negociar`} rotulo="Preço alto: negociar" kind="tertiary" /> : null}
                      <BotaoAcao dado={`item:${item.id}:buscar`} rotulo="Prazo longo: buscar mais fornecedores" kind="ghost" />
                      <BotaoAcao
                        dado={`item:${item.id}:excluir:${c.vencedora.oferta.fornecedorId}`}
                        rotulo={`Não confio em ${c.vencedora.oferta.fornecedorNome}`}
                        kind="ghost"
                        confirmar={{ titulo: `Tirar ${c.vencedora.oferta.fornecedorNome} do mapa?`, texto: "O mapa é refeito sem esse fornecedor, só para este item.", botao: "Tirar do mapa" }}
                      />
                      <BotaoAcao dado={`item:${item.id}:reprovar`} rotulo="Cotar de novo com todos" kind="ghost" />
                      <BotaoAcao
                        dado={`item:${item.id}:cancelar`}
                        rotulo="Desistir deste item"
                        kind="ghost"
                        confirmar={{ titulo: "Desistir deste item?", texto: `${item.descricao} será cancelado. Nada será comprado.`, botao: "Desistir" }}
                      />
                    </div>
                    {item.rodada >= 3 ? <p className={estilos.ajuda}>Já foram 3 rodadas: é o limite de negociação para não cansar os fornecedores.</p> : null}
                  </>
                ) : null}
                {item.negociacao && item.negociacao.rodada === item.rodada ? (
                  <p className={estilos.ajuda}>
                    Negociação na rodada {item.rodada}: {item.negociacao.motivo}
                  </p>
                ) : null}
                {item.excluidos.length ? <p className={estilos.ajuda}>{item.excluidos.length === 1 ? "1 fornecedor foi tirado" : `${item.excluidos.length} fornecedores foram tirados`} deste mapa por você.</p> : null}
                {aguardando ? <p className={estilos.ajuda}>A decisão é sua: nada é comprado sem a sua aprovação.</p> : null}
              </Tile>
            ) : null}

            {referencias.length ? (
              <Tile className={estilos.bloco}>
                <h3>Preço de referência na internet</h3>
                <div className={estilos.tabela}>
                  <Table size="sm" aria-label="Referência pública">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Loja</TableHeader>
                        <TableHeader>Produto</TableHeader>
                        <TableHeader>Preço</TableHeader>
                        <TableHeader>Entrega</TableHeader>
                        <TableHeader>Situação</TableHeader>
                        <TableHeader>Coletado</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {referencias.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            {r.loja} {r.cnpjAtivo ? <Tag size="sm" type="green">CNPJ ativo</Tag> : null}
                          </TableCell>
                          <TableCell>
                            <a href={r.url} target="_blank" rel="noreferrer">
                              {r.titulo}
                            </a>
                          </TableCell>
                          <TableCell>
                            {brl(r.precoUnitario ?? r.precoFonte)}
                            {r.conversao ? <div className={estilos.ajuda}>{r.conversao}</div> : null}
                          </TableCell>
                          <TableCell>{r.entregaNoCep && r.frete ? `${brl(r.frete)}${r.fretePrazoDias !== null ? ` em ${dias(r.fretePrazoDias)}` : ""}` : (r.regiaoDoPreco ?? "—")}</TableCell>
                          <TableCell>{r.aceita ? (r.disponivel === false ? "Sem estoque" : "Usado na referência") : `Cortado: ${r.motivoCorte}`}</TableCell>
                          <TableCell>{dataHora(r.coletadoEm)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Tile>
            ) : null}
          </section>
        );
      })}

      <section className={estilos.item}>
        <h2 className={estilos.itemTitulo}>Linha do tempo</h2>
        <p className={estilos.contexto}>Tudo o que aconteceu neste pedido, em ordem. Toque numa chamada de IA para ver o que foi enviado e respondido.</p>
        <Tile className={estilos.bloco}>
          <LinhaDoTempo entradas={tempo} />
        </Tile>
      </section>
    </>
  );
}
