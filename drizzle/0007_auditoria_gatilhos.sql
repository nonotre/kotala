-- Auditoria por gatilho: toda mudança nas tabelas de negócio vai para "auditoria",
-- com a linha antes e depois, na mesma transação. Alteração que não muda nada não é gravada.
CREATE OR REPLACE FUNCTION auditar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO auditoria (tabela, operacao, chave, antes) VALUES (TG_TABLE_NAME, TG_OP, OLD.id::text, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
      INSERT INTO auditoria (tabela, operacao, chave, antes, depois) VALUES (TG_TABLE_NAME, TG_OP, NEW.id::text, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO auditoria (tabela, operacao, chave, depois) VALUES (TG_TABLE_NAME, TG_OP, NEW.id::text, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedido','item_pedido','cotacao','oferta','fornecedor','contato','referencia_preco','mapa_cotacao','historico_compra','arquivo'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS auditar_%1$s ON %1$I', t);
    EXECUTE format('CREATE TRIGGER auditar_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END
$$;
