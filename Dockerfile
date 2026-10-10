FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
COPY frontend/client/package.json ./frontend/client/
COPY frontend/admin/package.json ./frontend/admin/
COPY frontend/shared/package.json ./frontend/shared/
RUN npm ci
COPY frontend/ ./frontend/
RUN npm run build --workspace @cria/client
FROM node:22-bookworm-slim AS tooling
WORKDIR /app
COPY package*.json ./
COPY frontend/client/package.json ./frontend/client/
COPY frontend/admin/package.json ./frontend/admin/
COPY frontend/shared/package.json ./frontend/shared/
RUN npm ci --omit=dev --ignore-scripts --workspaces=false
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /app
COPY Directory.Build.props global.json MoovitDeCria.slnx ./
COPY src/ ./src/
RUN dotnet restore src/Cria.Web/Cria.Web.csproj --locked-mode
RUN dotnet publish src/Cria.Web/Cria.Web.csproj -c Release --no-restore -o /publish
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS api
WORKDIR /app
COPY --from=tooling /usr/local/bin/node /usr/local/bin/node
COPY --from=tooling /app/node_modules ./node_modules/
COPY --from=backend /publish ./
COPY scripts/ ./scripts/
ARG PREPARE_GTFS=0
ARG GTFS_URL=https://dados.mobilidade.rio/gtfs/schedule
# GitHub prepares the public timetable; deployment only installs this snapshot.
# Local builds keep the existing import/host-volume flow.
RUN if [ "$PREPARE_GTFS" = 1 ]; then node /app/scripts/import-gtfs.mjs --output /app/snapshot/transit.sqlite; fi
RUN mkdir -p /accounts && chown app:app /accounts && chmod 0700 /accounts
ENV ASPNETCORE_HTTP_PORTS=8080 Transit__Database=/data/transit.sqlite Accounts__Keys=/accounts/keys DOTNET_gcServer=0
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Cria.Web.dll"]

# Local Docker development can still serve both apps from one container.
FROM api AS local
COPY --from=frontend /app/frontend/client/dist ./wwwroot/
