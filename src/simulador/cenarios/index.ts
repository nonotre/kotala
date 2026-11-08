// Cenários do simulador (3.4), na ordem em que `npm run simulador -- todos` roda.

import { desconto } from "./desconto.ts";
import { feliz } from "./feliz.ts";
import { pararCotacao } from "./parar.ts";
import { prazo } from "./prazo.ts";
import { servico } from "./servico.ts";
import { sobe } from "./sobe-preco.ts";
import type { Cenario } from "./tipos.ts";

export const CENARIOS: Cenario[] = [feliz, prazo, desconto, pararCotacao, sobe, servico];

export const cenarioPorChave = (chave: string) => CENARIOS.find((c) => c.chave === chave) ?? null;

export type { Cenario } from "./tipos.ts";
