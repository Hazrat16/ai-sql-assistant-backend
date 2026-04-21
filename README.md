# AI SQL Assistant Backend

Fastify + PostgreSQL backend for natural-language-to-SQL generation, SQL compile/validation, and read-only query execution.

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 16+ (or Docker)
- Optional for free local AI: Ollama

## 1) Install Dependencies

```bash
npm install
```

## 2) Configure Environment

Create local env file:

```bash
cp .env.example .env
```

Minimum required variable:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_sql_assistant
```

## 3) Start Database

### Option A: Docker Compose (recommended)

From this backend folder:

```bash
docker compose -f docker-compose.yml up -d
```

This starts:

- `postgres` on `localhost:5432`
- `ollama` on `localhost:11434` (if present in compose file)

### Option B: Local PostgreSQL

Run PostgreSQL locally and create DB `ai_sql_assistant`, then set `DATABASE_URL` accordingly.

## 4) Run Migrations + Seed Data

```bash
npm run db:migrate
```

This applies:

- base schema (`users`, `orders`, etc.)
- seed data
- large test dataset (`big_customers`, `big_orders`, `big_order_items`, `big_products`)

## 5) Choose AI Mode

### Free and local (recommended): Ollama

1. Start Ollama (Docker compose service or local install).
2. Pull a model:

```bash
docker exec -it ai-sql-assistant-ollama ollama pull llama3.2
```

3. Set `.env`:

```env
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=llama3.2
OPENAI_RESPONSE_FORMAT=none
```

### Paid cloud option: OpenAI

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=
OPENAI_RESPONSE_FORMAT=json_object
```

### No AI key / provider available

Backend still works using built-in offline SQL fallback mode.

## 6) Start Backend

```bash
npm run dev
```

Backend runs at:

- `http://localhost:8000`

Health check:

- `GET http://localhost:8000/health`

## API Endpoints

- `POST /query` - NL to SQL
- `POST /compile` - parse + validate SQL (no execution)
- `POST /execute` - execute read-only SELECT
- `GET /schema` - introspect public schema

## Scripts

- `npm run dev` - start dev server with watch mode
- `npm run build` - compile TypeScript
- `npm run start` - run compiled app
- `npm run db:migrate` - apply SQL migrations
- `npm run lint` - run eslint

## Full Local Run (Frontend + Backend)

1. In backend folder:
   - `npm install`
   - `cp .env.example .env`
   - `docker compose -f docker-compose.yml up -d`
   - `npm run db:migrate`
   - `npm run dev`
2. In frontend folder:
   - `npm install`
   - `cp .env.example .env`
   - `npm run dev`
3. Open `http://localhost:3000`.

## Common Issues

- **`No such container: ai-sql-assistant-ollama`**
  - Run `docker compose -f docker-compose.yml up -d` first.
- **DB connection failure**
  - Verify `DATABASE_URL` and that Postgres is running on `5432`.
- **Frontend shows demo mode**
  - Set `NEXT_PUBLIC_API_URL=http://localhost:8000` in frontend `.env`.
