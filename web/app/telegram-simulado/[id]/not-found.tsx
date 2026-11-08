import Link from "next/link";
import s from "../telegram.module.scss";

/** Id que não é de um chat simulado: sem detalhe do erro, com o caminho para a lista. */
export default function ChatNaoEncontrado() {
  return (
    <main id="conteudo" className={s.tela}>
      <div className={s.faixa} role="note">
        <span>
          <span className={s.faixaTitulo}>Telegram simulado</span> — Nada aqui vai para um Telegram de verdade.
        </span>
      </div>
      <div className={s.naoEncontrado}>
        <h1 className={s.naoEncontradoTitulo}>Chat não encontrado</h1>
        <p>Este endereço não é de um fornecedor simulado. Pode ser um link antigo ou incompleto.</p>
        <Link href="/telegram-simulado">Ver todos os chats simulados</Link>
      </div>
    </main>
  );
}
