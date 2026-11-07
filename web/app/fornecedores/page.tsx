import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag } from "@/components/carbon";
import { listaFornecedores } from "@/lib/dados";
import { dataHora } from "@/lib/formato";
import estilos from "../comum.module.scss";

export const dynamic = "force-dynamic";

const COR = { alta: "green", media: "warm-gray", baixa: "red", simulado: "gray" } as const;
const ROTULO = { alta: "Alta", media: "Média", baixa: "Baixa", simulado: "Simulado" } as const;

export default async function Fornecedores() {
  const lista = await listaFornecedores();
  return (
    <>
      <h1 className={estilos.titulo}>Fornecedores</h1>
      <p className={estilos.sub}>
        A confiança de cada fornecedor real é conferida na Receita (CNPJ), nas listas de empresas punidas do Portal da Transparência (CEIS e CNEP), no TJSP, no site e no histórico de compras. Lojas achadas na internet entram como referência de preço e não são contatadas.
      </p>
      <div className={estilos.tabela}>
        <Table aria-label="Fornecedores">
          <TableHead>
            <TableRow>
              <TableHeader>Fornecedor</TableHeader>
              <TableHeader>Confiança</TableHeader>
              <TableHeader>O que pesou</TableHeader>
              <TableHeader>Canal</TableHeader>
              <TableHeader>Propostas</TableHeader>
              <TableHeader>Compras</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {lista.map((f) => {
              const nivel = (f.origem === "simulado" ? "simulado" : f.verificacao?.nivel) as keyof typeof COR | undefined;
              return (
                <TableRow key={f.id}>
                  <TableCell>
                    {f.nome} {f.origem === "simulado" ? <Tag size="sm" type="gray">simulado</Tag> : null}
                    {f.cnpj ? <div className={estilos.ajuda}>CNPJ {f.cnpj}</div> : null}
                    {f.fonte?.startsWith("http") ? (
                      <div className={estilos.ajuda}>
                        <a href={f.fonte} target="_blank" rel="noreferrer">
                          {f.fonte.replace(/^https?:\/\//, "")}
                        </a>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {nivel ? (
                      <Tag size="sm" type={COR[nivel]}>
                        {ROTULO[nivel]}
                        {f.verificacao?.pontos !== undefined && nivel !== "simulado" ? ` · ${f.verificacao.pontos}` : ""}
                      </Tag>
                    ) : (
                      "Ainda não verificado"
                    )}
                    {f.verificacao?.em && nivel !== "simulado" ? <div className={estilos.ajuda}>{dataHora(f.verificacao.em)}</div> : null}
                  </TableCell>
                  <TableCell>
                    {nivel === "simulado" ? "Base fictícia do time" : (f.verificacao?.motivos ?? []).slice(0, 4).join("; ")}
                    {f.verificacao?.alertas?.length ? <div className={estilos.alerta}>{f.verificacao.alertas.join("; ")}</div> : null}
                  </TableCell>
                  <TableCell>{f.canais.length ? f.canais.join(", ") : "Sem canal (só referência)"}</TableCell>
                  <TableCell>{f.propostas}</TableCell>
                  <TableCell>{f.compras}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
