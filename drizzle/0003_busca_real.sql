CREATE TYPE "public"."metodo_coleta" AS ENUM('vtex_api', 'jsonld', 'ia_trecho', 'serper_shopping');--> statement-breakpoint
CREATE TABLE "cache_busca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provedor" text NOT NULL,
	"consulta" text NOT NULL,
	"resposta" jsonb NOT NULL,
	"pago" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referencia_preco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_pedido_id" integer NOT NULL,
	"fornecedor_id" uuid,
	"loja" text NOT NULL,
	"titulo" text NOT NULL,
	"url" text NOT NULL,
	"metodo" "metodo_coleta" NOT NULL,
	"preco_fonte" numeric(14, 2) NOT NULL,
	"unidade_fonte" text,
	"preco_unitario" numeric(14, 2),
	"conversao" text,
	"disponivel" boolean,
	"frete" numeric(14, 2),
	"frete_prazo_dias" integer,
	"entrega_no_cep" boolean,
	"regiao_do_preco" text,
	"trecho" text,
	"aceita" boolean NOT NULL,
	"motivo_corte" text,
	"confianca" integer NOT NULL,
	"coletado_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referencia_preco" ADD CONSTRAINT "referencia_preco_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referencia_preco" ADD CONSTRAINT "referencia_preco_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cache_busca_consulta" ON "cache_busca" USING btree ("provedor","consulta","criado_em");--> statement-breakpoint
CREATE INDEX "referencia_item" ON "referencia_preco" USING btree ("item_pedido_id");