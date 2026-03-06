# Camunda Explorer

Two things in one repo:

- **Dashboard** — a web UI at `localhost:3333` where you can monitor your Camunda 7 engine, manage incidents, test DMN tables, and handle batch operations across multiple environments.
- **MCP Server** — an AI-friendly interface that lets tools like Cursor and Claude talk to your Camunda engine through natural language. It exposes 60+ operations as MCP tools.

Both share the same codebase and talk to the same Camunda REST API.

---

## Quick background on Camunda

If you're new to this: Camunda is a workflow engine. You draw a business process as a flowchart (BPMN), deploy it, and Camunda runs it. Think loan applications, insurance claims, onboarding flows — anything with steps.

When a step fails, Camunda creates an **incident**. When a step needs a person, it creates a **user task**. Camunda also supports **DMN** — decision tables that work like "if X then Y" spreadsheets.

The engine has a REST API, but no built-in tool for managing multiple environments at once, bulk-fixing incidents, or testing DMN with auto-generated forms. That's what this project does.

---

## Getting started

You need **Node.js 18+** and a running **Camunda 7** instance (v7.16 or later) with the REST API enabled.

```bash
cd camunda-explorer
npm install
```

**To run the dashboard:**

```bash
npm run dashboard
```

Then open http://localhost:3333.

**To run the MCP server** (for AI assistants):

```bash
npm run dev:run
```

This starts a STDIO-based server. Point your AI tool's MCP config at it.

**Optional `.env` file** (or just configure environments through the UI):

```env
CAMUNDA_BASE_URL=http://localhost:8080/engine-rest
CAMUNDA_USERNAME=demo
CAMUNDA_PASSWORD=demo
DASHBOARD_PORT=3333
```

---

## Features

### Environment Management

Sidebar → 🌐 Environments

You can connect to multiple Camunda servers (dev, staging, prod) and switch between them with one click. Every panel in the dashboard uses whichever environment is active.

Add an environment by filling in the name, URL, and optionally credentials + a color tag. Hit **Test Connection** to verify it works before saving. The active environment's color shows up in the sidebar so you always know where you're pointed.

Each environment card has actions: activate, test, edit, or delete.

### Engine Health

Sidebar → 📊 Engine Health (this is the default view)

Shows four summary cards — running instances, failed jobs, open incidents, and deployed process definitions. Below that is a table breaking it down per process definition so you can quickly see which process is causing trouble.

There's also an **API Query Explorer** tucked inside this panel (click the bar to expand it). It's basically a mini REST client with 20 pre-built queries organized by category. You pick a query, tweak the parameters if needed, hit execute, and get formatted results. Handy when you need to dig into something specific without leaving the dashboard.

### Incident Management

Sidebar → 🔴 Incidents

Lists every active incident in the engine. You can filter by type (failed job vs. failed external task), process definition, or specific instance ID.

For individual incidents: retry the failed job, open the modify dialog to move the process token to a different step, or click the ID to see the full error stacktrace and all related IDs.

For bulk operations: select incidents with checkboxes (or use Select All), set a batch size, then retry or modify them all at once. A progress overlay tracks how it's going.

### Process Instances

Sidebar → ⚙️ Process Instances

Lists running instances with filters for definition key, business key, and state (active / suspended / with incidents). Click into any instance to see its activity tree, variables, and modification options. You can suspend, activate, modify (move the token), or delete instances from here.

### Jobs

Sidebar → 🔄 Jobs

Shows all jobs — the async work units the engine processes. Filter by status (all, failed, with exception) or by process instance. Retry failed jobs or click into details to see the full stacktrace, set retries manually, or force immediate execution.

### DMN Evaluate

Sidebar → 📋 DMN Evaluate

Pick a decision table from the searchable dropdown, and the panel auto-generates input fields based on the DMN XML — correct types, labels, and sample values included. Nested objects get their own grouped cards. Edit the values (or the raw JSON), hit evaluate, and see which rules matched.

This one saves a lot of time compared to crafting JSON payloads by hand.

### Process Definitions

Sidebar → 📄 Process Definitions

Lists deployed process definitions (latest versions). You can view the BPMN XML or start a new instance directly, optionally passing in variables as JSON.

### Deployments

Sidebar → 📦 Deployments

Shows all deployments sorted newest-first, with the option to inspect the resources (BPMN files, DMN files, forms) included in each one.

### User Tasks

Sidebar → ✅ User Tasks

Lists tasks waiting for human action. Filter by assignee or unassigned. Complete tasks to move the process forward.

### History

Sidebar → 📜 History

Historical process instances — completed, still running, or terminated. Search by instance ID or filter by state. Shows start time, end time, duration, and current state.

### Maintenance & Cleanup

Sidebar → 🧹 Maintenance

Three housekeeping tools:

- **Duplicate scanner** — finds incidents that are effectively the same error repeated. Groups them, lets you remove duplicates while keeping the newest.
- **Batch resolve** — filter incidents by type and/or process key, preview the matches, then resolve them all with either a retry or delete strategy.
- **Stale incident finder** — surfaces incidents older than N days so you can deal with long-forgotten failures.

### AI Agent Tools (MCP)

Runs as a separate process via `npm run dev:run`. Exposes 60+ tools across 10 categories:

| Category | Count | What you can do |
|---|---|---|
| Incidents | 6 | list, get, count, resolve, annotate |
| Process Instances | 11 | list, get, modify, suspend/activate, delete, manage variables |
| Process Definitions | 9 | list, get, start instances, get XML, get statistics |
| Decision Definitions | 8 | list, get, evaluate (by key/id/tenant), get XML |
| Jobs | 7 | list, get, retry, execute, set due date, get stacktrace |
| Tasks | 9 | list, get, complete, claim/unclaim, assign, delegate, variables |
| History | 6 | list instances/activities/variables/incidents, delete |
| Deployments | 4 | list, get, get resources, delete |
| External Tasks | 4 | list, get, set retries, get error details |
| Executions | 4 | list, get, signal, deliver message |

You can tell your AI something like *"find all failed incidents in the order-process and retry them"* and it'll chain the right tool calls together.

---

## Where things live in the code

| Feature | Frontend | Backend |
|---|---|---|
| Environments | `panels/environments.js` | `routes/environment.routes.ts` → `services/environment.service.ts` |
| Health | `panels/health.js` | proxied to Camunda `/process-definition/statistics` |
| Incidents | `panels/incidents.js` | `tools/incidents.ts`, `routes/actions.routes.ts` |
| Instances | `panels/instances.js` | `tools/process-instances.ts` |
| Jobs | `panels/jobs.js` | `tools/jobs.ts` |
| DMN | `panels/dmn.js` | `tools/decision-definitions.ts`, `parsers/dmn-parser.ts` |
| Definitions | `panels/definitions.js` | `tools/process-definitions.ts`, `parsers/bpmn-parser.ts` |
| Deployments | `panels/deployments.js` | `tools/deployments.ts` |
| Tasks | `panels/tasks.js` | `tools/tasks.ts` |
| History | `panels/history.js` | `tools/history.ts` |
| Maintenance | `panels/maintenance.js` | `services/incident.service.ts`, `routes/actions.routes.ts` |
| Query Explorer | `components/query-explorer.js` | proxied to Camunda REST API |
| Modify Dialog | `components/modify-dialog.js` | `parsers/bpmn-parser.ts` |
| MCP Tools | — | `tools/*.ts` (10 modules, 60+ tools) |
