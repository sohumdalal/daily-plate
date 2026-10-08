# Single stage — the UI is three static files, so there is nothing to build.
FROM --platform=linux/amd64 oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY agent/ ./agent/

# Astropods routes the frontend hostname to port 80 (validation rule 14).
EXPOSE 80

CMD ["bun", "run", "agent/index.ts"]
