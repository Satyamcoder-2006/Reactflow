# ReactFlow Platform

> ☁️ Cloud-based React Native development platform — build, preview, and hot reload your app entirely in the browser.

---

## 🚀 Project Status

A fully integrated cloud pipeline for React Native development:

| Layer | Stack | Status |
|---|---|---|
| **Backend API** | Fastify + TypeScript + Prisma + PostgreSQL | ✅ Live |
| **Frontend** | Next.js 14 + Tailwind CSS + Dark Theme | ✅ Live |
| **Queue System** | BullMQ + Redis | ✅ Live |
| **Auth** | GitHub OAuth + JWT | ✅ Live |
| **Real-time Logs** | Socket.IO WebSocket streaming | ✅ Live |
| **Emulator** | Redroid (Android-in-Docker) | ✅ Live |
| **ADB Pipeline** | Install → Launch → Stream via MJPEG | ✅ Live |
| **Metro Bundler** | Managed hot reload over ADB reverse | ✅ Live |
| **Shell APK Cache** | SHA-256 native hash + S3 storage | ✅ Live |
| **Change Detection** | Git diff → native vs JS categorization | ✅ Live |

---

## 📁 Project Structure

```
reactflow/
├── backend/                    # Fastify API server (Node.js 20 + TypeScript)
│   ├── src/
│   │   ├── config/             # Environment & service configs
│   │   ├── db/                 # Prisma client setup
│   │   ├── events/             # Socket.IO event handlers
│   │   ├── middleware/         # Auth middleware
│   │   ├── queues/             # BullMQ queue definitions
│   │   ├── routes/             # REST API routes
│   │   │   ├── admin.ts        # Admin utilities
│   │   │   ├── auth.ts         # GitHub OAuth callback
│   │   │   ├── builds.ts       # Build trigger & status
│   │   │   ├── repos.ts        # Repository management
│   │   │   ├── sessions.ts     # Emulator session management & stream proxy
│   │   │   ├── webhooks.ts     # GitHub webhook receiver
│   │   │   └── webrtc.ts       # WebRTC signaling
│   │   ├── services/
│   │   │   ├── adb.service.ts           # ADB commands: connect, install, launch, stream
│   │   │   ├── change-detection.service.ts  # Git diff analyzer
│   │   │   ├── docker.service.ts        # Dockerode container management
│   │   │   ├── emulator.service.ts      # Session orchestration & lifecycle
│   │   │   ├── github.service.ts        # GitHub API (Octokit)
│   │   │   ├── metro.service.ts         # Metro bundler control
│   │   │   ├── shell.service.ts         # Shell APK caching logic
│   │   │   └── storage.service.ts       # AWS S3 upload/download
│   │   ├── workers/
│   │   │   ├── shell-builder.worker.ts  # Full native Android build
│   │   │   ├── hot-reload.worker.ts     # JS-only bundle push
│   │   │   ├── emulator-manager.worker.ts # Emulator start/stop lifecycle
│   │   │   ├── metro-manager.worker.ts  # Metro server start/stop
│   │   │   ├── session-cleanup.worker.ts # TTL-based session GC
│   │   │   ├── index.ts                 # Worker entrypoint
│   │   │   └── worker-auth.ts           # Shared worker auth
│   │   ├── schemas/            # Fastify JSON schemas
│   │   ├── types/              # TypeScript interfaces
│   │   └── utils/              # Crypto, hash, logger
│   └── prisma/
│       └── schema.prisma       # Database models
│
├── frontend/                   # Next.js 14 App Router
│   ├── app/
│   │   ├── page.tsx            # Landing page
│   │   ├── dashboard/          # User dashboard
│   │   ├── repos/              # Repository list & settings
│   │   ├── builds/             # Build history & live logs
│   │   └── preview/            # Emulator preview view
│   ├── components/
│   │   ├── preview/            # MJPEG viewer + input forwarding
│   │   ├── build/              # Live log stream component
│   │   ├── repo/               # Repo cards
│   │   ├── layout/             # Sidebar, navbar
│   │   └── ui/                 # Shared UI primitives
│   └── lib/                    # API client, auth config, hooks
│
├── docker/
│   ├── android-builder.Dockerfile   # Gradle + Android SDK build image
│   └── metro-server.Dockerfile      # Metro bundler server image
│
├── docker-compose.yml          # Local dev: Postgres + Redis + Redroid
└── scripts/                    # Helper shell scripts
```

---

## 🎯 Core Features

### 1. 🔨 Shell APK Caching
- Generates a **SHA-256 hash** of native dependencies (`package.json` native libs + `android/` config)
- Caches compiled APKs on **AWS S3** keyed by hash
- Reuses cached shells across multiple repositories with identical native deps
- **Cuts rebuild time from ~10 minutes → ~15 seconds** for JS-only changes

### 2. 🔍 Change Detection
- Analyzes `git diff` between the last build commit and the incoming webhook push
- Categorizes changes: **native** (requires full rebuild) vs **JS/TS** (hot reload only)
- Intelligently queues the appropriate job type — no wasted build time

### 3. ☁️ Cloud Build System
- **Dockerized Android builds** using the `android-builder` image (Gradle + Android SDK)
- **Queue-based job processing** via BullMQ (Redis-backed)
- **Real-time build logs** streamed to the browser over Socket.IO
- Separate workers: `shell-builder` for full native builds, `hot-reload` for JS bundle pushes

