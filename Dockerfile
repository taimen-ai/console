# Образ консоли (CON-ADR-0001, п. 5): BFF на Hono отдаёт собранную SPA и API под одним
# префиксом. Node 24 исполняет TypeScript BFF сам; в образ идут только его production-зависимости.

# ------------------------------------------------------------------ сборка SPA
FROM node:24-alpine AS build
WORKDIR /src
# pnpm — точной версией из packageManager; через npm, а не corepack: у pnpm 12 нативный бинарь
# (для Alpine — сборка musl), и corepack его не всегда находит.
RUN npm install -g --no-fund --no-audit pnpm@12.6.0
COPY . .
# Токены — из design-system/tokens.json, типы API — из openapi/control-plane.json.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @console/tokens build \
 && pnpm --filter @console/api build \
 && pnpm --filter @console/web i18n:check \
 && pnpm --filter @console/web build \
 && test -f apps/web/dist/index.html \
 && pnpm --filter @console/bff deploy --prod /out/bff

# ------------------------------------------------------------------ образ
FROM node:24-alpine
ENV NODE_ENV=production \
    CONSOLE_HOST=0.0.0.0 \
    CONSOLE_PORT=8090 \
    CONSOLE_OPENAPI_DIR=/app/openapi \
    CONSOLE_STATIC_DIR=/app/web \
    NODE_OPTIONS=--max-old-space-size=80 \
    CONSOLE_SESSION_STORE_DIR=/data/sessions
WORKDIR /app
# package.json — ради "type": "module" (ESM для .ts).
COPY --from=build --chown=0:0 /out/bff/package.json bff/package.json
COPY --from=build --chown=0:0 /out/bff/node_modules bff/node_modules
COPY --from=build --chown=0:0 /out/bff/src bff/src
COPY --chown=0:0 openapi openapi
COPY --from=build --chown=0:0 /src/apps/web/dist web
# Лицензия, уведомления и сторонние компоненты — в образе рядом с кодом (шрифты IBM Plex — OFL 1.1).
COPY --chown=0:0 LICENSE NOTICE THIRD_PARTY.md licenses/
COPY --chown=0:0 design-system/fonts/OFL.txt licenses/IBM-Plex-OFL.txt
COPY --chown=0:0 design-system/assets/Icons/LICENSE licenses/Lucide-ISC.txt
# Каталог сессий — единственное, что процесс пишет; том на нём сохраняет вход через выкатку.
RUN mkdir -p /data/sessions && chown 10001:10001 /data/sessions && chmod 700 /data/sessions
# Файлы принадлежат root и только читаются; процесс — uid 10001, как у сервисов платформы.
USER 10001:10001
EXPOSE 8090
# Живость — healthz (процесс отвечает); готовность к входу — readyz (IdP доступен), её смотрит оркестратор.
# 127.0.0.1, не localhost: в alpine localhost может уйти в ::1, а BFF слушает IPv4.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "const b=(process.env.CONSOLE_BASE_PATH||'/console').replace(/\\/+$/,'');fetch('http://127.0.0.1:'+(process.env.CONSOLE_PORT||8090)+b+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "bff/src/main.ts"]
