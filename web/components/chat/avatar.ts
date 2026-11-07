// Rosto do assistente na conversa: sem esta imagem, o chat da Carbon mostra a marca padrão do pacote.
// É o mesmo balão do item Conversar, no menu. Uma imagem não lê os tokens do tema: o cinza 60 serve aos dois temas.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="16" fill="#6f6f6f"/>' +
  '<g fill="#fff" transform="translate(6.4 6.4) scale(.6)">' +
  '<path d="M17.74,30,16,29l4-7h6a2,2,0,0,0,2-2V8a2,2,0,0,0-2-2H6A2,2,0,0,0,4,8V20a2,2,0,0,0,2,2h9v2H6a4,4,0,0,1-4-4V8A4,4,0,0,1,6,4H26a4,4,0,0,1,4,4V20a4,4,0,0,1-4,4H21.16Z"/>' +
  '<path d="M8 10H24V12H8z"/><path d="M8 16H18V18H8z"/>' +
  "</g></svg>";

export const AVATAR_ASSISTENTE = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
