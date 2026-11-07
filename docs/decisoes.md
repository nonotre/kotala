# Decisões do projeto

Registro curto das decisões que mudam o escopo ou o desenho. A mais nova fica no topo.

## 07/11/2026 · Regras da área de compras (anotações da Ester)

**Situação:** implementado em parte.

Feito:

- **Setor:** toda solicitação é discriminada por setor; se o comprador não disser, a confirmação pergunta.
- **Dúvida do fornecedor que o pedido não responde:** vai ao comprador, e a próxima mensagem dele (até 30 minutos) é repassada ao fornecedor.
- **Cancelamento com justificativa:** cancelar pedido ou item pergunta o motivo, que fica gravado.
- **Unidades de agregados:** areia, brita e pedra em m³, t, kg, saco ou L; carrada ou caminhão geram pergunta pelo volume, para não haver dúvida sobre o que comprar.
- **Quadro:** as 4 colunas do site continuam fixas (requisito); as etapas sugeridas viram etiquetas ("Captando fornecedores", "Em negociação") e as canceladas ficam ocultas, com opção de mostrar.
- **Códigos e confirmação de ambiguidades:** a base de itens dá código ao item e pergunta a variação quando há mais de uma.

Para depois: entregas parciais (uma parte em 20 dias, outra em 30), cadastro automático de item novo na base, campos extras do fornecedor (filial ou sede, atendente) e lista de bloqueio de fornecedor com problema.

## 07/11/2026 · Negociação sem citar valor de outro fornecedor

**Situação:** implementado.

A Ester apontou, nas anotações dela, que valores de cotação e dados de pagamento são sensíveis e que o assistente não pode citar o valor de outros fornecedores para conseguir desconto. A contraproposta agora só pede melhora (preço, frete ou prazo de entrega), oferece combinar a forma de pagamento e, quando houver, cita a referência pública da internet, que não é proposta de ninguém. O melhor custo recebido fica só no registro e no mapa do comprador.

## 07/11/2026 · Logo nas telas

A logo do coala feita pela Liria entra no cabeçalho das telas (`web/public/logo.svg`, sem o fundo branco) e o coala, recortado, vira o ícone da aba.

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
