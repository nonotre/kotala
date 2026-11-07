# Decisões do projeto

Registro curto das decisões que mudam o escopo ou o desenho. A mais nova fica no topo.

## 07/11/2026 · Busca e verificação com fontes públicas

**Situação:** implementado.

- **Empresa fictícia em São Paulo** (CEP 01310-100), porque as lojas online testadas não entregam no interior. Sem destino no pedido, vale o endereço padrão da empresa.
- **Busca real com referência pública.** Preço da internet entra como referência com fonte e hora, não como proposta. Lojas encontradas viram fornecedores conhecidos, mas não são contatadas.
- **Créditos do Serper protegidos:** 2 consultas por item, cache de 24 h, teto de 300 no app, testes nunca gastam.
- **Verificação do fornecedor (Q8)** com Receita (BrasilAPI), sanções do CEIS e do CNEP (dados abertos do Portal da Transparência) e TJSP (e-SAJ). Só falência e recuperação judicial pesam no TJSP; quantidade de processos não.
- **TJSP indisponível no fim de semana do hackathon** (manutenção em 07 e 08/11). A leitura não pôde ser conferida; fonte fora do ar não tira pontos.
- **API do Portal da Transparência:** o dono vai criar a chave. Encaixe planejado em [arquitetura.md](arquitetura.md#portal-da-transparência-pela-api-próximo-passo).

## 07/11/2026 · Fornecedor sem cadastro: vem da busca e é convidado por e-mail

**Situação:** decidido, implementação adiada (seguir com os outros módulos antes).

O fornecedor não faz cadastro no bot. A busca (R3) já identifica quem ele é (nome, CNPJ, e-mail, fonte) e o registra no banco. O primeiro contato é por e-mail.

Fluxo previsto:

1. A busca registra o fornecedor com os dados encontrados.
2. O agente manda um e-mail com o pedido de cotação e um link pessoal para o bot do fornecedor: `t.me/<bot_fornecedor>?start=<código do fornecedor>`.
3. Ao tocar no link, o bot liga a conversa ao fornecedor já conhecido, sem perguntar o nome, e mostra a cotação.
4. Responder pelo próprio e-mail fica para depois (E2).

Restrições e pontos em aberto:

- O Telegram não deixa o bot iniciar conversa: o fornecedor precisa abrir o bot uma vez, por isso o link no e-mail.
- Muda a regra anterior de não contatar fornecedor que não autorizou. Por e-mail comercial o risco é menor que por WhatsApp (regra da Meta), mas a LGPD vale.
- Na demo: perguntar à organização se fornecedores reais podem receber e-mail. Se não, usar endereços do time e manter os simulados para volume.
- Fornecedor sem e-mail encontrado (lojas grandes costumam ter só formulário) entra só como preço de referência, com a fonte.
- O link genérico com pergunta do nome continua como reserva, para a banca virar fornecedor pelo QR no pitch.
- Para o envio: conta Gmail com senha de app (nodemailer).
