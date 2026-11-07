import { Chat } from "@/components/Chat";
import estilos from "../comum.module.scss";

export default function Conversar() {
  return (
    <>
      <h1 className={estilos.titulo}>Conversar com o assistente</h1>
      <p className={estilos.sub}>O mesmo assistente do Telegram, aqui no navegador. Escreva o que precisa comprar, do seu jeito.</p>
      <Chat />
    </>
  );
}
