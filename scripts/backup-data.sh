set -euo pipefail

APP_DIR="/volume1/docker/gw2-eternal-vat"
BACKUP_DIR="$APP_DIR/backups/manual"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "Creating backup..."

mkdir -p "$BACKUP_DIR"

# Backup .env file
if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" "$BACKUP_DIR/.env-$TIMESTAMP"
fi

if docker ps | grep -q gw2-eternal-vat-bot; then
    docker-compose exec -T discord-bot node -e "
        const BackupHandler = require('./src/core/BackupHandler');
        const handler = new BackupHandler({ logger: console });
        handler.performBackup().then(result => {
            console.log('Backup result:', result);
            process.exit(result.success ? 0 : 1);
        }).catch(err => {
            console.error('Backup error:', err);
            process.exit(1);
        });
    " || echo "Warning: In-app backup failed"
fi

docker run --rm \
    -v gw2-eternal-vat_postgres-data:/source:ro \
    -v "$BACKUP_DIR:/backup" \
    alpine tar czf "/backup/postgres-data-$TIMESTAMP.tar.gz" -C /source . || echo "Warning: Postgres backup failed"

echo "Backup created in $BACKUP_DIR"

cd "$BACKUP_DIR"
ls -t | grep -E "^postgres-data-.*\.tar\.gz$" | tail -n +11 | xargs -r rm
ls -t | grep -E "^\.env-" | tail -n +11 | xargs -r rm