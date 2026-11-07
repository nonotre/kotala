ALTER TABLE "fornecedor" ADD COLUMN "categorias" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fornecedor" ADD COLUMN "cadastro_etapa" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "entregas" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "lembrete_confirmacao_em" timestamp with time zone;