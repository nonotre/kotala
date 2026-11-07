ALTER TABLE "item_pedido" ADD COLUMN "duvida_pendente" jsonb;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "setor" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "motivo_cancelamento" text;