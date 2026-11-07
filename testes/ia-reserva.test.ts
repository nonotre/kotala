import assert from "node:assert/strict";
import { test } from "node:test";
import { alvosDoPapel, rotasDoAmbiente } from "../src/nucleo/ia/config.ts";
import { comReserva, Disjuntor, SemAlvoDisponivel, type Alvo, type TipoFalha } from "../src/nucleo/ia/reserva.ts";

class Falha extends Error {
  tipo: TipoFalha;
  constructor(tipo: TipoFalha) {
    super(tipo);
    this.tipo = tipo;
  }
}
const classificar = (e: unknown) => (e instanceof Falha ? e.tipo : "indisponivel");

const env = { GEMINI_API_KEY: "a", GEMINI_API_KEY_RESERVA: "b", IA_MODELOS_RAPIDO: "m1,m2" } as NodeJS.ProcessEnv;

test("principal antes da reserva, todos os modelos de cada uma", () => {
  const alvos = alvosDoPapel("rapido", rotasDoAmbiente(env), env);
  assert.deepEqual(alvos.map((a) => `${a.rota}/${a.modelo}`), ["principal/m1", "principal/m2", "reserva/m1", "reserva/m2"]);
});

test("reserva repetindo a mesma chave é ignorada", () => {
  assert.equal(rotasDoAmbiente({ GEMINI_API_KEY: "a", GEMINI_API_KEY_RESERVA: "a" } as NodeJS.ProcessEnv).length, 1);
});

test("429 troca de modelo; chave inválida pula a rota inteira", async () => {
  const alvos = alvosDoPapel("rapido", rotasDoAmbiente(env), env);
  const tentados: string[] = [];
  const r = await comReserva({
    alvos,
    classificar,
    executar: async (a: Alvo) => {
      tentados.push(`${a.rota}/${a.modelo}`);
      if (a.modelo === "m1" && a.rota === "principal") throw new Falha("limite");
      if (a.rota === "principal") throw new Falha("chave");
      return "ok";
    },
  });
  assert.equal(r.valor, "ok");
  assert.equal(r.caiuNaReserva, true);
  assert.deepEqual(tentados, ["principal/m1", "principal/m2", "reserva/m1"]);
});

test("erro nosso não tenta outro modelo", async () => {
  const alvos = alvosDoPapel("rapido", rotasDoAmbiente(env), env);
  let n = 0;
  await assert.rejects(
    comReserva({ alvos, classificar, executar: async () => { n++; throw new Falha("pedido"); } }),
    Falha,
  );
  assert.equal(n, 1);
});

test("tudo falhando dá SemAlvoDisponivel", async () => {
  const alvos = alvosDoPapel("rapido", rotasDoAmbiente(env), env);
  await assert.rejects(comReserva({ alvos, classificar, executar: async () => { throw new Falha("indisponivel"); } }), SemAlvoDisponivel);
});

test("disjuntor deixa o alvo que deu 429 descansar", async () => {
  let agora = 0;
  const disjuntor = new Disjuntor(() => agora);
  const alvos = alvosDoPapel("rapido", rotasDoAmbiente(env), env);
  const tentados: string[] = [];
  const executar = async (a: Alvo) => {
    tentados.push(a.modelo + "@" + a.rota);
    if (a.rota === "principal" && a.modelo === "m1") throw new Falha("limite");
    return a;
  };
  await comReserva({ alvos, classificar, executar, disjuntor });
  tentados.length = 0;
  await comReserva({ alvos, classificar, executar, disjuntor });
  assert.deepEqual(tentados, ["m2@principal"]);
  agora = 61_000;
  tentados.length = 0;
  await comReserva({ alvos, classificar, executar, disjuntor });
  assert.deepEqual(tentados, ["m1@principal", "m2@principal"]);
});

test("prompt do rastro troca os bytes do anexo por tipo, tamanho e hash", async () => {
  process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";
  const { textoDoPrompt } = await import("../src/nucleo/ia/index.ts");
  const t = textoDoPrompt("regras", [{ role: "user", content: [{ type: "text", text: "leia" }, { type: "file", data: new Uint8Array([1, 2, 3]), mediaType: "application/pdf" }] }]);
  assert.match(t, /\[sistema\]\nregras/);
  assert.match(t, /\[arquivo application\/pdf, 3 bytes, sha256 [0-9a-f]{16}\]/);
});
