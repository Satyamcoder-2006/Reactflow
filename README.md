# ReactFlow Platform

Cloud-based development platform for React Native applications.

## 🚀 Project Status

This is a comprehensive implementation of a cloud React Native development platform with:

- ✅ **Backend API** - Fastify + TypeScript + Prisma + PostgreSQL
- ✅ **Frontend** - Next.js 14 + Tailwind + Dark Theme
- ✅ **Docker Configurations** - Android Builder, Metro Server, Redroid Emulator
- ✅ **Core Services** - GitHub, Shell Caching, Docker, Storage, Change Detection
- 🚧 **Workers** - BullMQ workers for build processing (in progress)
- 🚧 **Auth** - GitHub OAuth with NextAuth (in progress)

## 📁 Project Structure

```
reactflow/
├── backend/              # Fastify API server
│   ├── src/
│   │   ├── config/      # Environment and service configs
│   │   ├── db/          # Prisma client
│   │   ├── routes/      # API routes
│   │   ├── services/    # Business logic services
│   │   ├── workers/     # BullMQ workers
│   │   ├── utils/       # Utilities (crypto, hash, logger)
│   │   └── types/       # TypeScript types
│   └── prisma/          # Database schema
├── frontend/            # Next.js 14 application
│   ├── app/            # App router pages
│   ├── components/     # React components
│   ├── lib/            # Utilities and API client
│   └── styles/         # Global CSS
├── docker/             # Docker configurations
│   ├── android-builder.Dockerfile
│   ├── metro-server.Dockerfile
│   └── build scripts
└── docker-compose.yml  # Local development setup
```

## 🔧 Setup Instructions

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15
- Redis 7
- AWS Account (for S3)
- GitHub OAuth App

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your credentials

# Start database services
docker-compose up -d postgres redis

# Run database migrations
npm run prisma:migrate

# Generate Prisma client
npm run prisma:generate

# Start development server
npm run dev
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local
echo "NEXT_PUBLIC_WS_URL=http://localhost:3001" >> .env.local

# Start development server
npm run dev
```

### Build Docker Images

```bash
# Build Android builder image
docker build -f docker/android-builder.Dockerfile -t android-builder:latest docker/

# Build Metro server image
docker build -f docker/metro-server.Dockerfile -t metro-server:latest docker/
```

## 🎯 Core Features

### 1. Shell APK Caching
- Generates SHA-256 hash of native dependencies
- Caches compiled APKs
- Reuses shells across repositories with same dependencies
- Reduces 10-minute rebuilds to 15-second hot reloads

### 2. Change Detection
- Analyzes git diffs between commits
- Categorizes changes (native vs JS)
- Intelligently triggers full rebuild or hot reload

### 3. Cloud Build System
- Dockerized Android builds with Gradle caching
- Queue-based job processing with BullMQ
- Real-time build logs via WebSocket

### 4. Browser Preview
- WebRTC-based emulator streaming
- Click-to-tap input handling
- Low-latency preview (<150ms)

## 📊 Architecture

```
GitHub → Webhook → Change Detection → Build Queue
                                          ↓
                            Shell Builder / Hot Reload Worker
                                          ↓
                              S3 Storage ← Docker Container
                                          ↓
                          Metro Bundler → Redroid Emulator
                                          ↓
                              WebRTC Stream → Browser
```

## 🔐 Environment Variables

See `.env.example` files in backend and frontend directories.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST` - Redis host
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - OAuth credentials
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - S3 credentials
- `JWT_SECRET` - Session secret

## 📝 Development Roadmap

- [x] Phase 1: Project structure and foundation
- [x] Phase 2: Core backend services
- [x] Phase 3: Docker configurations
- [x] Phase 4: Frontend structure and landing page
- [ ] Phase 5: BullMQ workers implementation
- [ ] Phase 6: GitHub OAuth and API routes
- [ ] Phase 7: Dashboard and repository management
- [ ] Phase 8: Emulator preview system
- [ ] Phase 9: Testing and optimization
- [ ] Phase 10: Production deployment

## 🚀 Deployment

Deployment guides will be added for:
- AWS EC2 / ECS
- Google Cloud Run
- Kubernetes

## 📄 License

MIT

## 🤝 Contributing

This is an educational/demonstration project. Contributions welcome!

---

Built with ❤️ for React Native developers who value their time.
