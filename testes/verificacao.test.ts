import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { acharCnpjs, cnpjValido, formatarCnpj } from "../src/agentes/verificacao/cnpj.ts";
import { julgar, type EntradaJulgamento } from "../src/agentes/verificacao/confianca.ts";
import { lerCsv, primeiroArquivoDoZip } from "../src/agentes/verificacao/sancoes.ts";
import { lerResultadoTjsp } from "../src/agentes/verificacao/tjsp.ts";

test("dígitos do CNPJ", () => {
  assert.ok(cnpjValido("03.840.986/0056-70"));
  assert.ok(!cnpjValido("03.840.986/0056-71"));
  assert.ok(!cnpjValido("11111111111111"));
  assert.ok(!cnpjValido("00.000.000/0001-00"));
  assert.equal(formatarCnpj("03840986005670"), "03.840.986/0056-70");
  assert.deepEqual(acharCnpjs("rodapé 03.840.986/0056-70 e lixo 03055555555555 e 03840986005670"), ["03840986005670"]);
});

const base: EntradaJulgamento = {
  simulado: false, homologado: false, cnpj: null, cnpjInexistente: false, consultaIndisponivel: false,
  presencaVerificavel: false, categorias: ["Cimentícios"], compras: 0, prazosCumpridos: 0, prazosAvaliados: 0, hoje: new Date("2026-11-07"),
};
const ativa = { cnpj: "03840986005670", razaoSocial: "LOJA EXEMPLO LTDA", nomeFantasia: null, situacao: "ATIVA", abertura: "2013-08-16", municipio: "SAO PAULO", uf: "SP", atividade: "Comércio varejista de materiais de construção", matrizOuFilial: "FILIAL", fonte: "BrasilAPI" as const };

test("loja com CNPJ ativo, na área, antiga, com site e sem sanção: confiança alta", () => {
  const j = julgar({ ...base, cnpj: ativa, presencaVerificavel: true, sancoes: { base: "06/11/2026", vigentes: [], encerradas: 0 } });
  assert.equal(j.nivel, "alta");
  assert.ok(j.verificado);
  assert.deepEqual(j.alertas, []);
});

test("CNPJ baixado derruba e alerta", () => {
  const j = julgar({ ...base, cnpj: { ...ativa, situacao: "BAIXADA" }, presencaVerificavel: true });
  assert.equal(j.nivel, "baixa");
  assert.ok(!j.verificado);
  assert.ok(j.alertas.some((a) => a.includes("baixada")));
});

test("sanção vigente no CEIS derruba e alerta", () => {
  const j = julgar({ ...base, cnpj: ativa, presencaVerificavel: true, sancoes: { base: "06/11/2026", vigentes: [{ cadastro: "CEIS", categoria: "Suspensão", orgao: "Prefeitura X", fim: "19/11/2027", mesmaUnidade: true }], encerradas: 0 } });
  assert.notEqual(j.nivel, "alta");
  assert.ok(j.alertas.some((a) => a.includes("CEIS: Suspensão")));
});

test("falência no TJSP alerta; TJSP fora do ar não pune", () => {
  const grave = julgar({ ...base, cnpj: ativa, presencaVerificavel: true, tjsp: { disponivel: true, processos: 3, classesGraves: ["Falência de Empresários"] } });
  const fora = julgar({ ...base, cnpj: ativa, presencaVerificavel: true, tjsp: { disponivel: false, motivo: "TJSP em manutenção" } });
  const semTjsp = julgar({ ...base, cnpj: ativa, presencaVerificavel: true });
  assert.ok(grave.alertas.some((a) => /falência/i.test(a)));
  assert.equal(fora.pontos, semTjsp.pontos);
  assert.ok(fora.motivos.some((m) => m.includes("manutenção")));
});

