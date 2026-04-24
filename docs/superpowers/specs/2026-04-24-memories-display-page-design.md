# Design: Memories Display Page

## Overview

A server-rendered HTML page at `/` for viewing Barnaby memories with pagination, filtering by category and tags, and full detail display. The page is protected by the same basic auth already used by the API.

## Goals

- Provide a simple, fast way to view memories in a browser
- Support pagination through large memory collections
- Allow filtering by category and tags
- Keep the implementation minimal: no React, no CSS framework, no client-side JS

## Architecture

### Basic Auth — App Level

Move `@fastify/basic-auth` registration from `src/routes/memories/index.ts` to `src/app.ts` so all routes (`/` and `/memories`) share the same protection. No route-level auth configuration needed after this.

### Template Engine

Register `@fastify/view` (the maintained successor to `point-of-view`) with `handlebars` as the engine. Templates live in `src/templates/`.

### Route Structure

- `src/routes/memories/index.ts` — API routes (existing, minus basic auth registration)
- `src/routes/pages/index.ts` — HTML page route at `/`
- `src/templates/layout.hbs` — shared HTML wrapper
- `src/templates/memories.hbs` — memories list, filters, pagination

## Data Flow

1. Browser requests `/`
2. Basic auth challenge → browser prompts for credentials
3. On success, route handler reads `page`, `limit`, `category`, `tags` from query string
4. Calls `memoryRepository.findAll()` with those parameters
5. Renders `memories.hbs` inside `layout.hbs`
6. Browser displays HTML with memory list, filters, and pagination links

Pagination links preserve active filters: `/?category=note&tags=health&page=2`

## Page Design

### Layout (`layout.hbs`)

Minimal HTML5 boilerplate:
- `<title>Barnaby</title>`
- A single `<main>` content block yielded by child templates
- No CSS for this phase

### Memories Page (`memories.hbs`)

**Filter Controls**
- Category dropdown (all, appointment, note, todo, purchase)
- Tags input (comma-separated)
- Submit button

**Memory List**
For each memory:
- Content
- Category
- Created date (formatted human-readable)
- Tags (comma-separated)
- Permanent indicator (if true)

**Pagination**
- "Previous" link (disabled/hidden on page 1)
- Current page / total pages display
- "Next" link (disabled/hidden on last page)

### Error Display

Invalid query parameters (bad page number, invalid category) render a simple error message inside the layout instead of raw JSON.

## API Changes

### `src/routes/memories/index.ts`

Remove the `@fastify/basic-auth` plugin registration and the `onRequest` hook. The routes themselves remain unchanged.

### `src/app.ts`

- Register `@fastify/basic-auth` before routes
- Register `@fastify/view` with Handlebars
- Register `memoryRoutes` at `/memories`
- Register `pageRoutes` at `/`

## Dependencies

- `@fastify/view` — Fastify template rendering plugin
- `handlebars` — template engine

Installed with `npm --save-exact` per project convention.

## Testing

E2E tests in `test/routes/pages.test.ts` using `inject()`:

- `GET /` without auth returns 401
- `GET /` with valid auth returns 200 and HTML containing memory content
- Pagination links include current filters
- Filtering by category returns only matching memories
- Invalid query parameters return 400 with HTML error message

## Success Criteria

- Page loads at `/` behind basic auth
- All memory details are visible
- Pagination works and preserves filters
- Category and tag filtering work
- Tests pass
- No regression in existing API behavior
