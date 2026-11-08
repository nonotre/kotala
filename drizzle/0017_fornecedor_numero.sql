ALTER TABLE "fornecedor" ADD COLUMN "numero" serial NOT NULL;--> statement-breakpoint
-- Quem já existe ganha o número na ordem de cadastro, não na ordem física da tabela.
UPDATE "fornecedor" AS f SET "numero" = o.n FROM (SELECT "id", row_number() OVER (ORDER BY "criado_em", "id") AS n FROM "fornecedor") AS o WHERE f."id" = o."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('fornecedor', 'numero'), coalesce(max("numero"), 0) + 1, false) FROM "fornecedor";--> statement-breakpoint
ALTER TABLE "fornecedor" ADD CONSTRAINT "fornecedor_numero_unique" UNIQUE("numero");
