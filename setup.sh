#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Cast — Setup Script          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v 2>/dev/null || echo 'not found')"
  echo "   Install from: https://nodejs.org"
  exit 1
fi
echo -e "✅ Node.js $(node -v)"

# Install backend dependencies
echo ""
echo -e "${YELLOW}Installing backend dependencies...${NC}"
cd backend
npm install --ignore-scripts
echo -e "${GREEN}✅ Backend dependencies installed${NC}"

# Install frontend dependencies
echo ""
echo -e "${YELLOW}Installing frontend dependencies...${NC}"
cd ../frontend
npm install
echo -e "${GREEN}✅ Frontend dependencies installed${NC}"

cd ..

# Create .env if missing
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  # Generate a random JWT secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/your-secret-key-change-this-in-production/$JWT_SECRET/" backend/.env
  else
    sed -i "s/your-secret-key-change-this-in-production/$JWT_SECRET/" backend/.env
  fi
  echo -e "${GREEN}✅ Created backend/.env with random JWT secret${NC}"
else
  echo -e "✅ backend/.env already exists"
fi

# Create data directory
mkdir -p backend/data

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Add your Claude API key in the app (Settings page)"
echo "     Or set it in backend/.env:"
echo "     ANTHROPIC_API_KEY=sk-ant-..."
echo ""
echo "  2. For Starknet settlement, set in backend/.env:"
echo "     STARKNET_SIGNER_ADDRESS=0x..."
echo "     STARKNET_SIGNER_PRIVATE_KEY=0x..."
echo "     STARKNET_PAYMENT_CONTRACT=0x..."
echo ""
echo "  3. Start development:"
echo "     npm run dev"
echo ""
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:5173"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""
