import { redirect } from "next/navigation";

/** O chat do navegador agora mora na lateral do Início, com as outras conversas. Leva junto a conversa aberta (?c=). */
export default async function Conversar({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const c = (await searchParams).c;
  redirect(c ? `/?c=${encodeURIComponent(c)}` : "/");
}
