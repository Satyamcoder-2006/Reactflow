FROM node:20-slim

# Install git and other build tools
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Expose Metro bundler port
EXPOSE 8081

# Start Metro bundler
CMD ["npx", "react-native", "start", "--host", "0.0.0.0", "--reset-cache"]
