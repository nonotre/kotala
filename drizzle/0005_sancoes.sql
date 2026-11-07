CREATE TABLE "sancao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cadastro" text NOT NULL,
	"cnpj" text NOT NULL,
	"raiz" text NOT NULL,
	"nome" text NOT NULL,
	"categoria" text,
	"orgao" text,
	"uf" text,
	"esfera" text,
	"abrangencia" text,
	"inicio" text,
	"fim" text,
	"base" text NOT NULL,
	"carregado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sancao_cnpj" ON "sancao" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "sancao_raiz" ON "sancao" USING btree ("raiz");