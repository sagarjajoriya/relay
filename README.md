# Relay

A Slack/Discord clone built incrementally to learn backend architecture and system design.

Stack: Next.js (`apps/web`), NestJS (`apps/api`), PostgreSQL + Prisma (`packages/db`), shared zod contracts (`packages/contracts`). pnpm workspaces + Turborepo.

## Milestone status

- **M1 — Identity & Workspaces**: done. Register/login (JWT access + rotating refresh tokens), workspace create/join/list with roles.
- **M2 — Channels & Messages (REST)**: done. Public/private channels (DM type reserved), channel membership gating private access, send/list/edit/soft-delete messages with keyset cursor pagination. No real-time yet — that's M3.
- **M3 — Real-time core**: done. Socket.io gateway with JWT-verified handshake, per-channel rooms with server-side access checks on join, live `message.created/updated/deleted` broadcasts driven by domain events, ephemeral typing indicators. Single-instance only — cross-instance fan-out via Redis is M4.
- **M4 — Redis**: done. Socket.io Redis adapter for cross-instance room broadcasts (the two-instance failure was demonstrated first, then fixed with zero gateway changes), plus workspace presence (online/offline events + `GET /workspaces/:id/presence`) built on cross-instance `fetchSockets()` room queries rather than hand-rolled Redis counters.
- **M5 — Queues (BullMQ)**: done. Notification fan-out runs as queue jobs off the same `message.created` domain event the gateway hears: in-app `Notification` rows for every visible recipient (author excluded), email only to users offline in the workspace (M4 presence decides), 5 attempts with exponential backoff, idempotent worker (`@@unique([userId, messageId])` + email-once), `GET /notifications`. Dev mailer logs instead of SMTP; addresses starting `fail-` throw to exercise retries.

## Local setup

### 1. Postgres + Redis

No Docker Compose yet — use whichever is lowest-friction for you:

```bash
# Option A: Homebrew
createdb relay
brew install redis && brew services start redis

# Option B: single Docker containers, no compose needed
docker run --name relay-postgres \
  -e POSTGRES_USER=relay -e POSTGRES_PASSWORD=relay -e POSTGRES_DB=relay \
  -p 5432:5432 -d postgres:16
docker run --name relay-redis -p 6379:6379 -d redis:7
```

Point `DATABASE_URL` / `REDIS_URL` at whichever you used (see `.env.example` files below).

### 2. Env files

```bash
cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Generate a real `JWT_ACCESS_SECRET` in `apps/api/.env`:

```bash
openssl rand -hex 32
```

### 3. Install & migrate

```bash
pnpm install
pnpm db:migrate   # creates the initial schema
```

### 4. Run

```bash
pnpm dev   # runs api (:4000) and web (:3002) in parallel via Turborepo
```

Visit http://localhost:3002, register an account, create a workspace.

## Architecture notes

- **Auth**: JWT access tokens (15m, stateless) + rotating refresh tokens (hashed in Postgres, reuse detection revokes the whole chain). See `apps/api/src/auth/auth.service.ts`.
- **Validation**: zod schemas live in `packages/contracts` and are the single source of truth for request shapes — consumed by the API via `ZodValidationPipe` and by the web app directly, instead of duplicating rules across a class-validator DTO layer and frontend form validation.
- **Multi-tenancy**: shared schema, `workspaceId` foreign keys. Roles are a plain enum on `WorkspaceMember`; a real permissions system is deferred to the authorization-hardening milestone once there's enough surface area to justify it.
- **Message pagination**: keyset (cursor) pagination over `(createdAt, id)`, not offset — stable under concurrent inserts and no offset scan cost. The cursor is an opaque base64 blob so its internals can change without breaking clients. See `apps/api/src/messages/cursor.ts`.
- **Soft delete**: messages are tombstoned (`deletedAt`), not removed, so future thread replies don't dangle and clients render "message deleted". Message payloads are defined once in `@relay/contracts` in the exact shape M3 will broadcast over WebSocket.
- **Channel access**: public channels are open to any workspace member (no membership row); private channels require an explicit `ChannelMember` row and 404 (not 403) to non-members so their existence never leaks.
- **Real-time**: the HTTP write path emits domain events (`@nestjs/event-emitter`); the Socket.io gateway subscribes and broadcasts to per-channel rooms. The write path doesn't know the gateway exists — queue producers (M5) subscribe to the same events. Handshake is JWT-verified via Socket.io middleware (unauthenticated sockets never connect); `channel.join` re-runs the same `assertCanAccess` gate as REST. WS payloads reuse the REST `MessageResponse` contract verbatim.
- **Cross-instance fan-out**: the Socket.io Redis adapter (`apps/api/src/realtime/redis-io.adapter.ts`) publishes room broadcasts through Redis pub/sub, so any number of API instances behave as one. Run a second instance with `PORT=4001 node dist/main.js` — sockets on one instance receive writes made through the other.
- **Presence**: derived from adapter room state (`fetchSockets()` spans all instances), not bespoke Redis counters — room membership dies with its socket, so a crashed instance can never leave a user stuck "online". Online/offline events fire only on a user's first-connect/last-disconnect transitions (multi-device safe).
- **Queues**: jobs carry IDs, not payloads — the worker re-reads authoritative state at processing time (a message deleted between enqueue and process is skipped). At-least-once delivery means the worker owns idempotency: notification inserts dedupe on `(userId, messageId)`, email only touches rows not yet emailed, and the deterministic `jobId` (`fanout-<messageId>`; BullMQ forbids `:` in custom ids) prevents double-enqueue. The worker is in-process for now — decoupled in time, not space; extraction to a separate app is M10.
- **Docker**: intentionally not used yet beyond local Postgres. `docker-compose` shows up once there are multiple services worth orchestrating together (real-time workers, queues) — see the roadmap.
