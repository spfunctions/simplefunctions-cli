#!/bin/bash
set -e

echo ""
echo "  SimpleFunctions CLI"
echo "  simplefunctions.dev"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo "  Node.js not found."
  echo ""
  echo "  Install Node.js first:"
  echo "    brew install node"
  echo "    or visit https://nodejs.org"
  echo ""
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  Node.js v18+ required (found v$NODE_VERSION)"
  exit 1
fi

echo "  Installing @spfunctions/cli..."
echo ""
npm install -g @spfunctions/cli

echo ""
echo "  Done. Run 'sf setup' to configure."
echo ""
