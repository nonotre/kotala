ALTER TABLE "usuario" ADD COLUMN "codigo_vinculo" text;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "codigo_vinculo_expira_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_codigo_vinculo_unique" UNIQUE("codigo_vinculo");