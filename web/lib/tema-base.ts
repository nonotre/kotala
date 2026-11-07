// Sem "use client": app/layout.tsx, que é de servidor, lê estas constantes.

export type Tema = "claro" | "escuro";

/** Chave do localStorage e atributo do html. O script abaixo aplica antes da primeira pintura. */
export const CHAVE_TEMA = "tema";
export const ATRIBUTO_TEMA = "data-tema";

/** Vale quando não há tema salvo. A escolha final de produto ainda vai ser feita: troque só aqui. */
export const TEMA_PADRAO: Tema = "claro";

/** Tema do Carbon de cada tema nosso, para componentes que pedem por prop, como os gráficos. */
export const TEMA_CARBON = { claro: "g10", escuro: "g100" } as const;

/** Roda no head, antes da pintura, para a página não piscar no tema errado. */
export const SCRIPT_TEMA = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(CHAVE_TEMA)})}catch(e){}document.documentElement.setAttribute(${JSON.stringify(ATRIBUTO_TEMA)},t==="claro"||t==="escuro"?t:${JSON.stringify(TEMA_PADRAO)})})();`;