### 4. 📱 Emulator Pipeline (ADB → MJPEG → Browser)
- Spins up a **Redroid** (Android 12) container via Dockerode
- `adb.service.ts` handles full lifecycle:
  - ADB connect to container → `adb connect <host>:5555`
  - APK install → `adb install -r <apk>`
  - App launch → `adb shell am start -n <package>/.MainActivity`
  - **ADB reverse** for Metro hot reload → `adb reverse tcp:8081 tcp:8081`
  - **MJPEG screen capture** → `adb exec-out screenrecord --output-format=h264 ...` piped as MJPEG frames
- Preview streamed to browser as low-latency **MJPEG** (stable, no WebRTC dependencies)
- **Input forwarding**: tap/swipe events forwarded via `adb shell input tap/swipe`

### 5. 🔄 Metro Bundler Integration
- `metro.service.ts` manages a Metro server inside `metro-server` Docker container
- Configured to serve bundles at the Redroid container's IP
- ADB reverse tunnel ensures the Android app inside Redroid reaches Metro on `localhost:8081`

### 6. 🧹 Session Orchestration & Cleanup
- `emulator.service.ts` tracks active emulator sessions with TTL
- `session-cleanup.worker.ts` runs on a scheduled BullMQ repeatable job to garbage-collect expired sessions
- Prevents runaway Docker containers from accumulating on the host

---

## 🏗️ Architecture

```
GitHub Push
    │
    ▼
Webhook Route (POST /api/webhooks/github)
    │
    ▼
Change Detection Service
    │
    ├─── Native changes ──▶ Shell Builder Worker ──▶ Android Build (Docker)
    │                                                       │
    └─── JS changes ──────▶ Hot Reload Worker              │
                                    │                       │
                                    ▼                       ▼
                             Metro Bundler          APK → S3 Storage
                                    │                       │
                                    └────────┬──────────────┘
                                             ▼
                                   ADB → Redroid Emulator
                                             │
                                        MJPEG Stream
                                             │
                                         Browser
```

---

## 🔧 Setup Instructions

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Linux host (for Redroid kernel modules)
- AWS Account (S3 bucket)
- GitHub OAuth App

### 1. Clone & Install

```bash
git clone https://github.com/Satyamcoder-2006/Reactflow.git
cd reactflow

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Redroid Host Setup (Linux only)

```bash
# Load required kernel modules for Android-in-Docker
sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"
sudo modprobe ashmem_linux
```

### 3. Start Infrastructure

```bash
# From project root
docker-compose up -d postgres redis redroid
```

### 4. Backend

```bash
cd backend
cp .env.example .env
# Fill in your credentials in .env

npm run prisma:migrate   # Run DB migrations
npm run prisma:generate  # Generate Prisma client
npm run dev              # Start API server (port 3001)

# In a separate terminal, start workers
npm run workers
```

### 5. Frontend

```bash
cd frontend
cp .env.example .env.local
# Edit NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL

npm run dev              # Start Next.js (port 3000)
```

### 6. Build Docker Images

```bash
# Android builder image
docker build -f docker/android-builder.Dockerfile -t android-builder:latest docker/

# Metro server image
docker build -f docker/metro-server.Dockerfile -t metro-server:latest docker/
```

---

## 🔐 Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST` | Redis host (default: `localhost`) |
| `REDIS_PORT` | Redis port (default: `6379`) |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC secret |
| `AWS_ACCESS_KEY_ID` | AWS credentials for S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for S3 |
| `AWS_REGION` | S3 bucket region |
| `S3_BUCKET_NAME` | S3 bucket name for APK storage |
| `JWT_SECRET` | JWT signing secret |
| `REDROID_HOST` | Host IP where Redroid is reachable |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |
| `NEXT_PUBLIC_WS_URL` | WebSocket/Socket.IO URL |
| `NEXTAUTH_SECRET` | NextAuth session secret |
| `NEXTAUTH_URL` | App base URL for OAuth callback |

---

## 📊 Tech Stack

| Layer | Technology |
|---|---|
| **API Server** | Fastify 4, TypeScript, Pino logger |
| **Database** | PostgreSQL 15, Prisma ORM |
| **Queue** | BullMQ 5, Redis 7 |
| **Real-time** | Socket.IO 4 |
| **Storage** | AWS S3 (aws-sdk v2) |
| **Containers** | Dockerode, Redroid 12 |
| **ADB** | Custom `adb.service.ts` via child_process |
| **Frontend** | Next.js 14, Tailwind CSS, TypeScript |
| **Auth** | NextAuth.js (GitHub OAuth) |
| **Image Processing** | Sharp (frame optimization) |

---

## 📝 Development Roadmap

- [x] Phase 1: Project structure and foundation
- [x] Phase 2: Core backend services (GitHub, Docker, Storage, Shell)
- [x] Phase 3: Docker configurations (android-builder, metro-server)
- [x] Phase 4: Frontend structure, landing page, dark theme
- [x] Phase 5: BullMQ workers (shell-builder, hot-reload)
- [x] Phase 6: GitHub OAuth, webhook receiver, API routes
- [x] Phase 7: Dashboard, repository management, build history
- [x] Phase 8: Emulator preview system (Redroid + ADB + MJPEG)
- [x] Phase 9: ADB pipeline, Metro integration, session orchestration
- [ ] Phase 10: E2E testing and performance optimization
- [ ] Phase 11: Production deployment (AWS EC2 / GCP Cloud Run)

---

## 🤝 Contributing

This is an educational/demonstration project — contributions and feedback welcome!

---

## 📄 License

MIT

---

> Built with ❤️ for React Native developers who value their time.
