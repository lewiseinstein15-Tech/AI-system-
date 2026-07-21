# Architecture Documentation

## Overview

The Noctryx AI platform is built using a modern, serverless-first architecture leveraging Next.js 14 App Router. It follows a monolithic repository (monorepo) approach for the frontend, backend, and database configurations.

## Tech Stack

- **Frontend & API:** Next.js 14 (React Server Components, Route Handlers)
- **Language:** TypeScript (Strict Mode)
- **Database:** PostgreSQL managed via Prisma ORM
- **Authentication:** NextAuth.js (JWT strategy, Credentials Provider)
- **AI Integration:** Vercel AI SDK (@ai-sdk/openai), OpenAI GPT-4
- **Styling:** Tailwind CSS, Radix UI primitives
- **Deployment:** Docker containers, Vercel

## Folder Structure & Responsibilities

### src/app/

Contains the App Router.

- **api/:** Backend Route Handlers (REST APIs).
- **admin/:** Admin dashboard UI pages.
- **dashboard/:** Student dashboard UI pages.
- **auth/:** Authentication pages (Login, Register).

### src/components/

Reusable React components categorized by domain (e.g., `ui/` for generic UI, `chat/` for AI chat components).

### src/lib/

Shared utilities, Prisma Client instance, and NextAuth configuration.

### prisma/

Contains `schema.prisma` defining the database schema, relationships, and enums.

## Data Flow

1. **Client Request:** User interacts with the React UI.
2. **API Route:** Next.js Route Handler receives the request, validates session via NextAuth.
3. **Database:** Prisma Client queries the PostgreSQL database.
4. **AI Stream:** If an AI request, the Vercel AI SDK streams chunks from OpenAI back to the client via Server-Sent Events (SSE).
5. **Response:** JSON data or a streaming text response is returned to the client.

## Security Architecture

- **Authentication:** JWT tokens stored in secure cookies. Passwords hashed using bcryptjs.
- **Authorization:** Role-based access control (RBAC) enforced in API routes and Next.js middleware (`src/middleware.ts`).
- **Input Validation:** zod is used to validate all incoming API request bodies before processing.
- **Rate Limiting:** Configured via environment variables (simulated in current UI, to be enforced via Redis/Upstash).
