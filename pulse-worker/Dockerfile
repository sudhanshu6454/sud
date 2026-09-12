FROM node:22-slim

WORKDIR /app
COPY . .

RUN useradd -r -u 10001 pulseworker && mkdir -p /app/data && chown -R pulseworker:pulseworker /app
USER pulseworker

VOLUME ["/app/data"]
HEALTHCHECK --interval=5m --timeout=10s CMD node -e "process.exit(0)"

CMD ["node", "scripts/scheduler.js"]
