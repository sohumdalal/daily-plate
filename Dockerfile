# The server is static files and Bun. The one build is the Mova bundle
# (agent/mova, written to agent/ui/mova/dist), which needs the dev
# dependencies, so it has its own stage.
FROM --platform=linux/amd64 oven/bun:1-slim AS ui

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY agent/ui/ ./agent/ui/
COPY agent/mova/ ./agent/mova/
RUN bun run build:ui

FROM --platform=linux/amd64 oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY agent/ ./agent/
COPY --from=ui /app/agent/ui/mova/dist/ ./agent/ui/mova/dist/

# Astropods routes the frontend hostname to port 80 (validation rule 14).
EXPOSE 80

CMD ["bun", "run", "agent/index.ts"]
