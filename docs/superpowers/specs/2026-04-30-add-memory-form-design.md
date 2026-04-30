# Add Memory Form — Design

## Context

Barnaby has a page at `GET /` (`src/templates/memories.hbs`) for browsing stored memories with filters and pagination. Memories are currently added only via `POST /memories` (JSON API). We want a simple HTML form on the same page so memories can be added directly in the browser.

## Goals

- Add a form to `memories.hbs` for creating new memories.
- On submit, perform the same validation as `POST /memories`.
- On success, redirect to `/` so the new memory appears in the list.
- On validation failure, re-render the page with an error and preserve the user's input.

## Approach

**Chosen: Approach A — `POST /` handler in page route**

We add a `POST /` handler inside `src/routes/pages/index.ts` rather than reusing the JSON API endpoint. This keeps page concerns (form parsing, redirects, re-rendering) out of the API handler and follows the existing page-route pattern.

## Data Flow

```
Browser submits HTML form to POST /
  -> POST / handler in src/routes/pages/index.ts
    -> Fastify body validation via createMemorySchema
      -> memoryRepository.create(body)
        -> reply.redirect('/')
```

On validation failure, the handler catches the error and re-renders `memories.hbs` with the error message and submitted values pre-filled.

## Changes

### 1. Template — `src/templates/memories.hbs`

Add a `<form method="post" action="/">` above the existing filter form with fields matching `CreateMemoryBody`:

- `content`: `<textarea required maxlength="2000">`
- `category`: `<select required>` with options `appointment`, `note`, `todo`, `purchase`
- `permanent`: `<input type="checkbox">`
- `tags`: `<input type="text" placeholder="comma-separated">`
- Submit button

### 2. Page Route — `src/routes/pages/index.ts`

- Import `createMemorySchema` from `../memories/schemas.js`.
- Add `fastify.post('/', { schema: createMemorySchema }, async ...)`:  
  - Parse body: split `tags` string by comma into array, coerce `permanent` from checkbox/string to boolean.
  - Call `request.server.memoryRepository.create(body)`.
  - Return `reply.redirect('/')`.
  - On validation failure, re-render the view with `error` and pre-filled `filters` / form values so the user can correct the input.

### 3. Tests — `test/routes/pages.test.ts`

- Test: `POST /` with valid form data → 302 redirect to `/`.
- Test: `POST /` with invalid data (e.g., empty content) → re-rendered HTML with error message and pre-filled values.

## Out of Scope

- Modifying `POST /memories` API handler.
- AJAX / HTMX submission (simple form POST + redirect is sufficient).
- File uploads or rich text editors.

## Error Handling

- Fastify schema validation errors are caught by the handler and result in re-rendering the page with an error message.
- Server errors fall through to the existing error-handler plugin.
