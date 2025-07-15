set -euo pipefail

APP_DIR="/volume1/docker/gw2-eternal-vat"
BACKUP_DIR="$APP_DIR/backups"
LOG_FILE="$APP_DIR/logs/update-$(date +%Y%m%d-%H%M%S).log"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

mkdir -p "$(dirname "$LOG_FILE")"

log "Starting update process..."

if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
    error "docker-compose.yml not found. Are you in the right directory?"
fi

cd "$APP_DIR" || error "Failed to navigate to app directory"

if ! command -v git &> /dev/null; then
    error "Git is not installed. Please install git from Package Center."
fi

log "Stashing local changes..."
git stash push -m "Auto-stash before update $(date +%Y%m%d-%H%M%S)" || warning "No local changes to stash"

log "Fetching latest changes from GitLab..."
git fetch origin main || error "Failed to fetch from GitLab"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "Already up to date!"

    read -p "No updates found. Rebuild anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Update cancelled"
        exit 0
    fi
else
    log "Updates available!"
    
    log "Changes:"
    git log --oneline HEAD..origin/main
fi

log "Creating backup..."
"$APP_DIR/scripts/backup-data.sh" || warning "Backup failed, continuing anyway"

log "Pulling latest code..."
git pull origin main || error "Failed to pull latest code"

if git diff HEAD@{1} HEAD --name-only | grep -q "package.json\|pnpm-lock.yaml"; then
    log "Dependencies changed, rebuilding with --no-cache"
    BUILD_ARGS="--no-cache"
else
    BUILD_ARGS=""
fi

log "Stopping current containers..."
docker-compose down || error "Failed to stop containers"

log "Building new Docker image..."
docker-compose build $BUILD_ARGS discord-bot || error "Failed to build Docker image"

log "Running database migrations..."
docker-compose run --rm discord-bot pnpm run prisma:deploy || warning "Migration failed - may already be up to date"

log "Starting services..."
docker-compose up -d || error "Failed to start services"

log "Waiting for services to be healthy..."
sleep 10

RETRIES=30
while [ $RETRIES -gt 0 ]; do
    if docker-compose ps | grep -E "discord-bot.*Up.*healthy" >/dev/null 2>&1; then
        log "Bot is healthy!"
        break
    fi
    RETRIES=$((RETRIES - 1))
    sleep 2
done

if [ $RETRIES -eq 0 ]; then
    error "Bot failed health check after 60 seconds"
fi

log "Cleaning up old Docker images..."
docker image prune -f || warning "Failed to prune images"

log "Update complete! Current status:"
docker-compose ps

log "Recent bot logs:"
docker-compose logs --tail=20 discord-bot

cat > "$APP_DIR/.last-update" << EOF
DATE=$(date -Iseconds)
COMMIT=$REMOTE
MESSAGE=$(git log -1 --pretty=%B)
AUTHOR=$(git log -1 --pretty=%an)
EOF

log "Update finished successfully!"
log "Commit: $(git rev-parse --short HEAD)"
log "Message: $(git log -1 --pretty=%B | head -1)"

if [ -n "${UPDATE_WEBHOOK_URL:-}" ]; then
    curl -X POST "$UPDATE_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"content\": \"✅ Bot updated successfully!\",
            \"embeds\": [{
                \"title\": \"Update Complete\",
                \"color\": 65280,
                \"fields\": [
                    {\"name\": \"Commit\", \"value\": \"$(git rev-parse --short HEAD)\", \"inline\": true},
                    {\"name\": \"Date\", \"value\": \"$(date)\", \"inline\": true}
                ]
            }]
        }" || warning "Failed to send webhook notification"
fi