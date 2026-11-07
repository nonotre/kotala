ALTER TABLE "fornecedor" ADD COLUMN "bloqueado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fornecedor" ADD COLUMN "motivo_bloqueio" text;