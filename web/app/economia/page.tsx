import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Tile } from "@/components/carbon";
import { economia } from "@/lib/dados";
import { brl, quantidade } from "@/lib/formato";
import estilos from "../comum.module.scss";

export const dynamic = "force-dynamic";

export default async function Economia() {
  const e = await economia();
  const comRef = e.linhas.filter((l) => l.referenciaProduto !== null && l.produto !== null);
  const vsReferencia = comRef.reduce((t, l) => t + (l.referenciaProduto! - l.produto!), 0);
  const comFaixa = e.linhas.filter((l) => l.maisCaraCusto !== null && l.custo !== null && l.validas > 1);
  const vsMaisCara = comFaixa.reduce((t, l) => t + (l.maisCaraCusto! - l.custo!), 0);
  const total = e.linhas.reduce((t, l) => t + (l.custo ?? 0), 0);
  const minutos = e.linhas.map((l) => l.minutos).sort((a, b) => a - b);
  const medianaMin = minutos.length ? minutos[Math.floor(minutos.length / 2)]! : null;
  const simuladas = e.linhas.filter((l) => l.simulado).length;
  const negociadas = e.linhas.filter((l) => l.produtoAntesNegociar !== null && l.produto !== null && l.produtoAntesNegociar - l.produto >= 0.01);
  const ganhoNegociacao = negociadas.reduce((t, l) => t + (l.produtoAntesNegociar! - l.produto!), 0);

  return (
    <>
      <h1 className={estilos.titulo}>Quanto o assistente devolveu</h1>
      <p className={estilos.sub}>
        Como se fosse um comprador contratado: o que custaram as compras, quanto ficou abaixo da referência pública e quanto trabalho ele fez. Cada número diz contra o que foi comparado.
        {simuladas ? ` ${simuladas} de ${e.linhas.length} compras foram com fornecedores simulados.` : ""}
      </p>
      <div className={estilos.numeros}>
        <Tile className={estilos.numero}>
          <span>Compras confirmadas</span>
          <strong>{e.linhas.length}</strong>
          <p>Total {brl(total)}, com frete e impostos informados.</p>
        </Tile>
        <Tile className={estilos.numero}>
          <span>Contra a referência pública</span>
          <strong>{comRef.length ? brl(vsReferencia) : "—"}</strong>
          <p>{comRef.length ? `Produto comprado contra a mediana dos preços da internet × quantidade, em ${comRef.length} ${comRef.length === 1 ? "compra" : "compras"}. Positivo é economia. Frete fora.` : "Nenhuma compra com referência da internet ainda."}</p>
        </Tile>
        <Tile className={estilos.numero}>
          <span>Conseguido na negociação</span>
          <strong>{negociadas.length ? brl(ganhoNegociacao) : "—"}</strong>
          <p>{negociadas.length ? `O fornecedor escolhido baixou o preço do produto depois da contraproposta, em ${negociadas.length} ${negociadas.length === 1 ? "compra" : "compras"}: era quanto custava antes, contra o que pagou.` : "Nenhuma compra negociada ainda. Reprove por preço alto para o assistente negociar."}</p>
        </Tile>
        <Tile className={estilos.numero}>
          <span>Contra a proposta mais cara</span>
          <strong>{comFaixa.length ? brl(vsMaisCara) : "—"}</strong>
          <p>Custo total escolhido contra a proposta válida mais cara do mesmo mapa. Mostra a faixa de preço que a cotação revelou.</p>
        </Tile>
        <Tile className={estilos.numero}>
          <span>Tempo do pedido à confirmação</span>
          <strong>{medianaMin !== null ? `${medianaMin} min` : "—"}</strong>
          <p>Mediana. Na demo os fornecedores têm 2 minutos para responder; a estimativa da área para o processo manual é de cerca de 7 dias.</p>
        </Tile>
      </div>

      <h2 className={estilos.secao}>Trabalho feito pelo assistente</h2>
      <div className={estilos.numeros}>
        <Tile className={estilos.numero}>
          <span>Pedidos de cotação enviados</span>
          <strong>{e.cotacoes}</strong>
        </Tile>
        <Tile className={estilos.numero}>
          <span>Mensagens lidas e enviadas</span>
          <strong>{e.mensagens.entrada + e.mensagens.saida}</strong>
          <p>{e.mensagens.entrada} recebidas, {e.mensagens.saida} enviadas.</p>
        </Tile>
        <Tile className={estilos.numero}>
          <span>Chamadas de IA</span>
          <strong>{e.ia.chamadas}</strong>
          <p>{e.ia.tokens.toLocaleString("pt-BR")} tokens; {e.ia.falhas} falharam e caíram na reserva.</p>
        </Tile>
      </div>

      <h2 className={estilos.secao}>Compras</h2>
      {e.linhas.length === 0 ? (
        <p className={estilos.sub}>Nenhuma compra confirmada ainda.</p>
      ) : (
        <div className={estilos.tabela}>
          <Table aria-label="Compras confirmadas">
            <TableHead>
              <TableRow>
                <TableHeader>Pedido</TableHeader>
                <TableHeader>Item</TableHeader>
                <TableHeader>Fornecedor</TableHeader>
                <TableHeader>Custo total</TableHeader>
                <TableHeader>Referência pública (produto)</TableHeader>
                <TableHeader>Proposta mais cara</TableHeader>
                <TableHeader>Negociação</TableHeader>
                <TableHeader>Tempo</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {e.linhas.map((l) => (
                <TableRow key={l.itemId}>
                  <TableCell>
                    <Link href={`/pedidos/${l.pedidoId}#item-${l.itemId}`}>Pedido {l.pedidoId}</Link>
                  </TableCell>
                  <TableCell>
                    {quantidade(l.quantidade, l.unidade)} de {l.descricao}
                  </TableCell>
                  <TableCell>
                    {l.fornecedor ?? "—"} {l.simulado ? <Tag size="sm" type="gray">simulado</Tag> : null}
                  </TableCell>
                  <TableCell>{brl(l.custo)}</TableCell>
                  <TableCell>{l.referenciaProduto !== null ? `${brl(l.referenciaProduto)} (${l.referenciaLojas} ${l.referenciaLojas === 1 ? "loja" : "lojas"})` : "—"}</TableCell>
                  <TableCell>{l.validas > 1 ? `${brl(l.maisCaraCusto)} · ${l.maisCaraNome}` : "—"}</TableCell>
                  <TableCell>{l.produtoAntesNegociar !== null && l.produto !== null && l.produtoAntesNegociar - l.produto >= 0.01 ? `de ${brl(l.produtoAntesNegociar)} para ${brl(l.produto)}` : "—"}</TableCell>
                  <TableCell>{l.minutos} min</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
