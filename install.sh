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
REPO_DIR="$HOME/openclaw-bridge-remote"
if [ -d "$REPO_DIR" ]; then
    echo -e "${BLUE}Found existing bridge at $REPO_DIR. Updating...${NC}"
    echo -e "${BLUE}(Tip: If update fails, run 'rm -rf $REPO_DIR' and reinstall)${NC}"
    cd "$REPO_DIR"
    git pull origin main
else
    echo -e "${BLUE}Cloning openclaw-bridge-remote to $REPO_DIR...${NC}"
    git clone https://github.com/lucas-jo/openclaw-bridge-remote.git "$REPO_DIR"
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
# Use /dev/tty to read input even when piped from curl
if [ -c /dev/tty ]; then
    if ! command -v tmux &> /dev/null; then
        echo -e "${RED}Warning: tmux is not installed.${NC}"
        echo -e "Background execution requires tmux. Install it via 'brew install tmux' for the best experience."
        echo ""
    fi

    echo -e "Would you like to start the bridge now in a background tmux session? (y/N)"
    read -r START_NOW < /dev/tty
    if [[ $START_NOW =~ ^[Yy]$ ]]; then
        if command -v tmux &> /dev/null; then
            echo -e "${BLUE}Starting bridge in tmux session 'openclaw-bridge'...${NC}"
            # Resolve absolute paths for stability in tmux
            BUN_PATH=$(command -v bun)
            TMUX_PATH=$(command -v tmux)
            
            # Kill existing if any
            $TMUX_PATH kill-session -t openclaw-bridge 2>/dev/null || true
            $TMUX_PATH new-session -d -s openclaw-bridge "cd $REPO_DIR && $BUN_PATH run start"
            echo -e "${GREEN}✔ Bridge started in background (tmux).${NC}"
            echo -e "Use ${BLUE}'$TMUX_PATH attach -t openclaw-bridge'${NC} to see the logs."
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
echo -e "  ${BLUE}https://github.com/lucas-jo/openclaw-bridge-remote/blob/main/RECIPES.md${NC}"
echo ""
echo -e "Happy hybrid coding! 🦞🚀"
