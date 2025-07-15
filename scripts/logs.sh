cd /volume1/docker/gw2-eternal-vat || exit 1

YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}GW2 Eternal VAT Logs${NC}"
echo "1) Bot logs (last 100 lines)"
echo "2) Error logs only"
echo "3) Follow logs (real-time)"
echo "4) All container logs"
echo "5) Update logs"
echo -n "Select option: "
read -r choice

case $choice in
    1) docker-compose logs --tail=100 discord-bot ;;
    2) docker-compose logs discord-bot 2>&1 | grep -iE "error|exception" | tail -50 ;;
    3) docker-compose logs -f discord-bot ;;
    4) docker-compose logs --tail=50 ;;
    5) ls -t logs/update-*.log 2>/dev/null | head -1 | xargs -r tail -50 ;;
    *) echo "Invalid option" ;;
esac