# Keycloak с темой входа консоли (apps/keycloak-theme, Keycloakify). Контекст сборки — корень
# репозитория консоли: тема берёт токены и компоненты дизайн-системы из workspace.
#   docker build -f apps/keycloak-theme/Dockerfile --build-arg KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.5.2 .
# Тема — jar в /opt/keycloak/providers: Keycloak в режиме `start` (не optimized) подхватывает его
# при запуске. Включение — loginTheme realm = console (задаёт оператор при развёртывании, Admin API Keycloak).
ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.5.2

# ------------------------------------------------------------------ сборка jar
FROM node:24-bookworm AS build
# Keycloakify упаковывает тему Maven'ом.
RUN apt-get update \
 && apt-get install -y --no-install-recommends maven openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g --no-fund --no-audit pnpm@12.6.0
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @console/tokens build \
 && pnpm --filter @console/keycloak-theme run build-keycloak-theme \
 && test -f apps/keycloak-theme/dist_keycloak/console-keycloak-theme.jar

# ------------------------------------------------------------------ образ
FROM ${KEYCLOAK_IMAGE}
COPY --from=build --chown=1000:0 /src/apps/keycloak-theme/dist_keycloak/console-keycloak-theme.jar /opt/keycloak/providers/console-keycloak-theme.jar
