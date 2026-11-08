CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"nome" text NOT NULL,
	"senha_hash" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "contato" ADD COLUMN "usuario_id" uuid;--> statement-breakpoint
ALTER TABLE "contato" ADD CONSTRAINT "contato_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;