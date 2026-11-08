// Preenche, no banco, a categoria que ficou vazia em itens e fornecedores. Só preenche vazio, nunca
// sobrescreve, apaga nem mexe em estado. Cada valor vem das regras que o projeto já tem.
//
//   node --env-file=.env scripts/preencher-categorias.ts            # ensaio: só mostra o que mudaria
//   node --env-file=.env scripts/preencher-categorias.ts --gravar   # grava, numa transação
//
// 1. item_pedido.categoria nulo: categoriaDoItem (a da base de itens, ou a deduzida pelas palavras).
// 2. item_catalogo.categoria nulo (ou "Cadastrado pelo agente"): categoriaProvavel da descrição.
// 3. fornecedor.categorias vazio:
//    - real que é loja conhecida (domínio da fonte em lojas.json): as categorias da loja;
//    - simulado: as da persona do simulador (base da Ester, áreas ou lista de obra);
//    - demais: as categorias dos itens de que mandaram proposta (oferta), sem repetir.
//    Sem dado que sustente, fica vazio (vazio = recebe tudo, como o cadastro já trata).

import { asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { conexao, db } from "../src/nucleo/db/cliente.ts";
import { fornecedor, itemCatalogo, itemPedido, oferta } from "../src/nucleo/db/schema.ts";
import { carregarCatalogo, SEM_CATEGORIA } from "../src/agentes/interpretador/catalogo.ts";
import { categoriaDoItem } from "../src/agentes/busca/index.ts";
import { categoriaPorId, categoriaPorNome, categoriaProvavel } from "../src/dominio/categorias.ts";
import { TODAS_PERSONAS } from "../src/simulador/personas.ts";
import { CATALOGO, CATEGORIAS_OBRA } from "../src/simulador/catalogo.ts";
import lojas from "../src/dominio/lojas.json" with { type: "json" };

const gravar = process.argv.includes("--gravar");
console.log(gravar ? "MODO GRAVAR (transação)\n" : "ENSAIO (nada é gravado; use --gravar)\n");

await carregarCatalogo();

type Troca = { tabela: string; campo: string; id: string | number; rotulo: string; de: unknown; para: unknown; motivo: string; aplicar: (tx: Tx) => Promise<number> };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const trocas: Troca[] = [];
const vazios: string[] = [];

// ---------- 1. item_pedido.categoria ----------
const itens = await db.select().from(itemPedido).orderBy(asc(itemPedido.id));
const categoriaDoPedido = new Map<number, string | null>(); // a gravada ou a deduzida (para a regra das ofertas)
for (const it of itens) {
  if (it.categoria) {
    categoriaDoPedido.set(it.id, it.categoria);
    continue;
  }
  const c = categoriaDoItem(it);
  categoriaDoPedido.set(it.id, c);
  if (!c) {
    vazios.push(`item_pedido #${it.id} "${it.descricao}": nenhuma categoria dedutível`);
    continue;
  }
  trocas.push({
    tabela: "item_pedido",
    campo: "categoria",
    id: it.id,
    rotulo: it.descricao,
    de: null,
    para: c,
    motivo: it.itemChave?.startsWith("ITM-") ? `base de itens (${it.itemChave}) ou palavras` : "base de itens por nome ou palavras",
    aplicar: async (tx) => (await tx.update(itemPedido).set({ categoria: c }).where(sql`${itemPedido.id} = ${it.id} and ${itemPedido.categoria} is null`)).count,
  });
}

// ---------- 2. item_catalogo.categoria ----------
const catalogo = await db.select().from(itemCatalogo).where(or(isNull(itemCatalogo.categoria), eq(itemCatalogo.categoria, SEM_CATEGORIA)));
for (const it of catalogo) {
  const c = categoriaProvavel(it.descricao);
  if (!c) {
    vazios.push(`item_catalogo ${it.codigo} "${it.descricao}": nenhuma categoria dedutível`);
    continue;
  }
  trocas.push({
    tabela: "item_catalogo",
    campo: "categoria",
    id: it.codigo,
    rotulo: it.descricao,
    de: it.categoria,
    para: c,
    motivo: "palavras da descrição",
    aplicar: async (tx) => (await tx.update(itemCatalogo).set({ categoria: c }).where(sql`${itemCatalogo.id} = ${it.id} and (${itemCatalogo.categoria} is null or ${itemCatalogo.categoria} = ${SEM_CATEGORIA})`)).count,
  });
}

// ---------- 3. fornecedor.categorias ----------
const dominioDe = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const lojaPorDominio = new Map(lojas.lojas.map((l) => [l.dominio.toLowerCase(), l]));
const nomesDe = (ids: string[]) => ids.map((id) => categoriaPorId(id)?.nome).filter((n): n is string => !!n);
const personaPorChave = new Map(TODAS_PERSONAS.map((p) => [p.chave, p]));
// Categorias de obra que a lista de preços do simulador de fato tem (é o que as personas de construção vendem).
const obraComPreco = CATEGORIAS_OBRA.filter((id) => CATALOGO.some((c) => c.categoria === id));

/** Categorias da persona do simulador, só com nomes que existem em categorias.json. */
function categoriasDaPersona(chave: string | null): { nomes: string[]; ignoradas: string[]; de: string } | null {
  const p = chave ? personaPorChave.get(chave) : undefined;
  if (!p) return null;
  const [brutas, de] = p.categorias ? [p.categorias, "base de fornecedores da Ester (personas.ts)"] : p.areas ? [nomesDe(p.areas), "áreas da persona (personas.ts)"] : [nomesDe(obraComPreco), "lista de preços de obra do simulador (vendeItem)"];
  const nomes: string[] = [];
  const ignoradas: string[] = [];
  for (const b of brutas) {
    const c = categoriaPorNome(b);
    if (c) nomes.push(c.nome);
    else ignoradas.push(b);
  }
  return { nomes: [...new Set(nomes)], ignoradas, de };
}

const forns = await db.select().from(fornecedor).where(sql`${fornecedor.categorias} = '[]'::jsonb`).orderBy(asc(fornecedor.numero));
const ofertas = forns.length
  ? await db.select({ fornecedorId: oferta.fornecedorId, itemPedidoId: oferta.itemPedidoId }).from(oferta).where(inArray(oferta.fornecedorId, forns.map((f) => f.id)))
  : [];

for (const f of forns) {
  const rotulo = `#${f.numero} ${f.nome}`;
  let nomes: string[] = [];
  let motivo = "";
  const aviso: string[] = [];

  const dominio = dominioDe(f.fonte);
  const loja = f.origem === "real" && dominio ? lojaPorDominio.get(dominio) : undefined;
  if (loja) {
    const ids: string[] | string = loja.categorias;
    if (typeof ids === "string") aviso.push("loja atende qualquer categoria (\"*\"): não preenche");
    else {
      nomes = nomesDe(ids);
      motivo = `loja conhecida ${loja.nome} (lojas.json)`;
    }
  } else if (f.origem === "simulado") {
    const p = categoriasDaPersona(f.chave);
    if (p) {
      nomes = p.nomes;
      motivo = `persona ${f.chave}: ${p.de}`;
      if (p.ignoradas.length) aviso.push(`categoria(s) da persona fora de categorias.json, não gravadas: ${p.ignoradas.join(", ")}`);
    }
  }
  if (!nomes.length && !aviso.some((a) => a.includes('"*"'))) {
    // Regra das ofertas: categorias dos itens para os quais mandou proposta.
    const doFornecedor = ofertas.filter((o) => o.fornecedorId === f.id);
    const cats = [...new Set(doFornecedor.map((o) => categoriaDoPedido.get(o.itemPedidoId)).filter((c): c is string => !!c))];
    if (cats.length) {
      nomes = cats;
      motivo = `ofertas enviadas (${doFornecedor.length})`;
    }
  }

  for (const a of aviso) vazios.push(`fornecedor ${rotulo}: ${a}`);
  if (!nomes.length) {
    vazios.push(`fornecedor ${rotulo} (${f.origem}${f.fonte ? `, ${f.fonte}` : ""}): sem loja conhecida, persona nem ofertas; fica vazio`);
    continue;
  }
  trocas.push({
    tabela: "fornecedor",
    campo: "categorias",
    id: f.numero,
    rotulo: f.nome,
    de: [],
    para: nomes,
    motivo,
    aplicar: async (tx) => (await tx.update(fornecedor).set({ categorias: nomes }).where(sql`${fornecedor.id} = ${f.id} and ${fornecedor.categorias} = '[]'::jsonb`)).count,
  });
}

// ---------- 4. outros campos ----------
// fornecedor.regiao e fornecedor.cep dos reais estão vazios e não há dado no próprio registro que os
// dê (a fonte é só um site); simulados já têm região. Nada a preencher com segurança.

// ---------- Resultado ----------
console.log("== O que muda ==");
for (const t of trocas) console.log(`${t.tabela}.${t.campo} [${t.id}] ${t.rotulo}: ${JSON.stringify(t.de)} -> ${JSON.stringify(t.para)}  (${t.motivo})`);
const porCampo = new Map<string, number>();
for (const t of trocas) porCampo.set(`${t.tabela}.${t.campo}`, (porCampo.get(`${t.tabela}.${t.campo}`) ?? 0) + 1);
console.log("\n== Totais ==");
for (const [k, n] of porCampo) console.log(`${k}: ${n}`);
console.log("\n== Fica vazio ==");
for (const v of vazios) console.log(v);

if (!gravar) {
  console.log("\nEnsaio: nada gravado.");
} else {
  let aplicadas = 0;
  await db.transaction(async (tx) => {
    for (const t of trocas) aplicadas += await t.aplicar(tx);
  });
  console.log(`\nGravado: ${aplicadas} de ${trocas.length} registros atualizados.`);
}
await conexao.end();
