"use client";

import { Button, Form, InlineLoading, InlineNotification, Link as CarbonLink, PasswordInput, Stack, TextInput } from "@carbon/react";
import { Chat, DocumentTasks, UserCertification } from "@carbon/react/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pagina } from "@/components/Pagina";
import { criarConta, entrar } from "@/lib/contas";
import { guardarSessao } from "./sessao";
import s from "./entrar.module.scss";

const PASSOS = [
  { icone: Chat, titulo: "Peça em uma mensagem.", texto: "O assistente entende o item, a quantidade e o prazo, no Telegram ou no navegador." },
  { icone: DocumentTasks, titulo: "Compare as propostas.", texto: "Cada fornecedor com o custo total, o frete e o prazo." },
  { icone: UserCertification, titulo: "Quem aprova é você.", texto: "A IA não fecha compra sozinha." },
];

type Modo = "entrar" | "criar";

/** Entrar ou criar conta. Login simples: usuário e senha conferidos no banco, sessão guardada neste navegador. */
export function Entrar() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("entrar");
  const [nome, setNome] = useState("");
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = modo === "entrar" ? await entrar(login, senha) : await criarConta(nome, login, senha);
      if (!r.ok) {
        setErro(r.erro);
        setEnviando(false);
        return;
      }
      guardarSessao(r.sessao);
      router.push("/");
    } catch {
      setErro("Não deu para falar com o servidor. Tente de novo.");
      setEnviando(false);
    }
  }

  function trocarModo(m: Modo) {
    setModo(m);
    setErro(null);
  }

  return (
    <Pagina>
      <div className={s.tela}>
        <section className={s.formulario}>
          <Form
            className={s.miolo}
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <Stack gap={6}>
              <div className={s.topo}>
                <h1 className={s.titulo}>{modo === "entrar" ? "Entrar" : "Criar conta"}</h1>
                <p className={s.frase}>
                  {modo === "entrar"
                    ? "Cada pessoa tem a sua conta e o seu chat. Os pedidos de todos aparecem para todos, com o nome de quem pediu."
                    : "Escolha um nome de usuário e uma senha. A conta fica pronta na hora."}
                </p>
              </div>
              <Stack gap={5}>
                {modo === "criar" ? (
                  <TextInput id="entrar-nome" labelText="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
                ) : null}
                <TextInput
                  id="entrar-login"
                  labelText="Usuário"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  helperText={modo === "criar" ? "Letras minúsculas, números, ponto, hífen ou sublinhado." : undefined}
                  required
                />
                <PasswordInput
                  id="entrar-senha"
                  labelText="Senha"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                  helperText={modo === "entrar" ? "Primeira entrada numa conta criada para você: a senha que digitar passa a ser a sua." : undefined}
                  required
                />
              </Stack>
              {erro ? <InlineNotification kind="error" lowContrast hideCloseButton title={erro} className={s.aviso} /> : null}
              <div className={s.acoes}>
                {enviando ? (
                  <div className={s.entrando}>
                    <InlineLoading status="active" description={modo === "entrar" ? "Entrando" : "Criando a conta"} iconDescription="Carregando" />
                  </div>
                ) : (
                  <Button type="submit">{modo === "entrar" ? "Entrar" : "Criar conta e entrar"}</Button>
                )}
              </div>
              <p className={s.frase}>
                {modo === "entrar" ? (
                  <>
                    Primeira vez aqui?{" "}
                    <CarbonLink href="#" onClick={(e) => (e.preventDefault(), trocarModo("criar"))}>
                      Criar conta
                    </CarbonLink>
                  </>
                ) : (
                  <>
                    Já tem conta?{" "}
                    <CarbonLink href="#" onClick={(e) => (e.preventDefault(), trocarModo("entrar"))}>
                      Entrar
                    </CarbonLink>
                  </>
                )}
              </p>
            </Stack>
          </Form>
        </section>

        <aside className={`cds--g100 ${s.painel}`} aria-label="O que o Kotala faz">
          <div className={s.painelMiolo}>
            <img src="/logo-branco.svg" alt="Kotala" className={s.logo} />
            <p className={s.promessa}>Do pedido em uma mensagem à compra aprovada.</p>
            <ul className={s.passos}>
              {PASSOS.map(({ icone: Icone, titulo, texto }) => (
                <li key={titulo} className={s.passo}>
                  <Icone size={24} className={s.passoIcone} aria-hidden="true" />
                  <div>
                    <p className={s.passoTitulo}>{titulo}</p>
                    <p className={s.passoTexto}>{texto}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </Pagina>
  );
}
