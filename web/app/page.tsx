import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { avisosQuePedemAcao, dadosDoQuadro } from "@/components/operacao/dados-quadro";
import { InicioQuadro } from "@/components/operacao/InicioQuadro";
import type { Filtro } from "@/components/operacao/ListaPedidos";
import { pedidosOperacao } from "@/lib/dados-operacao";

export const dynamic = "force-dynamic";

// Repetido aqui: o FILTROS da lista mora num módulo de cliente, que a tela de servidor não lê.
const FILTROS_VALIDOS: Filtro[] = ["todos", "voce", "andando", "concluidos", "cancelados"];

type Busca = { vista?: string; filtro?: string; canceladas?: string };

/** O link do bot quase não muda: fica em memória por 1 h, e não é perguntado a cada atualização da tela. */
const UMA_HORA_MS = 3_600_000;
let botGuardado: { usuario: string | null; ate: number } | null = null;

/** Usuário do bot do comprador, perguntado ao Telegram com o token do .env (só no servidor). */
async function usuarioDoBotComprador(): Promise<string | null> {
  if (botGuardado && botGuardado.ate > Date.now()) return botGuardado.usuario;
  const token = process.env.TELEGRAM_TOKEN_COMPRADOR;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { ok: boolean; result?: { username?: string } };
    const usuario = j.ok ? (j.result?.username ?? null) : null;
    botGuardado = { usuario, ate: Date.now() + UMA_HORA_MS };
    return usuario;
  } catch {
    // Sem resposta, nada é guardado: tenta de novo na próxima carga.
    return null;
  }
}

// O Início é a tela de trabalho: as cotações em quadro (padrão) ou em lista, e as conversas na lateral.
// Na URL: ?vista=lista, ?filtro= (da lista), ?canceladas=1 (do quadro) e ?c=<contato> (conversa aberta, lida no cliente).
// O painel antigo (Inicio.tsx) está fora da rota.
export default async function PaginaInicio({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const vista = busca.vista === "lista" ? "lista" : "quadro";
  const filtro = busca.filtro as Filtro | undefined;
  const filtroInicial = filtro && FILTROS_VALIDOS.includes(filtro) ? filtro : "todos";
  const mostrarCanceladas = busca.canceladas === "1";

  // Só vem a base da vista aberta; o "Precisa de você" vem nas duas.
  const [quadro, linhas, avisosDaLista, usuario] = await Promise.all([
    vista === "quadro" ? dadosDoQuadro(mostrarCanceladas) : undefined,
    vista === "lista" ? pedidosOperacao() : undefined,
    vista === "lista" ? avisosQuePedemAcao() : undefined,
    usuarioDoBotComprador(),
  ]);

  return (
    <>
      <AtualizaSozinho segundos={3} />
      <InicioQuadro
        vista={vista}
        filtroInicial={filtroInicial}
        mostrarCanceladas={mostrarCanceladas}
        avisos={quadro?.avisos ?? avisosDaLista ?? []}
        quadro={quadro}
        linhas={linhas}
        // Abre o bot, não a conversa de alguém: o Telegram não deixa abrir a conversa de outra pessoa.
        linkTelegram={usuario ? `https://t.me/${usuario}` : null}
      />
    </>
  );
}
