FROM node:22.19.0-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22.19.0-bookworm-slim AS runtime
ENV NODE_ENV=development
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma
COPY --chmod=0755 start-api.sh /usr/local/bin/start-easy-latex-api
USER node
EXPOSE 8000
CMD ["start-easy-latex-api"]

FROM builder AS test
COPY test ./test
COPY jest.config.cjs eslint.config.mjs ./
CMD ["npm", "test"]
