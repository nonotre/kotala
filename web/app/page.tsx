import Link from "next/link";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { Etiquetas } from "@/components/Etiquetas";
import { COLUNAS, quadro } from "@/lib/dados";
import { quantidade } from "@/lib/formato";
import estilos from "./quadro.module.scss";

export const dynamic = "force-dynamic";

const AJUDA: Record<string, string> = {
  Solicitado: "Pedidos que chegaram e esperam confirmação ou a vez na fila.",
  Cotando: "Buscando fornecedores e esperando as propostas.",
  Comparando: "Mapa de cotação montado ou esperando sua decisão.",
  Decidido: "Aprovados, enviados, confirmados ou sem proposta.",
};

export default async function Quadro({ searchParams }: { searchParams: Promise<{ canceladas?: string }> }) {
  const mostrarCanceladas = (await searchParams).canceladas === "1";
  const colunas = await quadro(mostrarCanceladas);
  const total = COLUNAS.reduce((t, c) => t + colunas[c].length, 0);
  return (
    <>
      <AtualizaSozinho segundos={3} />
      <h1 className={estilos.titulo}>Quadro de compras</h1>
      <p className={estilos.sub}>
        {total ? `${total} ${total === 1 ? "item" : "itens"}. O card anda sozinho a cada etapa.` : "Nenhum pedido ainda. Mande um pedido pelo Telegram ou pela aba Conversar."}{" "}
        <Link href={mostrarCanceladas ? "/" : "/?canceladas=1"} className={estilos.link}>
          {mostrarCanceladas ? "Ocultar canceladas" : "Mostrar canceladas"}
        </Link>
      </p>
      <div className={estilos.quadro}>
        {COLUNAS.map((coluna) => (
          <section key={coluna} className={estilos.coluna} aria-label={coluna}>
            <header className={estilos.cabeca}>
              <h2>{coluna}</h2>
              <span className={estilos.contagem}>{colunas[coluna].length}</span>
            </header>
            <p className={estilos.ajuda}>{AJUDA[coluna]}</p>
            {colunas[coluna].length === 0 ? <p className={estilos.vazio}>Nada aqui.</p> : null}
            {colunas[coluna].map((c) => (
              <Link key={c.itemId} href={`/pedidos/${c.pedidoId}#item-${c.itemId}`} className={estilos.cartao}>
                <span className={estilos.pedido}>Pedido {c.pedidoId}</span>
                <span className={estilos.descricao}>
                  {quantidade(c.quantidade, c.unidade)} de {c.descricao}
                </span>
                <Etiquetas lista={c.etiquetas} />
              </Link>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
