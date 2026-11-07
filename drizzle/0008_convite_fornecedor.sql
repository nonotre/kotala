ALTER TABLE "fornecedor" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "fornecedor" ADD COLUMN "codigo_convite" text;--> statement-breakpoint
ALTER TABLE "fornecedor" ADD CONSTRAINT "fornecedor_codigo_convite_unique" UNIQUE("codigo_convite");