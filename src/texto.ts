// Formatação de texto para as mensagens, igual em todos os agentes.

export const fmtNumero = (n: number | string) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Plural só para exibição: "saco" → "sacos"; unidades de medida (m³, kg) não mudam. */
export function plural(unidade: string, quantidade: number | string): string {
  const u = unidade.trim();
  if (Number(quantidade) <= 1 || /[0-9³²]|^(kg|g|m|l|ml|cm|mm|un)$/i.test(u) || /s$/i.test(u)) return u;
  if (/[rz]$/i.test(u)) return `${u}es`;
  if (/m$/i.test(u)) return `${u.slice(0, -1)}ns`;
  if (/[aeiou]$/i.test(u)) return `${u}s`;
  return u;
}

/** "40 sacos", "1 saco", "2,5 m³". */
export const quantidade = (q: number | string, unidade: string) => `${fmtNumero(q)} ${plural(unidade, q)}`;

/** "1 dia", "3 dias". */
export const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

/** "10 placas de isopor (EPS)" em vez de "10 placas de Placa de isopor (EPS)". */
export function quantidadeDe(q: number | string, unidade: string, descricao: string): string {
  const sem = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const [primeira, ...resto] = descricao.trim().split(/\s+/);
  const repete = primeira && resto.length && sem(primeira) === sem(unidade.trim());
  const nome = repete ? resto.join(" ").replace(/^(de|da|do)\s+/i, "") : descricao;
  return `${quantidade(q, unidade)} de ${nome}`;
}

/** Motivos de cancelamento (regra da área de compras: todo cancelamento tem justificativa). */
export const MOTIVOS_CANCELAMENTO = {
  nao_preciso: "Não preciso mais",
  comprei: "Já comprei por outro meio",
  errado: "Pedido errado",
  preco: "Preço acima do esperado",
  outro: "Outro motivo",
} as const;
export type MotivoCancelamento = keyof typeof MOTIVOS_CANCELAMENTO;

const SP = "America/Sao_Paulo";
const diaSP = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: SP });

/** "às 14:30" se for hoje; "em 10/11 às 14:30" se for outro dia (prazos de dias no modo real). */
export function quando(d: Date, agora = new Date()): string {
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: SP });
  if (diaSP(d) === diaSP(agora)) return `às ${h}`;
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: SP })} às ${h}`;
}

/** Nome legível do pedido: "Pedido 11 · Placa de Inox 304 (+1 item) · setor Comunicação". */
export function nomePedido(p: { id: number; setor?: string | null }, itens: readonly { descricao: string }[] = []): string {
  const partes = [`Pedido ${p.id}`];
  if (itens.length) partes.push(`${itens[0]!.descricao}${itens.length > 1 ? ` (+${itens.length - 1} ${itens.length === 2 ? "item" : "itens"})` : ""}`);
  if (p.setor) partes.push(`setor ${p.setor}`);
  return partes.join(" · ");
}

// ---------- HTML do Telegram (U6) ----------
// Todo texto do sistema é texto simples. Só vira HTML o que for montado com os
// helpers abaixo e enviado com `formato: "html"`; todo texto de fora passa por
// escaparHtml, então `<`, `>` e `&` nunca são lidos como marcação.

/** Trecho de HTML já seguro (montado pelos helpers); distingue de texto simples. */
export class Html {
  readonly valor: string;
  constructor(valor: string) {
    this.valor = valor;
  }
  toString() {
    return this.valor;
  }
}

export const escaparHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const paraHtml = (p: string | number | Html) => (p instanceof Html ? p.valor : escaparHtml(String(p)));

/** Template que escapa o que for texto simples e deixa passar o que já é Html. */
export function html(partes: TemplateStringsArray, ...valores: (string | number | Html)[]): Html {
  return new Html(partes.reduce((acc, p, i) => acc + p + (i < valores.length ? paraHtml(valores[i]!) : ""), ""));
}

export const negrito = (t: string | number | Html) => new Html(`<b>${paraHtml(t)}</b>`);
export const italico = (t: string | number | Html) => new Html(`<i>${paraHtml(t)}</i>`);
export const codigo = (t: string | number | Html) => new Html(`<code>${paraHtml(t)}</code>`);
/** Detalhes que aparecem em 3 linhas, com "ver mais" (não aninha com outra citação). */
export const citacaoExpansivel = (t: string | number | Html) => new Html(`<blockquote expandable>${paraHtml(t)}</blockquote>`);

/** Texto simples equivalente a um HTML dos helpers, para canais sem HTML e para o registro. */
export function htmlParaTexto(h: string): string {
  return h
    .replace(/<\/?blockquote[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
