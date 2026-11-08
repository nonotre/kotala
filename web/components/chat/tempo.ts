// Hora das conversas, no fuso de quem compra.

const FUSO = "America/Sao_Paulo";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });

/** "agora", "há 5 min", "há 2 h", "ontem", "03/11". */
export function horaRelativa(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  const passou = agora.getTime() - d.getTime();
  if (passou < MINUTO) return "agora";
  if (passou < HORA) return `há ${Math.floor(passou / MINUTO)} min`;
  if (dia(d) === dia(agora)) return `há ${Math.floor(passou / HORA)} h`;
  if (dia(d) === dia(new Date(agora.getTime() - 24 * HORA))) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
}

/** Data e hora completas, para o `title` e para o leitor de tela. */
export function horaCompleta(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: FUSO });
}

/** Só a hora, abaixo de cada mensagem. */
export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
}
