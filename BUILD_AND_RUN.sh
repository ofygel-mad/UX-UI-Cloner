#!/bin/bash

# Build and Run Script for CLONE_BROWSER
# This script rebuilds the entire project and starts all services

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🔨 CLONE_BROWSER - Full Rebuild"
echo "================================="
echo ""

# Step 1: Install dependencies
echo "📦 Step 1: Installing dependencies..."
pnpm install
echo "✓ Dependencies installed"
echo ""

# Step 2: Build API
echo "🛠️  Step 2: Building API server..."
cd apps/api
pnpm build
echo "✓ API built"
cd "$PROJECT_ROOT"
echo ""

# Step 3: Build Web UI
echo "🛠️  Step 3: Building Web UI..."
cd apps/web
pnpm build
echo "✓ Web UI built"
cd "$PROJECT_ROOT"
echo ""

# Step 4: Build Desktop
echo "🛠️  Step 4: Building Desktop app..."
cd apps/desktop
rm -rf dist
node ./scripts/build-desktop.mjs
echo "✓ Desktop app built"
cd "$PROJECT_ROOT"
echo ""

echo "================================="
echo "✅ Build complete!"
echo ""
echo "📋 Available commands:"
echo ""
echo "  API Server (development):"
echo "    cd apps/api && pnpm dev"
echo ""
echo "  Web UI (development):"
echo "    cd apps/web && pnpm dev"
echo ""
echo "  Desktop App:"
echo "    cd apps/desktop && npm start"
echo ""
echo "  Or run API in background and start desktop:"
echo "    cd apps/api && pnpm dev &"
echo "    cd apps/desktop && npm start"
echo ""
