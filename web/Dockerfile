# Telas (Frente 1). Contexto do build: raiz do repositório (o núcleo mora em ../src).
FROM node:26-slim
ENV NODE_ENV=production TZ=America/Sao_Paulo IBM_TELEMETRY_DISABLED=true NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
# O build carrega os módulos, mas não conecta ao banco (páginas dinâmicas): a URL é só de preenchimento.
RUN cd web && DATABASE_URL=postgres://build@127.0.0.1:1/build npm run build
# O build roda como root, mas o Next grava o cache em .next em tempo de execução, como node.
RUN chown -R node:node web/.next
USER node
WORKDIR /app/web
# Dentro do container escuta em todas as interfaces; o compose publica só em 127.0.0.1.
CMD ["npx", "next", "start", "-p", "3300", "-H", "0.0.0.0"]
