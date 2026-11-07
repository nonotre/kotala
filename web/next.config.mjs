import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "..");

// As telas usam o mesmo .env do resto do projeto (banco, token da API interna).
try {
  process.loadEnvFile(resolve(raiz, ".env"));
} catch {
  // Sem .env: usa as variáveis do ambiente (container).
}

/** @type {import("next").NextConfig} */
const config = {
  // O Next 16 gera AGENTS.md sozinho; o repo já tem os seus.
  agentRules: false,
  reactStrictMode: true,
  devIndicators: false,
  // Sem isto, abrir por 127.0.0.1 no modo dev bloqueia os recursos do Next e a tela não fica interativa.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // O núcleo mora em ../src: a raiz do Turbopack é a do repositório.
  turbopack: { root: raiz },
  outputFileTracingRoot: raiz,
  serverExternalPackages: ["postgres"],
  // O chat registra custom elements e mexe em window: estes pacotes precisam passar pelo compilador do Next.
  transpilePackages: ["@carbon/ai-chat", "@carbon/ai-chat-components"],
  sassOptions: { quietDeps: true },
};

export default config;
