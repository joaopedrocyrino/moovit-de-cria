FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /app
COPY Directory.Build.props global.json MoovitDeCria.slnx ./
COPY src/ ./src/
RUN dotnet restore src/Cria.Web/Cria.Web.csproj --locked-mode
RUN dotnet publish src/Cria.Web/Cria.Web.csproj -c Release --no-restore -o /publish
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /publish ./
COPY --from=frontend /app/frontend/dist ./wwwroot/
COPY scripts/import_gtfs.py /app/scripts/import_gtfs.py
ARG PREPARE_GTFS=0
ARG GTFS_URL=https://dados.mobilidade.rio/gtfs/schedule
# GitHub prepares the public timetable; deployment only installs this snapshot.
# Local builds keep the existing import/host-volume flow.
RUN if [ "$PREPARE_GTFS" = 1 ]; then python3 /app/scripts/import_gtfs.py --output /app/snapshot/transit.sqlite; fi
ENV ASPNETCORE_HTTP_PORTS=8080 Transit__Database=/data/transit.sqlite DOTNET_gcServer=0
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Cria.Web.dll"]
