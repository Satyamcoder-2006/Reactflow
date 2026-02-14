#!/bin/bash
set -e

REPO_ID=${REPO_ID:-"unknown"}
COMMIT_SHA=${COMMIT:-"latest"}
OUTPUT_DIR="/output/${REPO_ID}/${COMMIT_SHA}"

echo "=================================="
echo "🚀 Starting optimized build"
echo "Repo ID: $REPO_ID"
echo "Commit: $COMMIT_SHA"
echo "Output: $OUTPUT_DIR"
echo "=================================="

# 1. CRITICAL: Clear stale Gradle locks from host-mounted cache
echo "🧹 Cleaning stale Gradle locks..."
find /root/.gradle/caches -name "*.lock" -delete 2>/dev/null || true
find /root/.gradle/daemon -name "*.lock" -delete 2>/dev/null || true
echo "✅ Lock files cleared"

# 2. Clone repository
echo "📥 Cloning repository..."
repo_path="/app/repo"
rm -rf "$repo_path"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$repo_path"
cd "$repo_path"

# Checkout specific commit
git fetch origin "$COMMIT_SHA"
git checkout "$COMMIT_SHA"

# 3. Detect package manager
if [ -f "pnpm-lock.yaml" ]; then
    echo "📦 Detected pnpm"
    pnpm install --frozen-lockfile
elif [ -f "yarn.lock" ]; then
    echo "📦 Detected yarn"
    yarn install --frozen-lockfile
else
    echo "📦 Detected npm"
    npm ci
fi

# 4. Detect React Native type and run prebuild
if [ -f "app.json" ]; then
    echo "🔍 Detected Expo project"
    if command -v npx expo &> /dev/null; then
        echo "📱 Running Expo prebuild (incremental)..."
        npx expo prebuild --platform android
    fi
fi

# 5. Build Android
echo "🔨 Building Android APK..."
cd android

./gradlew assembleDebug \
    --no-daemon \
    --build-cache \
    --parallel \
    --max-workers=4 \
    -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=512m -XX:+HeapDumpOnOutOfMemoryError" \
    -Dorg.gradle.vfs.watch=false

# 6. Find and move APK
APK_PATH=$(find app/build/outputs/apk/debug -name "*.apk" | head -n 1)

if [ -z "$APK_PATH" ] || [ ! -f "$APK_PATH" ]; then
    echo "❌ APK not found in build directory!"
    ls -la app/build/outputs/apk/debug/ || echo "Debug directory not found"
    exit 1
fi

echo "✅ Build successful: $APK_PATH"

# Create output directory
mkdir -p "$OUTPUT_DIR"
echo "📁 Ensured output directory: $OUTPUT_DIR"

# Copy APK to persistent output
cp "$APK_PATH" "$OUTPUT_DIR/shell.apk"

# Verify APK move
if [ ! -f "$OUTPUT_DIR/shell.apk" ]; then
    echo "❌ FATAL: APK copy to output directory failed!"
    exit 1
fi

# Generate metadata 
APK_SIZE=$(stat -c%s "$OUTPUT_DIR/shell.apk" 2>/dev/null || stat -f%z "$OUTPUT_DIR/shell.apk")
echo "✅ APK verified in output: $APK_SIZE bytes"

cat > "$OUTPUT_DIR/build-info.json" <<EOF
{
  "repoId": "${REPO_ID}",
  "commitSha": "${COMMIT_SHA}",
  "buildTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "apkPath": "${OUTPUT_DIR}/shell.apk",
  "apkSize": ${APK_SIZE}
}
EOF

echo "🎉 Build complete! APK stored at: $OUTPUT_DIR/shell.apk"
ls -lh "$OUTPUT_DIR/"
