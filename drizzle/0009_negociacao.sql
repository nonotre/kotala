ALTER TABLE "item_pedido" ADD COLUMN "excluidos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "item_pedido" ADD COLUMN "negociacao" jsonb;--> statement-breakpoint
ALTER TABLE "oferta" ADD COLUMN "confirmacao_pedida_em" timestamp with time zone;