import { redirect } from "next/navigation";

// As conversas moram em Conversar (/chat). Leva junto a conversa aberta (?c=).
export default async function PaginaConversas({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const c = (await searchParams).c;
  redirect(c ? `/chat?c=${encodeURIComponent(c)}` : "/chat");
}