test("empresa nova, fora da área e sem presença: baixa", () => {
  const j = julgar({ ...base, cnpj: { ...ativa, abertura: "2026-06-01", atividade: "Restaurantes e similares" } });
  assert.equal(j.nivel, "baixa");
  assert.ok(j.alertas.length >= 2);
});

test("histórico e homologação sobem; atraso alerta", () => {
  const bom = julgar({ ...base, cnpj: ativa, compras: 3, prazosCumpridos: 3, prazosAvaliados: 3, homologado: true });
  const atrasa = julgar({ ...base, cnpj: ativa, compras: 3, prazosCumpridos: 1, prazosAvaliados: 3 });
  assert.ok(bom.pontos > atrasa.pontos);
  assert.ok(atrasa.alertas.includes("Histórico de atraso na entrega"));
});

test("simulado não é verificado", () => {
  assert.equal(julgar({ ...base, simulado: true }).nivel, "simulado");
});

test("CSV do Portal e zip", () => {
  const csv = '"CADASTRO";"NOME"\n"CEIS";"LOJA ""X"" LTDA"\n"CNEP";"Y; Z"\n';
  assert.deepEqual(lerCsv(csv), [["CADASTRO", "NOME"], ["CEIS", 'LOJA "X" LTDA'], ["CNEP", "Y; Z"]]);
  // zip mínimo de um arquivo, com deflate
  const conteudo = Buffer.from("ola;mundo\n");
  const comp = deflateRawSync(conteudo);
  const nome = Buffer.from("a.csv");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(conteudo.length, 22); local.writeUInt16LE(nome.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(conteudo.length, 24); cd.writeUInt16LE(nome.length, 28); cd.writeUInt32LE(0, 42);
  const inicioCd = local.length + nome.length + comp.length;
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(cd.length + nome.length, 12); fim.writeUInt32LE(inicioCd, 16);
  const zip = Buffer.concat([local, nome, comp, cd, nome, fim]);
  assert.equal(Buffer.from(primeiroArquivoDoZip(zip)).toString(), "ola;mundo\n");
});

// Formato do e-SAJ presumido (o site estava em manutenção em 07 e 08/11/2026).
test("leitura da página do TJSP", () => {
  const u = "https://esaj.tjsp.jus.br/x";
  assert.deepEqual(lerResultadoTjsp("<div>Não existem informações disponíveis para os parâmetros informados.</div>", u), { disponivel: true, processos: 0, classesGraves: [], url: u });
  const r = lerResultadoTjsp('<span>12 Processos encontrados</span><div class="classeProcesso">Falência de Empresários</div><div class="classeProcesso">Procedimento Comum Cível</div>', u);
  assert.ok(r.disponivel && r.processos === 12 && r.classesGraves[0] === "Falência de Empresários");
  assert.equal(lerResultadoTjsp("<div>captcha</div>", u).disponivel, false);
  assert.equal(lerResultadoTjsp("<html>algo diferente</html>", u).disponivel, false);
});

test("Portal da Transparência: indicadores da pessoa jurídica", async () => {
  const { lerPessoaJuridica } = await import("../src/agentes/verificacao/portal.ts");
  const p = lerPessoaJuridica({ cnpj: "x", sancionadoCEIS: true, sancionadoCNEP: false, possuiContratacao: true, emitiuNFe: true });
  assert.deepEqual(p.sancoes, ["CEIS"]);
  assert.ok(p.forneceGoverno);
  const j = julgar({ ...base, cnpj: ativa, presencaVerificavel: true, portal: p, sancoes: { base: "06/11/2026", vigentes: [], encerradas: 0 } });
  assert.ok(j.alertas.some((a) => a.includes("CEIS") && a.includes("Portal")));
  const limpa = julgar({ ...base, cnpj: ativa, presencaVerificavel: true, portal: lerPessoaJuridica({ possuiContratacao: true }) });
  assert.ok(limpa.motivos.some((m) => m.startsWith("Já fornece ao governo federal")));
});
