import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import { adaptadorTelegram, dividirTexto, montarTeclado } from "../src/canais/telegram.ts";
import { tecladoAposClique } from "../src/fluxo/componentes/botoes.ts";
import { pagamentoCombinado } from "../src/fluxo/decisao.ts";
import { citacaoExpansivel, escaparHtml, html, htmlParaTexto, negrito } from "../src/texto.ts";

test("dividirTexto: não corta em silêncio e respeita o limite", () => {
  const paragrafos = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} ` + "x".repeat(300));
  const texto = paragrafos.join("\n\n");
  const partes = dividirTexto(texto, 4096);
  assert.ok(partes.length > 1);
  assert.ok(partes.every((p) => p.length <= 4096));
  assert.equal(partes.join("\n\n"), texto);
  const longa = "palavra ".repeat(1500);
  const cortes = dividirTexto(longa, 4096);
  assert.ok(cortes.every((p) => p.length <= 4096));
  assert.equal(cortes.join(" ").replace(/\s+/g, " ").trim(), longa.trim());
  assert.deepEqual(dividirTexto("curto"), ["curto"]);
});

test("HTML: escape central e helpers", () => {
  assert.equal(escaparHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  const h = html`Total ${negrito("R$ 10 <x>")} de ${"A&B"}`;
  assert.equal(h.valor, "Total <b>R$ 10 &lt;x&gt;</b> de A&amp;B");
  assert.equal(htmlParaTexto(citacaoExpansivel("a < b").valor), "a < b");
});

test("tecladoAposClique: só tira quando a ação é final", () => {
  for (const d of ["item:1:aprovar:x", "item:1:outras", "item:1:motivos", "item:1:voltar", "item:1:cancelar"]) assert.equal(tecladoAposClique(d), "manter", d);
  for (const d of ["item:1:confirmar:x", "item:1:reprovar", "item:1:cancelar:preco", "compra:1:confirmo", "cad:cat:2"]) assert.equal(tecladoAposClique(d), "tirar", d);
});

test("montarTeclado: cor e limite de 64 bytes", () => {
  const t = montarTeclado([{ rotulo: "Sim", dado: "a", estilo: "sucesso" }, { rotulo: "Não", dado: "b", estilo: "perigo" }, { rotulo: "Talvez", dado: "c" }]);
  const b = t.inline_keyboard.flat() as { style?: string }[];
  assert.deepEqual(b.map((x) => x.style), ["success", "danger", undefined]);
  assert.throws(() => montarTeclado([{ rotulo: "x", dado: "é".repeat(33) }]), /bytes/);
  montarTeclado([{ rotulo: "x", dado: "é".repeat(32) }]);
});

test("adaptador: divide, põe botões na última, cai para texto simples se o HTML for recusado", async () => {
  const enviadas: { texto: string; op: Record<string, unknown> }[] = [];
  let recusarHtml = true;
  const api = {
    async sendMessage(_c: string, texto: string, op: Record<string, unknown>) {
      if (op.parse_mode && recusarHtml) throw new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, "sendMessage", {});
      enviadas.push({ texto, op });
      return { message_id: enviadas.length };
    },
    async sendDocument() {
      return { message_id: 99 };
    },
  };
  const a = adaptadorTelegram({ comprador: { api } as unknown as Bot });
  const longo = Array.from({ length: 20 }, () => "y".repeat(500)).join("\n\n");
  const r = await a.enviar("comprador:1", longo, { botoes: [{ rotulo: "Ok", dado: "x" }] });
  assert.equal(enviadas.length, 3);
  assert.ok(enviadas.slice(0, -1).every((e) => !e.op.reply_markup) && enviadas.at(-1)!.op.reply_markup);
  assert.equal(r.idExterno, "3");
  enviadas.length = 0;
  await a.enviar("comprador:1", "<b>oi</b> a &lt; b", { formato: "html" });
  assert.equal(enviadas[0]!.texto, "oi a < b");
  assert.equal(enviadas[0]!.op.parse_mode, undefined);
  recusarHtml = false;
  enviadas.length = 0;
  await a.enviar("comprador:1", "<b>oi</b>", { formato: "html" });
  assert.equal(enviadas[0]!.op.parse_mode, "HTML");
});

test("pagamentoCombinado (U1.1)", () => {
  assert.equal(pagamentoCombinado({ pagamento: "Boleto", prazoPagamentoDias: 28 }), "Boleto (28 dias para pagar)");
  assert.equal(pagamentoCombinado({ pagamento: "Pix à vista.", prazoPagamentoDias: null }), "Pix à vista");
  assert.equal(pagamentoCombinado({ pagamento: "boleto 28 dias", prazoPagamentoDias: 28 }), "boleto 28 dias");
  assert.equal(pagamentoCombinado({ pagamento: null, prazoPagamentoDias: null }), "a combinar com o comprador");
});
