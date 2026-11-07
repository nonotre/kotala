# kotala

Agentes de IA para cotação de compras de material de obra.

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

Quadro: as 4 colunas vêm de `colunaDoItem()`. Diagrama para o pitch: `diagramaMermaid()`.
