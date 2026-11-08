// Personas de comprador por área, para o `npm run simular -- persona:<chave>` e para
// os casos do harness. O roteiro usa a mesma linguagem do simular-comprador:
// mensagem, "clicar:<rótulo>", "esperar:<estado>", "dormir:<s>".

export type PersonaComprador = {
  chave: string;
  /** Categoria do domínio (src/dominio/categorias.json) do pedido principal. */
  area: string;
  quem: string;
  roteiro: string[];
  /** O que o pedido deve virar: itens (palavra que aparece na descrição) e unidade esperada. */
  espera: { palavra: RegExp; unidade?: RegExp }[];
};

const ATE_MAPA = ["clicar:Confirmar", "esperar:aguardando_decisao"];

export const COMPRADORES: PersonaComprador[] = [
  {
    chave: "obra",
    area: "cimenticios",
    quem: "Mestre de obras, pedido curto e com jargão",
    roteiro: ["40 cp2 pra obra alfa até sexta", ...ATE_MAPA],
    espera: [{ palavra: /cimento/i, unidade: /saco/i }],
  },
  {
    chave: "escritorio",
    area: "escritorio",
    quem: "Assistente administrativa do escritório",
    roteiro: ["50 resmas de papel A4 75g pro escritório até sexta", ...ATE_MAPA],
    espera: [{ palavra: /papel|a4/i, unidade: /resma/i }],
  },
  {
    chave: "clips",
    area: "escritorio",
    quem: "Recepção, manda só o nome do produto",
    roteiro: ["clips de papel", "clicar:Sim", "20 caixas", ...ATE_MAPA],
    espera: [{ palavra: /clip/i, unidade: /caixa/i }],
  },
  {
    chave: "epi",
    area: "epi",
    quem: "Técnico de segurança do trabalho",
    roteiro: ["20 pares de luva de vaqueta com CA e 10 capacetes classe B pra equipe de manutenção", ...ATE_MAPA],
    espera: [{ palavra: /luva/i, unidade: /par/i }, { palavra: /capacete/i }],
  },
  {
    chave: "extintor",
    area: "extintores",
    quem: "Zeladoria, esquece o tamanho do extintor",
    roteiro: ["2 extintores ABC pro galpão", "6 kg", ...ATE_MAPA],
    espera: [{ palavra: /extintor/i }],
  },
  {
    chave: "limpeza",
    area: "limpeza",
    quem: "Encarregada da limpeza",
    roteiro: ["10 galões de desinfetante 5 L e 5 fardos de papel toalha interfolhado", ...ATE_MAPA],
    espera: [{ palavra: /desinfetante/i }, { palavra: /papel toalha|toalha/i }],
  },
  {
    chave: "informatica",
    area: "informatica",
    quem: "TI de uma empresa pequena",
    roteiro: ["3 notebooks i5 16 GB SSD 512 pro financeiro", ...ATE_MAPA],
    espera: [{ palavra: /notebook/i, unidade: /unidade/i }],
  },
  {
    chave: "copa",
    area: "copa",
    quem: "Copa do escritório, pedido do mês",
    roteiro: ["10 kg de café e 20 pacotes de copo descartável 200 ml pra copa", ...ATE_MAPA],
    espera: [{ palavra: /caf[eé]/i, unidade: /kg|pacote/i }, { palavra: /copo/i }],
  },
];

export const compradorPorChave = (chave: string) => COMPRADORES.find((c) => c.chave === chave) ?? null;
