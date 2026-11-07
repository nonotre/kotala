// Jargão de obra que o Interpretador precisa reconhecer. Vai no prompt como
// referência; não é uma lista fechada.

export const JARGAO: { termo: string; significa: string }[] = [
  { termo: "cp2, cp 2, cp-ii", significa: "Cimento Portland CP II (E, F ou Z), saco de 50 kg se não disser outro peso" },
  { termo: "cp3, cp 3", significa: "Cimento Portland CP III, saco de 50 kg" },
  { termo: "cp5, cp v, ari", significa: "Cimento CP V-ARI (alta resistência inicial), saco de 40 ou 50 kg" },
  { termo: "ferro 5/16", significa: "Vergalhão CA-50 8 mm, barra de 12 m" },
  { termo: "ferro 3/8", significa: "Vergalhão CA-50 10 mm, barra de 12 m" },
  { termo: "ferro 1/2", significa: "Vergalhão CA-50 12,5 mm, barra de 12 m" },
  { termo: "ferro 4.2, ca-60", significa: "Vergalhão CA-60 4,2 mm (estribo), barra de 12 m" },
  { termo: "carrada, caçamba, caminhão", significa: "carga de caminhão basculante; o volume varia (cerca de 5 a 8 m³). Manter a unidade 'carrada' e perguntar o volume só se for essencial" },
  { termo: "milheiro", significa: "1.000 unidades (tijolo, bloco, telha)" },
  { termo: "tijolo baiano", significa: "Tijolo cerâmico de 8 furos" },
  { termo: "bloco 14, bloco 19", significa: "Bloco de concreto 14x19x39 ou 19x19x39 cm" },
  { termo: "brita 0, brita 1, pedrisco", significa: "Pedra britada pela graduação; pedrisco é brita 0" },
  { termo: "areia fina, média, grossa", significa: "Areia lavada pela granulometria" },
  { termo: "ac1, ac2, ac3", significa: "Argamassa colante AC-I, AC-II ou AC-III, saco de 20 kg" },
  { termo: "metro, m3, metro cúbico", significa: "m³ quando o item é areia, brita ou concreto" },
  { termo: "tubo 100, cano de 100", significa: "Tubo de PVC esgoto 100 mm, barra de 6 m" },
  { termo: "obra parada", significa: "urgência máxima: o prazo pesa mais que o preço" },
];

export function textoJargao(): string {
  return JARGAO.map((j) => `- ${j.termo}: ${j.significa}`).join("\n");
}
