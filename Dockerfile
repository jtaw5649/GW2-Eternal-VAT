FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma/
COPY scripts ./scripts/

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm exec prisma generate
RUN pnpm prune --prod

COPY src ./src/

RUN mkdir -p /data /logs

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app /data /logs

USER nodejs

CMD ["node", "src/bot.js"]