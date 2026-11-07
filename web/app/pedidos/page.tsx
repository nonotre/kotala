import Link from "next/link";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/carbon";
import { listaPedidos } from "@/lib/dados";
import { dataHora } from "@/lib/formato";
import estilos from "../comum.module.scss";

export const dynamic = "force-dynamic";

const ESTADO: Record<string, string> = {
  interpretando: "Lendo o pedido",
  aguardando_confirmacao: "Aguardando sua confirmação",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export default async function Pedidos() {
  const lista = await listaPedidos();
  return (
    <>
      <AtualizaSozinho segundos={5} />
      <h1 className={estilos.titulo}>Pedidos</h1>
      <p className={estilos.sub}>Cada mensagem de compra vira um pedido; um pedido pode ter vários itens, cotados um por vez.</p>
      {lista.length === 0 ? (
        <p className={estilos.sub}>Nenhum pedido ainda.</p>
      ) : (
        <div className={estilos.tabela}>
          <Table aria-label="Pedidos">
            <TableHead>
              <TableRow>
                <TableHeader>Pedido</TableHeader>
                <TableHeader>Mensagem do comprador</TableHeader>
                <TableHeader>Itens</TableHeader>
                <TableHeader>Situação</TableHeader>
                <TableHeader>Canal</TableHeader>
                <TableHeader>Quando</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {lista.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/pedidos/${p.id}`}>Pedido {p.id}</Link>
                  </TableCell>
                  <TableCell>{p.texto.length > 90 ? `${p.texto.slice(0, 90)}…` : p.texto}</TableCell>
                  <TableCell>{p.itens}</TableCell>
                  <TableCell>{ESTADO[p.estado]}</TableCell>
                  <TableCell>{p.canal === "web" ? "Aqui no app" : p.canal === "telegram" ? "Telegram" : p.canal}</TableCell>
                  <TableCell>{dataHora(p.criadoEm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
