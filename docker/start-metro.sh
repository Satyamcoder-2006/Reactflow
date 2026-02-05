#!/bin/bash

REPO_PATH=${REPO_PATH:-/app/repo}

echo "🚀 Starting Metro bundler for: $REPO_PATH"

cd $REPO_PATH

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start Metro
echo "✅ Metro bundler ready"
npx react-native start \
    --host 0.0.0.0 \
    --port 8081 \
    --reset-cache
