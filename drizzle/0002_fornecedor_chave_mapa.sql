CREATE TABLE "mapa_cotacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_pedido_id" integer NOT NULL,
	"rodada" integer NOT NULL,
	"dados" jsonb NOT NULL,
	"recomendacao" text NOT NULL,
	"oferta_recomendada_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fornecedor" ADD COLUMN "chave" text;--> statement-breakpoint
ALTER TABLE "mapa_cotacao" ADD CONSTRAINT "mapa_cotacao_item_pedido_id_item_pedido_id_fk" FOREIGN KEY ("item_pedido_id") REFERENCES "public"."item_pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mapa_item" ON "mapa_cotacao" USING btree ("item_pedido_id","criado_em");--> statement-breakpoint
ALTER TABLE "fornecedor" ADD CONSTRAINT "fornecedor_chave_unique" UNIQUE("chave");