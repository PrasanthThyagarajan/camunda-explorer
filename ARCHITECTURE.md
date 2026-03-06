# Architecture Notes

Quick overview of how this project is put together. Two apps share one codebase:

- **MCP Server** (`npm run dev:run`) — STDIO transport, used by AI agents (Cursor, Claude). Entry point: `src/index.ts`.
- **Dashboard** (`npm run dashboard`) — Express server at port 3333. Entry point: `src/dashboard/server.ts`.

---

## Tech stack

**Backend** is TypeScript (strict mode, ESM). **Frontend** is vanilla JS using ES modules — no React, no bundler, just browser-native `import/export`. Styling is plain CSS with custom properties for theming.

Runtime deps: `express`, `axios`, `zod`, `@modelcontextprotocol/sdk`, `cors`, `dotenv`.
Dev deps: `typescript`, `tsx` (for running TS directly), `rimraf`.

---

## Layers

The backend follows a rough layered structure:

```
Presentation    →  routes/, tools/, public/js/
Application     →  services/
Domain          →  interfaces/, parsers/
Infrastructure  →  repositories/, client/
```

**Routes** handle HTTP, **tools** handle MCP protocol calls, **services** contain business logic, **repositories** deal with persistence (JSON files for now), and **parsers** do the XML analysis work.

The dashboard wires everything together in `server.ts` — that's the composition root where dependencies get created and injected.

---

## Folder layout

```
src/
├── index.ts                    MCP server entry
├── dashboard/server.ts         Dashboard entry (composition root)
├── config.ts                   Reads env vars
├── constants.ts                Shared constants
├── interfaces/                 Contracts (ICamundaApiClient, IToolModule, etc.)
├── services/                   EnvironmentService, IncidentService
├── repositories/               JSON file persistence
├── routes/                     Express route factories
├── tools/                      10 MCP tool modules, ~60 tools total
├── resources/                  MCP resources (BPMN/DMN XML)
├── prompts/                    MCP prompt templates
├── parsers/                    BPMN & DMN XML parsers
├── middleware/                 Error handler
├── client/                     Axios client factory + interceptors
└── utils/                      Logger, response formatter, safeToolHandler

public/
├── index.html                  Shell (no inline JS/CSS)
├── css/styles.css              Everything visual
└── js/
    ├── app.js                  Bootstraps the frontend, binds to window
    ├── state.js                Shared state + panel registry
    ├── api-client.js           fetch() wrapper
    ├── panels/                 One JS file per sidebar panel (11 files)
    └── components/             Modify dialog, query explorer
```

---

## Key patterns

**Composition root** — `dashboard/server.ts` and `app.js` are the only places that create concrete instances and wire things together. Everything else receives its dependencies.

**Repository pattern** — `EnvironmentRepository` wraps JSON file I/O behind an `IEnvironmentRepository` interface. If you wanted to swap to a database, you'd only change this class.

**Tool registry** — `tools/index.ts` keeps an array of `IToolModule` objects. Each module registers its own tools on the MCP server. Adding a new domain means writing a new module and appending it to the array — nothing else changes.

**safeToolHandler** — a wrapper that catches errors in MCP tool handlers and formats them consistently. Keeps the try/catch boilerplate out of every tool.

**asyncHandler** — same idea for Express routes. Catches async errors and forwards them to the error middleware.

**Proxy route** — `/api/*` requests get forwarded straight to the active Camunda engine with auth injected. The frontend talks to `/api/incident` and the proxy turns it into a call to `https://your-camunda/engine-rest/incident`.

**Panel registry** — on the frontend, each panel file registers itself in `state.js` so the navigation system knows how to load it. Same idea as the tool registry but for UI panels.

---

## How data flows

There are two paths depending on who's asking:

```
AI agent  →  STDIO  →  MCP Server  →  tool modules  →  Axios  →  Camunda REST API
Browser   →  HTTP   →  Express     →  /api/* proxy   →  Axios  →  Camunda REST API
                                   →  /environments  →  service → repository → JSON file
```

The MCP path and the dashboard proxy path both end up making the same kind of HTTP calls to Camunda. The difference is just the transport layer on the client side.

---

## SOLID in practice

Not going to lecture about theory — here's where it actually shows up:

- **Single responsibility**: parsers only parse, services only contain logic, routes only map HTTP, repositories only do persistence.
- **Open/closed**: the tool and panel registries are arrays you extend by appending. You never touch existing module code to add something new.
- **Liskov**: `EnvironmentRepository` can be swapped for any `IEnvironmentRepository`. All 10 tool modules implement the same `IToolModule` interface and are interchangeable.
- **Interface segregation**: `ICamundaApiClient` only has `get/post/put/delete` — not the full Axios surface. DTOs are split by use case (create, update, safe-for-UI).
- **Dependency inversion**: services depend on interfaces. The composition root decides which concrete classes to use.
