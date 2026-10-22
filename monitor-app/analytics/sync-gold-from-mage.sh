#!/usr/bin/env bash
# Copia al repo las capas gold y analytics de Analítica que corre en Mage, para que quede versionada en git.
#
# La fuente de verdad es el proyecto dbt de Mage (/home/src/default_repo/dbt/tms), sincronizado en
# .mage-agent/local_sync con el MCP mage-agent (esa carpeta está fuera de git a propósito). Después de cambiar un
# modelo de gold y sincronizarlo a Mage, correr este script y comitear monitor-app/analytics/dbt.
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
MAGE="$RAIZ/.mage-agent/local_sync"
DESTINO="$RAIZ/monitor-app/analytics/dbt"
rm -rf "$DESTINO"
mkdir -p "$DESTINO/models" "$DESTINO/snapshots" "$DESTINO/tests" "$DESTINO/mage/pipelines" "$DESTINO/mage/dbts"
cp -R "$MAGE/dbt/tms/models/gold" "$MAGE/dbt/tms/models/analytics" "$DESTINO/models/"
cp "$MAGE/dbt/tms/snapshots/snapshot_carriers.sql" "$DESTINO/snapshots/"
grep -l "tags=\['analytics'\]" "$MAGE"/dbt/tms/tests/*.sql | xargs -I{} cp {} "$DESTINO/tests/"
cp -R "$MAGE/pipelines/analytics_gold" "$DESTINO/mage/pipelines/"
cp "$MAGE/dbts/analytics_gold_build.yaml" "$DESTINO/mage/dbts/"
echo "Copiado a $DESTINO"
