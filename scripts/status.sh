cd /volume1/docker/gw2-eternal-vat || exit 1

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== GW2 Eternal VAT Status ===${NC}\n"

echo -e "${YELLOW}Container Status:${NC}"
docker-compose ps

echo -e "\n${YELLOW}Git Status:${NC}"
if [ -f .last-update ]; then
    echo "Last update: $(grep DATE .last-update | cut -d= -f2)"
    echo "Commit: $(grep COMMIT .last-update | cut -d= -f2 | head -c 7)"
fi

LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "unknown")

if [ "$LOCAL" = "$REMOTE" ]; then
    echo -e "${GREEN}✓ Up to date with GitLab${NC}"
elif [ "$LOCAL" = "unknown" ] || [ "$REMOTE" = "unknown" ]; then
    echo -e "${YELLOW}⚠ Unable to check GitLab status${NC}"
else
    echo -e "${YELLOW}⚠ Updates available - run ./scripts/update.sh${NC}"
fi

echo -e "\n${YELLOW}Recent Errors (last 24h):${NC}"
ERROR_COUNT=$(docker logs gw2-eternal-vat-bot --since 24h 2>&1 | grep -iE "error|exception" | wc -l)
if [ "$ERROR_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ No recent errors${NC}"
else
    echo -e "${RED}✗ Found $ERROR_COUNT errors${NC}"
    echo "Run ./scripts/logs.sh to view"
fi

echo -e "\n${YELLOW}Resource Usage:${NC}"
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"