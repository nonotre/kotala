// PDF mínimo de uma página com linhas de texto (Helvetica, WinAnsi), para a persona
// que responde em PDF. Sem dependência: o arquivo é montado à mão.

/** Texto em Latin-1 com os caracteres especiais do PDF escapados. */
function textoPdf(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\xff]/g, "?");
}

export function pdfDeTexto(linhas: readonly string[]): Uint8Array {
  const conteudo = ["BT", "/F1 12 Tf", "14 TL", "50 790 Td", ...linhas.map((l, i) => `${i ? "T* " : ""}(${textoPdf(l)}) Tj`), "ET"].join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(conteudo, "latin1")} >>\nstream\n${conteudo}\nendstream`,
  ];
  let corpo = "%PDF-1.4\n";
  const posicoes: number[] = [];
  objetos.forEach((o, i) => {
    posicoes.push(Buffer.byteLength(corpo, "latin1"));
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corpo, "latin1");
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posicoes.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(corpo, "latin1"));
}
