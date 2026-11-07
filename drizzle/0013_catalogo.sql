CREATE TABLE "item_catalogo" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"descricao" text NOT NULL,
	"unidade" text NOT NULL,
	"especificacao" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"categoria" text,
	"pedido_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_catalogo_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
ALTER TABLE "item_catalogo" ADD CONSTRAINT "item_catalogo_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP TRIGGER IF EXISTS auditar_item_catalogo ON item_catalogo;
--> statement-breakpoint
CREATE TRIGGER auditar_item_catalogo AFTER INSERT OR UPDATE OR DELETE ON item_catalogo FOR EACH ROW EXECUTE FUNCTION auditar();
