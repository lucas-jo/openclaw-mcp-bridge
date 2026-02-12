#!/bin/bash

# OpenClaw MCP Bridge Installer
# "One-liner" to get your hands and eyes back to your local machine.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🦞 OpenClaw MCP Bridge Installer${NC}"
echo "------------------------------------------"

# 1. Check for Bun
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: Bun is not installed.${NC}"
    echo "Please install Bun first: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# 2. Clone or Update
REPO_DIR="$HOME/openclaw-mcp-bridge"
if [ -d "$REPO_DIR" ]; then
    echo -e "${BLUE}Found existing bridge at $REPO_DIR. Updating...${NC}"
    cd "$REPO_DIR"
    git pull origin main
else
    echo -e "${BLUE}Cloning openclaw-mcp-bridge to $REPO_DIR...${NC}"
    git clone https://github.com/lucas-jo/openclaw-mcp-bridge.git "$REPO_DIR"
    cd "$REPO_DIR"
fi

# 3. Install Dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
bun install

# 4. Setup .env template
if [ ! -f ".env" ]; then
    echo -e "${BLUE}Creating .env file...${NC}"
    GATEWAY_TOKEN=$(openclaw config get gateway.auth.token 2>/dev/null || echo "")
    
    cat <<EOF > .env
OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}
OPENCLAW_GATEWAY_HOST=127.0.0.1
OPENCLAW_GATEWAY_PORT=18790
BRIDGE_PORT=3100
BRIDGE_API_KEY=$(openssl rand -hex 16)
EOF
    echo -e "${GREEN}✔ .env file created with your OpenClaw token and a random API key.${NC}"
else
    echo -e "${BLUE}.env file already exists. Skipping...${NC}"
fi

echo "------------------------------------------"
echo -e "${GREEN}🎉 Installation Complete!${NC}"
echo ""

# 5. Optional Start
if [[ -t 0 ]]; then
    echo -e "Would you like to start the bridge now in a background tmux session? (y/N)"
    read -r START_NOW
    if [[ $START_NOW =~ ^[Yy]$ ]]; then
        if command -v tmux &> /dev/null; then
            echo -e "${BLUE}Starting bridge in tmux session 'openclaw-bridge'...${NC}"
            # Kill existing if any
            tmux kill-session -t openclaw-bridge 2>/dev/null || true
            tmux new-session -d -s openclaw-bridge "cd $REPO_DIR && bun run start"
            echo -e "${GREEN}✔ Bridge started in background (tmux).${NC}"
            echo -e "Use ${BLUE}'tmux attach -t openclaw-bridge'${NC} to see the logs."
        else
            echo -e "${RED}Error: tmux is not installed. Skipping background start.${NC}"
        fi
    fi
fi

echo "------------------------------------------"
echo -e "To use it in your remote agent (e.g. Cursor/OpenCode), use this URL:"
echo -e "  ${BLUE}http://$(tailscale ip -4 2>/dev/null || echo "<your-ip>"):3100/sse?apiKey=$(grep BRIDGE_API_KEY .env | cut -d'=' -f2)${NC}"
echo ""
echo -e "For advanced connectivity options (SSH tunneling, recipes), see:"
echo -e "  ${BLUE}https://github.com/lucas-jo/openclaw-mcp-bridge/blob/main/RECIPES.md${NC}"
echo ""
echo -e "Happy hybrid coding! 🦞🚀"
