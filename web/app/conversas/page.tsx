import { redirect } from "next/navigation";

// As conversas agora moram na lateral do Início. Leva junto a conversa aberta (?c=).
export default async function PaginaConversas({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const c = (await searchParams).c;
  redirect(c ? `/?c=${encodeURIComponent(c)}` : "/");
}
