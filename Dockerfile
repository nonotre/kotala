FROM node:26-slim
ENV NODE_ENV=production TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json package-lock.json ./
# drizzle-kit (dev) fica de fora; a migração roda pelo migrator do drizzle-orm.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts
# Arquivos recebidos (PDF, foto, áudio) ficam num volume, fora da imagem.
RUN mkdir -p /app/dados/arquivos && chown -R node:node /app/dados
USER node
CMD ["sh", "-c", "node scripts/migrar.ts && node src/bots.ts"]
