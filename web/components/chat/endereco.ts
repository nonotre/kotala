// Endereço do chat web deste navegador: um id aleatório guardado no navegador. Ainda sem login,
// é ele que diz qual conversa é deste navegador, e só ela aceita envio.

const CHAVE = "kotala-chat";

export function enderecoDoNavegador(): string {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo) return salvo;
    const novo = crypto.randomUUID();
    localStorage.setItem(CHAVE, novo);
    return novo;
  } catch {
    return crypto.randomUUID();
  }
}
