# Relay

A Slack/Discord clone built incrementally to learn backend architecture and system design.

Stack: Next.js (`apps/web`), NestJS (`apps/api`), PostgreSQL + Prisma (`packages/db`), shared zod contracts (`packages/contracts`). pnpm workspaces + Turborepo.

## Milestone status

- **M1 — Identity & Workspaces**: done. Register/login (JWT access + rotating refresh tokens), workspace create/join/list with roles.

## Local setup

### 1. Postgres

No Docker Compose yet — use whichever is lowest-friction for you:

```bash
# Option A: already have Postgres running locally (e.g. via Homebrew)?
createdb relay

# Option B: a single Docker container, no compose needed
docker run --name relay-postgres \
  -e POSTGRES_USER=relay -e POSTGRES_PASSWORD=relay -e POSTGRES_DB=relay \
  -p 5432:5432 -d postgres:16
```

Point `DATABASE_URL` at whichever you used (see `.env.example` files below).

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
pnpm dev   # runs api (:4000) and web (:3000) in parallel via Turborepo
```

Visit http://localhost:3000, register an account, create a workspace.

## Architecture notes

- **Auth**: JWT access tokens (15m, stateless) + rotating refresh tokens (hashed in Postgres, reuse detection revokes the whole chain). See `apps/api/src/auth/auth.service.ts`.
- **Validation**: zod schemas live in `packages/contracts` and are the single source of truth for request shapes — consumed by the API via `ZodValidationPipe` and by the web app directly, instead of duplicating rules across a class-validator DTO layer and frontend form validation.
- **Multi-tenancy**: shared schema, `workspaceId` foreign keys. Roles are a plain enum on `WorkspaceMember`; a real permissions system is deferred to the authorization-hardening milestone once there's enough surface area to justify it.
- **Docker**: intentionally not used yet beyond local Postgres. `docker-compose` shows up once there are multiple services worth orchestrating together (real-time workers, queues) — see the roadmap.
