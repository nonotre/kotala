CREATE TYPE "public"."canal" AS ENUM('telegram', 'whatsapp', 'email', 'web', 'voz', 'simulado');--> statement-breakpoint
CREATE TYPE "public"."classificacao_resposta" AS ENUM('proposta', 'duvida', 'parar', 'outro');--> statement-breakpoint
CREATE TYPE "public"."direcao_mensagem" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TYPE "public"."estado_item" AS ENUM('na_fila', 'buscando', 'cotando', 'comparando', 'aguardando_decisao', 'aprovado', 'pedido_enviado', 'confirmado', 'sem_proposta', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."estado_pedido" AS ENUM('interpretando', 'aguardando_confirmacao', 'em_andamento', 'concluido', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."formato_oferta" AS ENUM('texto', 'pdf', 'foto', 'voz', 'busca');--> statement-breakpoint
CREATE TYPE "public"."modo_entrega" AS ENUM('entrega', 'retirada');--> statement-breakpoint
CREATE TYPE "public"."origem_fornecedor" AS ENUM('real', 'simulado');--> statement-breakpoint
CREATE TYPE "public"."origem_frete" AS ENUM('informado', 'estimado', 'nao_se_aplica');--> statement-breakpoint
CREATE TYPE "public"."papel_contato" AS ENUM('comprador', 'fornecedor');--> statement-breakpoint
CREATE TYPE "public"."situacao_cotacao" AS ENUM('aguardando', 'respondeu', 'sem_resposta', 'parou', 'desistiu', 'encerrada');--> statement-breakpoint
CREATE TYPE "public"."situacao_envio" AS ENUM('recebida', 'enviada', 'bloqueada_parar', 'falhou');--> statement-breakpoint
CREATE TYPE "public"."urgencia" AS ENUM('normal', 'urgente', 'obra_parada');--> statement-breakpoint
CREATE TABLE "contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"endereco" text NOT NULL,
	"papel" "papel_contato" NOT NULL,
	"fornecedor_id" uuid,
	"nome" text,
	"aviso_privacidade_em" timestamp with time zone,
	"parou_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cotacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_pedido_id" integer NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"contato_id" uuid,
	"rodada" integer DEFAULT 1 NOT NULL,
	"situacao" "situacao_cotacao" DEFAULT 'aguardando' NOT NULL,
	"enviada_em" timestamp with time zone,
	"lembrete_em" timestamp with time zone,
	"respondeu_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_id" integer,
	"item_pedido_id" integer,
	"agente" text NOT NULL,
	"acao" text NOT NULL,
	"motivo" text NOT NULL,
	"de_estado" text,
	"para_estado" text,
	"fornecedor_ids" jsonb,
	"dados" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fornecedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"origem" "origem_fornecedor" NOT NULL,
	"verificado" boolean DEFAULT false NOT NULL,
	"verificacao" jsonb,
	"homologado" boolean DEFAULT false NOT NULL,
	"fonte" text,
	"regiao" text,
	"cep" text,
	"parou_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historico_compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"item_chave" text NOT NULL,
	"descricao" text NOT NULL,
	"preco_unitario" numeric(14, 2) NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"frete" numeric(14, 2),
	"data" timestamp with time zone NOT NULL,
	"prazo_prometido_dias" integer,
	"prazo_cumprido" boolean,
	"experiencia" text,
	"simulado" boolean NOT NULL,
	"item_pedido_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_pedido" (
	"id" serial PRIMARY KEY NOT NULL,
	"pedido_id" integer NOT NULL,
	"ordem" integer NOT NULL,
	"estado" "estado_item" DEFAULT 'na_fila' NOT NULL,
	"descricao" text NOT NULL,
	"item_chave" text,
	"quantidade" numeric(14, 3) NOT NULL,
	"unidade" text NOT NULL,
	"especificacao" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"aceita_similar" boolean DEFAULT false NOT NULL,
	"prazo_respostas_em" timestamp with time zone,
	"lembrete_em" timestamp with time zone,
	"rodada" integer DEFAULT 1 NOT NULL,
	"fornecedor_escolhido_id" uuid,
	"oferta_escolhida_id" uuid,
	"justificativa_menos_de_tres" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"direcao" "direcao_mensagem" NOT NULL,
	"contato_id" uuid NOT NULL,
	"pedido_id" integer,
	"item_pedido_id" integer,
	"texto" text DEFAULT '' NOT NULL,
	"anexos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"botoes" jsonb,
	"id_externo" text,
	"situacao" "situacao_envio" NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oferta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_pedido_id" integer NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"cotacao_id" uuid,
	"rodada" integer DEFAULT 1 NOT NULL,
	"item_oferecido" text NOT NULL,
	"item_exato" boolean NOT NULL,
	"embalagem" text,
	"quantidade_ofertada" numeric(14, 3),
	"unidade_ofertada" text,
	"preco_unitario" numeric(14, 2),
	"total_produto" numeric(14, 2),
	"frete" numeric(14, 2),
	"origem_frete" "origem_frete",
	"prazo_dias" integer,
	"validade_dias" integer,
	"pagamento" text,
	"prazo_pagamento_dias" integer,
	"impostos_nao_inclusos" text,
	"impostos_valor" numeric(14, 2),
	"entrega_no_local" boolean,
	"formato" "formato_oferta" NOT NULL,
	"fonte" text,
	"mensagem_id" uuid,
	"preco_confirmado" boolean DEFAULT false NOT NULL,
	"extraido" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedido" (
	"id" serial PRIMARY KEY NOT NULL,
	"estado" "estado_pedido" DEFAULT 'interpretando' NOT NULL,
	"canal_origem" "canal" NOT NULL,
	"comprador_id" uuid NOT NULL,
	"texto_original" text NOT NULL,
	"destino" text,
	"cep" text,
	"modo_entrega" "modo_entrega",
	"janela_recebimento" text,
	"prazo_texto" text,
	"prazo_max_dias" integer,
	"urgencia" "urgencia" DEFAULT 'normal' NOT NULL,
	"faltando" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uso_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"papel" text NOT NULL,
	"rota" text NOT NULL,
	"modelo" text NOT NULL,
	"ok" boolean NOT NULL,
	"tentativa" integer NOT NULL,
	"tokens_entrada" integer,
	"tokens_saida" integer,
	"duracao_ms" integer NOT NULL,
	"erro" text,
	"pedido_id" integer,
	"item_pedido_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contato" ADD CONSTRAINT "contato_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotacao" ADD CONSTRAINT "cotacao_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotacao" ADD CONSTRAINT "cotacao_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotacao" ADD CONSTRAINT "cotacao_contato_id_contato_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento" ADD CONSTRAINT "evento_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento" ADD CONSTRAINT "evento_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_compra" ADD CONSTRAINT "historico_compra_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_compra" ADD CONSTRAINT "historico_compra_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_fornecedor_escolhido_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_escolhido_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_contato_id_contato_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oferta" ADD CONSTRAINT "oferta_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oferta" ADD CONSTRAINT "oferta_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oferta" ADD CONSTRAINT "oferta_cotacao_id_cotacao_id_fk" FOREIGN KEY ("cotacao_id") REFERENCES "public"."cotacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_comprador_id_contato_id_fk" FOREIGN KEY ("comprador_id") REFERENCES "public"."contato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contato_canal_endereco" ON "contato" USING btree ("canal","endereco");--> statement-breakpoint
CREATE UNIQUE INDEX "cotacao_item_fornecedor_rodada" ON "cotacao" USING btree ("item_pedido_id","fornecedor_id","rodada");--> statement-breakpoint
CREATE INDEX "evento_pedido" ON "evento" USING btree ("pedido_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "item_pedido_ordem" ON "item_pedido" USING btree ("pedido_id","ordem");--> statement-breakpoint
CREATE INDEX "item_pedido_estado" ON "item_pedido" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "mensagem_entrada_id_externo" ON "mensagem" USING btree ("canal","id_externo") WHERE "mensagem"."direcao" = 'entrada' and "mensagem"."id_externo" is not null;--> statement-breakpoint
CREATE INDEX "mensagem_contato" ON "mensagem" USING btree ("contato_id","criado_em");