# kotala

Agentes de IA para cotação de compras de material de obra.

Como tudo funciona, passo a passo: [docs/arquitetura.md](docs/arquitetura.md). Decisões: [docs/decisoes.md](docs/decisoes.md). Trabalho em paralelo com worktrees: [docs/frentes.md](docs/frentes.md).

## Rodar

Requer Node 26 ou maior e Docker.

```bash
npm ci
cp .env.exemplo .env            # troque a senha e preencha as chaves
npm run db:subir                # Postgres com pgvector, em 127.0.0.1:5433
npm run db:migrar
npm run checar                  # tipos + testes
npm run ia:testar               # chamada real ao Gemini
```

### Bots do Telegram

Crie dois bots no @BotFather e ponha os tokens em `TELEGRAM_TOKEN_COMPRADOR` e `TELEGRAM_TOKEN_FORNECEDOR` no `.env`.

```bash
npm run bots                    # na máquina
docker compose up -d --build    # ou tudo em container: banco + bots (aplica as migrações ao subir)
docker compose logs -f bots
```

Rode só um dos dois: o mesmo token em dois processos dá erro 409 no Telegram.

Sem Telegram, o ciclo inteiro roda pelo terminal, com a IA real e os fornecedores simulados, no banco de teste:

```bash
npm run simular -- "40 cp2 pra obra alfa, rua das flores 100 campinas, até quinta" \
  "clicar:Confirmar" "esperar:aguardando_decisao" "clicar:Aprovar" "clicar:Sim" "esperar:confirmado"
```

### Busca real e créditos do Serper

O Serper tem 2.500 consultas, uma vez só. Cada item gasta no máximo 2 (`BUSCA_MAX_CONSULTAS_ITEM`), a mesma consulta é reaproveitada por 24 h (`BUSCA_CACHE_HORAS`), o app para em `SERPER_LIMITE` (contado por banco) e os testes automáticos nunca gastam. Para testar uma busca: `npm run busca:testar -- "Cimento CP II 50 kg" saco 40 01310-100`. Na demo sem rede, `BUSCA_MODO=snapshot` usa só as buscas guardadas.

Para testar a verificação de um fornecedor: `npm run verificacao:testar -- https://www.telhanorte.com.br` ou `-- 15.351.310/0001-28`. O e-SAJ do TJSP ficou em manutenção em 07 e 08/11/2026; quando ele não responde, o fornecedor não perde pontos e o motivo aparece.

Para ver tudo o que aconteceu num pedido (agentes, dados, IA e mensagens, em ordem): `npm run rastro -- <pedido>`; com `--em "<data e hora>"`, o estado exato naquele instante. Detalhes em [docs/arquitetura.md](docs/arquitetura.md#rastreio-nada-se-perde).

Para os testes de integração, crie o banco de teste uma vez:
`docker compose exec banco psql -U kotala -c "create database kotala_teste"`.

## Núcleo (`src/nucleo/`)

| Módulo | Pasta | O que faz |
|---|---|---|
| N1 Modelo de dados | `db/` | Schema Drizzle: pedido com N itens, fornecedor, contato por canal, cotação, oferta, mensagem, evento, uso de IA e histórico. Mudou o schema? `npm run db:gerar` e `npm run db:migrar`. |
| N2 Adaptador de IA | `ia/` | `gerarTexto` e `gerarObjeto` (zod) por papel (`rapido`, `forte`). Tenta os modelos da chave principal (`GEMINI_API_KEY`) e depois os da reserva (`GEMINI_API_KEY_RESERVA`). 429 e 5xx trocam de modelo; chave inválida pula a rota; alvo que falhou descansa um tempo. |
| N3 Orquestrador | `orquestrador/` | Tabela de transições em `estados.ts`. `avancarPedido` e `avancarItem` fazem UPDATE atômico e registram o evento na mesma transação. Agentes se ligam com `aoEntrarItem(estado, fn)` e rodam depois do commit. Cota um item por vez: o próximo começa quando o atual chega ao mapa pronto. `iniciarVarredor()` encerra cotações com prazo vencido. |
| N4 Entrada única | `mensagens/` | Canal converte o que recebe em `MensagemEntrada` e chama `receber()`; toda saída passa por `enviar()`, que bloqueia quem respondeu PARAR, em qualquer canal. Canais se ligam com `registrarCanal()`. |
| N5 Registro | `registro.ts` | `registrar()` grava o que cada agente fez e por quê. |

## Ciclo de compra

Pedido → Interpretador → confirmação → Busca → Cotador → respostas → Extrator → Comparador → aprovação → pedido de compra → confirmação do fornecedor.

| Módulo | Onde | O que faz |
|---|---|---|
| R1 Telegram | `src/canais/telegram.ts`, `src/bots.ts` | Um bot do comprador e um do fornecedor, por long polling. Baixa PDF e foto para o Extrator. |
| R2 Interpretador | `src/agentes/interpretador/` | Lê o pedido solto, entende o jargão, separa os itens e devolve destino, prazo em dias, urgência, suposições e o que falta. |
| R3 Busca | `src/agentes/busca/` | Busca real em etapas: entende (IA monta as consultas e os termos), coleta (lojas VTEX com estoque e frete para o CEP, Serper shopping e web, leitura de página por JSON-LD ou IA com trecho conferido), filtra (item certo, tamanho, kit, unidade), confere (fonte, data) e ordena. Grava como referência pública com link e hora, usada no mapa, na retenção de preço e para ancorar os simulados. Também usa os fornecedores da base. |
| Q8 Verificação | `src/agentes/verificacao/` | Julga se o fornecedor real é confiável: CNPJ (achado no site ou informado na proposta) consultado na Receita pela BrasilAPI, com Minha Receita de reserva; sanções no CEIS e no CNEP (dados abertos do Portal da Transparência, atualizados por dia); processos no TJSP (e-SAJ), em que só falência e recuperação judicial pesam; idade da empresa, atividade, presença verificável, histórico e homologação. Gera pontos (0 a 100), nível e motivos, usados na nota de confiança do mapa e nos alertas. Sócios, e-mail e telefone da Receita são descartados. |
| R4 Cotador e Q4 | `src/agentes/cotador/` | Pedido de cotação por template, lembrete na metade do prazo, dúvidas respondidas com os dados do pedido (ou levadas ao comprador), encerramento quando todos respondem ou o prazo vence. |
| R5 Cadastro | `src/fluxo/fornecedor.ts` | O fornecedor abre o bot pelo link de convite (o log mostra o link), recebe o aviso de privacidade e informa o nome da empresa. |
| R6 Extrator | `src/agentes/extrator/` | Separa proposta, dúvida, recusa e PARAR, e extrai preço, frete, prazo, pagamento, impostos e validade, de texto, PDF ou foto. |
| R7, R8 e R9 | `src/agentes/comparador/` | Custo total (produto, frete informado ou estimado, impostos), regras de corte, retenção de preço 30% abaixo da referência, nota com pesos (prazo dobra na urgência). A IA só redige a justificativa, com checagem dos valores citados. |
| R11 Decisão | `src/fluxo/decisao.ts` | Aprovar em dois toques, escolher outra proposta, cotar de novo ou buscar mais. O vencedor recebe o pedido de compra e confirma; os demais são avisados. |
| Q3 Simulados | `src/simulador/` | Seis fornecedores fictícios com personas (pergunta antes, esquece, infla, oferece similar, preço suspeito), sempre marcados como simulados. |

Quadro: as 4 colunas vêm de `colunaDoItem()`. Diagrama para o pitch: `diagramaMermaid()`.
