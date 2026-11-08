// T2 e T3: /telegram-simulado/<contato.id>, o chat de um fornecedor simulado. `?item=` marca a cotação.
// Fica fora da casca do site (ver components/Casca.tsx): abre numa aba à parte, como outro aplicativo.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { chatSimulado, itemDoChat } from "@/lib/dados-simulado";
import { ChatSimulado } from "../ChatSimulado";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ item?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const chat = await chatSimulado((await params).id);
  return { title: chat ? `Telegram simulado · ${chat.fornecedor.nome}` : "Chat não encontrado · Telegram simulado" };
}

export default async function PaginaChatSimulado({ params, searchParams }: Props) {
  const [{ id }, { item }] = await Promise.all([params, searchParams]);
  const chat = await chatSimulado(id);
  if (!chat) notFound();
  const doItem = await itemDoChat(Array.isArray(item) ? item[0] : item);
  return (
    <main id="conteudo">
      {/* T7: relê o chat para ver as mensagens do sistema chegando. */}
      <AtualizaSozinho segundos={3} />
      <ChatSimulado chat={chat} item={doItem} />
    </main>
  );
}
