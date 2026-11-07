import { notFound } from "next/navigation";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { FichaFornecedor } from "@/components/consulta/FichaFornecedor";
import { fichaFornecedor } from "@/lib/dados-consulta";

export const dynamic = "force-dynamic";

/** Ficha de um fornecedor: cotações, propostas, compras, verificação, sanções e contato. */
export default async function Ficha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await fichaFornecedor(id);
  if (!f) notFound();
  // A ação de homologar/bloquear revalida só a lista: a ficha se atualiza sozinha.
  return (
    <>
      <AtualizaSozinho segundos={4} />
      <FichaFornecedor f={f} />
    </>
  );
}
