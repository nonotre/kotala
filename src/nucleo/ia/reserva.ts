// Cadeia de reserva genérica: tenta cada alvo em ordem e decide, pelo erro,
// se passa ao próximo modelo, pula a rota inteira ou desiste. Sem IA aqui,
// para poder testar sem rede.

export type Alvo = { rota: string; modelo: string };

export type TipoFalha =
  | "limite" // 429: cota ou ritmo
  | "indisponivel" // 5xx, timeout, rede
  | "chave" // 401/403: chave inválida ou sem permissão; pula a rota toda
  | "saida" // modelo não devolveu o formato pedido; outro modelo pode conseguir
  | "pedido"; // erro nosso (400 etc.); trocar de modelo não resolve

export class SemAlvoDisponivel extends Error {
  readonly falhas: { alvo: Alvo; tipo: TipoFalha; erro: unknown }[];
  constructor(falhas: { alvo: Alvo; tipo: TipoFalha; erro: unknown }[]) {
    const resumo = falhas.map((f) => `${f.alvo.rota}/${f.alvo.modelo}: ${f.tipo}`).join("; ");
    super(`Nenhum modelo de IA respondeu (${resumo || "nenhum alvo configurado"}).`);
    this.name = "SemAlvoDisponivel";
    this.falhas = falhas;
  }
}

/** Tempo de descanso de um alvo depois de cada tipo de falha. */
const DESCANSO_MS: Record<TipoFalha, number> = {
  limite: 60_000,
  indisponivel: 20_000,
  chave: 10 * 60_000,
  saida: 0,
  pedido: 0,
};

export class Disjuntor {
  private ate = new Map<string, number>();
  private agora: () => number;
  constructor(agora: () => number = Date.now) {
    this.agora = agora;
  }
  private chave(rota: string, modelo?: string) {
    return modelo ? `${rota}\u0000${modelo}` : rota;
  }
  aberto(alvo: Alvo): boolean {
    const t = this.agora();
    return (this.ate.get(this.chave(alvo.rota)) ?? 0) > t || (this.ate.get(this.chave(alvo.rota, alvo.modelo)) ?? 0) > t;
  }
  registrar(alvo: Alvo, tipo: TipoFalha) {
    const ms = DESCANSO_MS[tipo];
    if (!ms) return;
    const k = tipo === "chave" ? this.chave(alvo.rota) : this.chave(alvo.rota, alvo.modelo);
    this.ate.set(k, this.agora() + ms);
  }
  limpar() {
    this.ate.clear();
  }
}

export type Tentativa<T> = { alvo: Alvo; tentativa: number; ok: true; valor: T; ms: number } | { alvo: Alvo; tentativa: number; ok: false; tipo: TipoFalha; erro: unknown; ms: number };

export async function comReserva<T>(opcoes: {
  alvos: readonly Alvo[];
  executar: (alvo: Alvo) => Promise<T>;
  classificar: (erro: unknown) => TipoFalha;
  disjuntor?: Disjuntor;
  aoTentar?: (t: Tentativa<T>) => void;
}): Promise<{ valor: T; alvo: Alvo; caiuNaReserva: boolean }> {
  const { alvos, executar, classificar, disjuntor, aoTentar } = opcoes;
  const falhas: { alvo: Alvo; tipo: TipoFalha; erro: unknown }[] = [];
  const rotasSemChave = new Set<string>();
  let tentativa = 0;

  // Se todos estiverem descansando, tenta mesmo assim: melhor arriscar que falhar sem tentar.
  const livres = alvos.filter((a) => !disjuntor?.aberto(a));
  const fila = livres.length ? livres : alvos;

  for (const alvo of fila) {
    if (rotasSemChave.has(alvo.rota)) continue;
    tentativa++;
    const inicio = performance.now();
    try {
      const valor = await executar(alvo);
      aoTentar?.({ alvo, tentativa, ok: true, valor, ms: Math.round(performance.now() - inicio) });
      return { valor, alvo, caiuNaReserva: alvo !== alvos[0] };
    } catch (erro) {
      const tipo = classificar(erro);
      aoTentar?.({ alvo, tentativa, ok: false, tipo, erro, ms: Math.round(performance.now() - inicio) });
      disjuntor?.registrar(alvo, tipo);
      falhas.push({ alvo, tipo, erro });
      if (tipo === "pedido") throw erro;
      if (tipo === "chave") rotasSemChave.add(alvo.rota);
    }
  }
  throw new SemAlvoDisponivel(falhas);
}
