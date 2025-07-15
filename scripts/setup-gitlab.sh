set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/volume1/docker/gw2-eternal-vat"

echo -e "${BLUE}=== GitLab Setup for GW2 Eternal VAT ===${NC}\n"

if ! command -v git &> /dev/null; then
    echo -e "${RED}Git is not installed!${NC}"
    echo "Please install Git from Synology Package Center first."
    exit 1
fi

cd "$APP_DIR" || exit 1

if [ -d .git ]; then
    echo -e "${YELLOW}This directory is already a git repository.${NC}"
    echo "Current remote: $(git remote get-url origin 2>/dev/null || echo 'No remote set')"
    read -p "Continue with setup? (y/n): " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
fi

echo -e "\n${GREEN}Step 1: GitLab Repository${NC}"
echo "Enter your GitLab repository URL"
echo "Example: https://gitlab.com/username/gw2-eternal-vat.git"
read -p "GitLab URL: " GITLAB_URL

if [[ ! "$GITLAB_URL" =~ ^https:// ]]; then
    echo -e "${RED}Error: URL must start with https://${NC}"
    exit 1
fi

if [ ! -d .git ]; then
    git init
    echo -e "${GREEN}✓ Git repository initialized${NC}"
fi

if git remote | grep -q origin; then
    git remote set-url origin "$GITLAB_URL"
    echo -e "${GREEN}✓ Updated origin remote${NC}"
else
    git remote add origin "$GITLAB_URL"
    echo -e "${GREEN}✓ Added origin remote${NC}"
fi

echo -e "\n${GREEN}Step 2: Authentication${NC}"
echo "Choose authentication method:"
echo "1) Personal Access Token (recommended)"
echo "2) SSH Key"
read -p "Choice (1 or 2): " AUTH_CHOICE

if [ "$AUTH_CHOICE" = "1" ]; then
    echo -e "\n${YELLOW}Personal Access Token Setup${NC}"
    echo "1. Go to GitLab → Settings → Access Tokens"
    echo "2. Create a token with 'read_repository' scope"
    echo "3. Copy the token"
    read -p "Enter your GitLab username: " GITLAB_USER
    read -s -p "Enter your Personal Access Token: " GITLAB_TOKEN
    echo

    git config credential.helper store
    echo "https://${GITLAB_USER}:${GITLAB_TOKEN}@${GITLAB_URL#https://}" > ~/.git-credentials
    chmod 600 ~/.git-credentials
    
    echo -e "${GREEN}✓ Token authentication configured${NC}"
    
elif [ "$AUTH_CHOICE" = "2" ]; then
    echo -e "\n${YELLOW}SSH Key Setup${NC}"
    
    if [ ! -f ~/.ssh/id_rsa ]; then
        echo "Generating SSH key..."
        ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
    fi
    
    echo -e "\n${GREEN}Your SSH public key:${NC}"
    cat ~/.ssh/id_rsa.pub
    echo -e "\n${YELLOW}Add this key to GitLab:${NC}"
    echo "1. Go to GitLab → Settings → SSH Keys"
    echo "2. Paste the key above"
    echo "3. Give it a title like 'Synology NAS'"
    read -p "Press Enter after adding the key..."

    SSH_URL=$(echo "$GITLAB_URL" | sed 's|https://gitlab.com/|git@gitlab.com:|')
    git remote set-url origin "$SSH_URL"
    
    echo -e "${GREEN}✓ SSH authentication configured${NC}"
fi

echo -e "\n${GREEN}Step 3: Testing Connection${NC}"
if git ls-remote origin >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Successfully connected to GitLab!${NC}"
else
    echo -e "${RED}✗ Failed to connect to GitLab${NC}"
    echo "Please check your repository URL and authentication"
    exit 1
fi

if [ ! -f .gitignore ]; then
    cat > .gitignore << 'EOF'
.env
data/
logs/
backups/
*.log
.DS_Store
node_modules/
coverage/
.last-update
EOF
    echo -e "${GREEN}✓ Created .gitignore${NC}"
fi

if ! git rev-parse HEAD >/dev/null 2>&1; then
    echo -e "\n${GREEN}Step 4: Initial Commit${NC}"
    read -p "Create initial commit? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git add .
        git commit -m "Initial commit from Synology NAS"
        git branch -M main
        git push -u origin main
        echo -e "${GREEN}✓ Initial commit pushed${NC}"
    fi
else
    echo -e "\n${GREEN}Step 4: Syncing with GitLab${NC}"
    git fetch origin

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "")
    
    if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
        echo -e "${YELLOW}Your local repository is out of sync with GitLab${NC}"
        echo "Run ./scripts/update.sh to sync"
    else
        echo -e "${GREEN}✓ Repository is up to date${NC}"
    fi
fi

echo -e "\n${GREEN}Step 5: Discord Notifications (Optional)${NC}"
read -p "Configure Discord webhook for update notifications? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter Discord webhook URL: " WEBHOOK_URL
    echo "UPDATE_WEBHOOK_URL=\"$WEBHOOK_URL\"" >> "$APP_DIR/.env"
    echo -e "${GREEN}✓ Webhook configured${NC}"
fi

cat > "$APP_DIR/.gitlab-ci-vars" << EOF
# GitLab CI/CD Variables
# Add these to your GitLab project settings
DISCORD_WEBHOOK_URL=$WEBHOOK_URL
EOF

echo -e "\n${GREEN}✅ Setup Complete!${NC}"
echo -e "\nNext steps:"
echo "1. Copy .gitlab-ci.yml to your repository"
echo "2. Push your code to GitLab"
echo "3. Use ./scripts/update.sh to pull updates"
echo ""
echo -e "${BLUE}Quick Commands:${NC}"
echo "  ./scripts/update.sh     - Pull and deploy updates"
echo "  ./scripts/logs.sh       - View bot logs"
echo "  ./scripts/status.sh     - Check bot status"
echo ""
echo -e "${YELLOW}Remember to add .gitlab-ci.yml to your repository!${NC}"