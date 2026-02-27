# Camunda MCP Server — Architecture Quick Reference

> MCP Server + Dashboard for Camunda Platform v7.16.0 · Node.js ≥ 18

---

## What This Project Does

Two apps in one codebase:

| App | How it runs | Who uses it |
|---|---|---|
| **MCP Server** | `npm run dev:run` → STDIO pipe | AI agents (Cursor, Claude) call Camunda operations as tools |
| **Dashboard** | `npm run dashboard` → http://localhost:3333 | Humans manage environments, incidents, DMN, batch ops in a browser |

---

## Languages

| Language | Where | Notes |
|---|---|---|
| **TypeScript** | `src/` (all backend) | Strict mode, ES2022, Node16 ESM |
| **JavaScript** | `public/js/` (all frontend) | Vanilla ES Modules, zero frameworks |
| **HTML5** | `public/index.html` | Structure only — no inline JS or CSS |
| **CSS3** | `public/css/styles.css` | Dark theme, CSS custom properties, Grid + Flexbox |

---

## Architecture — 4 Layers

```
┌─────────────────────────────────────────────────┐
│  Presentation    routes/ · tools/ · public/js/  │  ← Handles requests & UI
├─────────────────────────────────────────────────┤
│  Application     services/                      │  ← Business logic
├─────────────────────────────────────────────────┤
│  Domain          interfaces/ · parsers/         │  ← Contracts & models
├─────────────────────────────────────────────────┤
│  Infrastructure  repositories/ · client/        │  ← File I/O, HTTP calls
└─────────────────────────────────────────────────┘
```

---

## Folder Structure (Key Files)

```
src/
├── index.ts                    # MCP Server entry point
├── dashboard/server.ts         # Dashboard entry point (composition root)
├── interfaces/                 # ICamundaApiClient, IToolModule, IEnvironmentRepository
├── services/                   # EnvironmentService, IncidentService
├── repositories/               # EnvironmentRepository (JSON file storage)
├── routes/                     # Express routes (environment, proxy, actions, config)
├── tools/                      # 10 MCP tool modules (~40+ tools)
├── parsers/                    # BPMN & DMN XML parsers
├── middleware/                 # Global error handler
└── utils/                      # Logger, response formatter, safeToolHandler

public/
├── index.html                  # HTML-only shell
├── css/styles.css              # All styles
└── js/
    ├── app.js                  # Entry point (imports → window bindings)
    ├── state.js                # Shared state & registries
    ├── api-client.js           # fetch() wrapper
    ├── panels/ (11 files)      # One file per dashboard panel
    └── components/ (2 files)   # Modify dialog, query explorer
```

---

## Design Patterns

| Pattern | Where | What it does |
|---|---|---|
| **Composition Root** | `dashboard/server.ts`, `app.js` | Single place that creates & wires all dependencies |
| **Repository** | `environment.repository.ts` | Hides file I/O behind `IEnvironmentRepository` interface |
| **Factory** | `camunda-client.factory.ts`, all `create*Routes()` | Functions that build configured objects |
| **Proxy** | `proxy.routes.ts` | Forwards `/api/*` to Camunda with auth injected |
| **Registry** | `tools/index.ts`, `state.js` | Array/object of modules — add new ones without changing existing code |
| **HOF / Decorator** | `safeToolHandler()`, `asyncHandler()` | Wraps functions with automatic error handling |
| **Strategy** | `incident.service.ts` | `batchResolve(strategy: "retry" \| "delete")` — swappable behavior |
| **Singleton** | `config.ts`, `state.js` | One shared instance for the entire app lifetime |
| **DTO** | `interfaces/environment.ts` | Separate shapes for create, update, and safe-for-UI data |
| **Interceptor** | `camunda-client.ts` | Axios interceptors for logging & error mapping |
| **Barrel Export** | `interfaces/index.ts` | Re-exports everything from a folder via one file |
| **Module Pattern** | All `public/js/*.js` | ES Modules with private scope; only `app.js` touches `window` |

---

## SOLID Principles

| Principle | How it's applied |
|---|---|
| **S** — Single Responsibility | Each file does one thing: `repository` = persistence, `service` = logic, `routes` = HTTP mapping, `parser` = XML analysis |
| **O** — Open/Closed | Tool registry (`IToolModule[]`) and panel registry (`panelLoaders{}`) — extend by adding, never modifying |
| **L** — Liskov Substitution | `EnvironmentRepository` is swappable for any `IEnvironmentRepository`; all 10 tool modules are interchangeable `IToolModule` |
| **I** — Interface Segregation | `ICamundaApiClient` exposes only `get/post/put/delete` (not all of Axios); DTOs are split per use-case |
| **D** — Dependency Inversion | Services depend on interfaces, not implementations. Concrete classes are injected at the composition root |

---

## Libraries

### Runtime

| Library | Why |
|---|---|
| **@modelcontextprotocol/sdk** | MCP protocol — tools, resources, prompts, STDIO transport |
| **express** | HTTP server for dashboard API + static files |
| **axios** | HTTP client to call Camunda REST API |
| **zod** | Schema validation for MCP tool parameters |
| **cors** | Cross-origin support for dashboard |
| **dotenv** | Loads `.env` config into `process.env` |

### Dev-only

| Library | Why |
|---|---|
| **typescript** | Type safety, strict compilation |
| **tsx** | Run `.ts` files directly in dev (no build step) |
| **@types/*** | Type definitions for Node, Express, CORS |
| **rimraf** | Clean `dist/` folder |
| **@modelcontextprotocol/inspector** | Debug MCP tools in a browser UI |

### Frontend

**Zero dependencies** — vanilla JS + browser `fetch`.

---

## Data Flow (2 paths)

```
AI Agent  →  STDIO  →  MCP Server  →  Tools  →  ICamundaApiClient  →  Axios  →  Camunda API
Browser   →  HTTP   →  Express     →  /api/* proxy                 →  Axios  →  Camunda API
                                   →  /environments                →  Service → Repository → JSON file
```
