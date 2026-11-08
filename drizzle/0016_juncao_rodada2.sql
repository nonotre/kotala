CREATE TYPE "public"."papel_usuario" AS ENUM('comprador', 'gestor');--> statement-breakpoint
ALTER TABLE "item_pedido" ADD COLUMN "ampliacoes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "item_pedido" ADD COLUMN "categoria" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "pagamento_preferido" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "responsavel_id" uuid;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "papel" "papel_usuario" DEFAULT 'comprador' NOT NULL;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "item_pedido" i SET "ampliacoes" = (SELECT count(*) FROM "evento" e WHERE e."item_pedido_id" = i."id" AND e."agente" = 'Cotador' AND e."dados"->>'tipo' = 'ampliacao' AND e."dados"->>'rodada' = i."rodada"::text);
