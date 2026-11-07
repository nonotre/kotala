CREATE TABLE "arquivo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"tamanho" integer NOT NULL,
	"caminho" text NOT NULL,
	"nome" text,
	"canal" "canal" NOT NULL,
	"ref" text NOT NULL,
	"mensagem_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tabela" text NOT NULL,
	"operacao" text NOT NULL,
	"chave" text NOT NULL,
	"antes" jsonb,
	"depois" jsonb,
	"txid" bigint DEFAULT txid_current() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evento" ADD COLUMN "txid" bigint DEFAULT txid_current();--> statement-breakpoint
ALTER TABLE "uso_ia" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "uso_ia" ADD COLUMN "resposta" text;--> statement-breakpoint
ALTER TABLE "arquivo" ADD CONSTRAINT "arquivo_mensagem_id_mensagem_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."mensagem"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arquivo_sha" ON "arquivo" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "arquivo_ref" ON "arquivo" USING btree ("canal","ref");--> statement-breakpoint
CREATE INDEX "auditoria_linha" ON "auditoria" USING btree ("tabela","chave","criado_em");--> statement-breakpoint
CREATE INDEX "auditoria_txid" ON "auditoria" USING btree ("txid");--> statement-breakpoint
CREATE INDEX "evento_txid" ON "evento" USING btree ("txid");