CREATE TABLE "contrato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_chave" text NOT NULL,
	"descricao" text NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"preco_unitario" numeric(14, 2) NOT NULL,
	"unidade" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"razao_social" text,
	"endereco_faturamento" text,
	"cep_faturamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_entrega" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"apelido" text NOT NULL,
	"endereco" text NOT NULL,
	"cep" text,
	"janela_recebimento" text,
	"restricao" text,
	"padrao" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- "obra_parada" vira "parada" (generalista); RENAME VALUE mantém as linhas que já existem.
ALTER TYPE "public"."urgencia" RENAME VALUE 'obra_parada' TO 'parada';--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_entrega" ADD CONSTRAINT "local_entrega_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Tabelas novas de negócio entram na auditoria (regra da migração 0007).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresa','local_entrega','contrato'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS auditar_%1$s ON %1$I', t);
    EXECUTE format('CREATE TRIGGER auditar_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END
$$;
