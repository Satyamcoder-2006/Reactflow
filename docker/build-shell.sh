#!/bin/bash
set -e

REPO_URL=${REPO_URL}
BRANCH=${BRANCH}
COMMIT=${COMMIT}
BUILD_ID=${BUILD_ID}
S3_BUCKET=${S3_BUCKET}

echo "=================================="
echo "🏗️  Building Shell APK"
echo "Repo: $REPO_URL"
echo "Branch: $BRANCH"
echo "Commit: $COMMIT"
echo "=================================="

# Clone repository
echo "📥 Cloning repository..."
git clone --depth 1 --branch $BRANCH $REPO_URL /app/repo
cd /app/repo

# Checkout specific commit
git fetch origin $COMMIT
git checkout $COMMIT

# Detect package manager
if [ -f "pnpm-lock.yaml" ]; then
    echo "📦 Detected pnpm"
    npm install -g pnpm
    pnpm install --frozen-lockfile
elif [ -f "yarn.lock" ]; then
    echo "📦 Detected yarn"
    yarn install --frozen-lockfile
else
    echo "📦 Detected npm"
    npm ci
fi

# Detect React Native type
if [ -f "app.json" ]; then
    echo "🔍 Detected Expo project"
    # For Expo projects, might need prebuild
    if command -v npx expo &> /dev/null; then
        npx expo prebuild --platform android --clean
    fi
fi

# Build Android
echo "🔨 Building Android APK..."
cd android

./gradlew assembleDebug \
    --no-daemon \
    --build-cache \
    --parallel \
    --max-workers=4 \
    -Dorg.gradle.caching=true \
    -Dorg.gradle.parallel=true \
    -Dorg.gradle.configureondemand=true

# Find APK
APK_PATH=$(find app/build/outputs/apk/debug -name "*.apk" | head -n 1)

if [ -z "$APK_PATH" ]; then
    echo "❌ APK not found!"
    exit 1
fi

echo "✅ Build successful: $APK_PATH"

# Upload to S3
S3_PATH="s3://${S3_BUCKET}/shells/${COMMIT}/app-debug.apk"
echo "📤 Uploading to $S3_PATH..."
aws s3 cp $APK_PATH $S3_PATH

echo "🎉 Build complete!"
echo "APK URL: $S3_PATH"
