ALTER TABLE "pedido" ADD COLUMN "suposicoes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "correcoes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "perguntas_feitas" integer DEFAULT 0 NOT NULL;