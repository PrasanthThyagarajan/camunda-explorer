# Camunda MCP Server & Dashboard

A management tool for **Camunda Platform 7** that gives you two ways to operate your workflow engine:

1. **A Dashboard** (web browser) — for humans to visually monitor and manage processes
2. **An MCP Server** (AI integration) — for AI assistants like Cursor or Claude to operate Camunda through natural language

---

## Table of Contents

- [What is Camunda?](#what-is-camunda)
- [What Problem Does This Application Solve?](#what-problem-does-this-application-solve)
- [Quick Start](#quick-start)
- [Feature Guide](#feature-guide)
  - [1. Environment Management](#1-environment-management)
  - [2. Engine Health](#2-engine-health)
  - [3. Incident Management](#3-incident-management)
  - [4. Process Instances](#4-process-instances)
  - [5. Jobs](#5-jobs)
  - [6. DMN Evaluate](#6-dmn-evaluate)
  - [7. Process Definitions](#7-process-definitions)
  - [8. Deployments](#8-deployments)
  - [9. User Tasks](#9-user-tasks)
  - [10. History](#10-history)
  - [11. Maintenance & Cleanup](#11-maintenance--cleanup)
  - [12. API Query Explorer](#12-api-query-explorer)
  - [13. AI Agent Tools (MCP)](#13-ai-agent-tools-mcp)
- [Feature Roadmap](#feature-roadmap)

---

## What is Camunda?

Camunda is a **workflow automation engine**. Companies use it to run business processes like:

- Processing a loan application (step 1 → step 2 → step 3 → approval)
- Handling an insurance claim
- Onboarding a new employee

Each process is defined as a **BPMN diagram** (a flowchart). Camunda executes these diagrams. When something goes wrong in a step, an **incident** is created. When a step needs a human, a **user task** is created.

Camunda also supports **DMN** (Decision Model and Notation) — spreadsheet-like rules (e.g., "if customer age > 25 AND income > 50k, then approve").

---

## What Problem Does This Application Solve?

Camunda has a REST API but no convenient single tool for:

- Managing **multiple environments** (Dev, Staging, Production) from one place
- **Bulk-resolving** hundreds of stuck incidents in seconds
- **Testing DMN decisions** with auto-generated input forms
- Letting **AI assistants** query and fix your engine through natural language

This application fills that gap.

---

## Quick Start

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or higher |
| A running Camunda 7 engine | v7.16+ with REST API enabled |

### Installation

```bash
cd camunda-mcp-server
npm install
```

### Start the Dashboard (for humans)

```bash
npm run dashboard
```

Open **http://localhost:3333** in your browser. You'll see the dashboard.

### Start the MCP Server (for AI assistants)

```bash
npm run dev:run
```

This starts a server that communicates over STDIO. Configure your AI tool (Cursor, Claude Desktop) to connect to it.

### Configuration (optional)

Create a `.env` file in the project root:

```env
CAMUNDA_BASE_URL=http://localhost:8080/engine-rest
CAMUNDA_USERNAME=demo
CAMUNDA_PASSWORD=demo
DASHBOARD_PORT=3333
```

You can also configure environments directly through the Dashboard UI (recommended).

---

## Feature Guide

Below is every feature, where to find it, and step-by-step instructions.

---

### 1. Environment Management

> **Where:** Sidebar → 🌐 Environments

**What it does:** Lets you connect to multiple Camunda servers and switch between them instantly. All panels use whichever environment is currently "active".

**How to use:**

1. Click **🌐 Environments** in the sidebar
2. Fill in the form at the bottom:
   - **Name** — a label like "Production" or "Dev"
   - **URL** — the Camunda REST API address (e.g. `http://camunda:8080/engine-rest`)
   - **Username / Password** — leave empty if your server has no authentication
   - **Color** — pick a color to quickly identify this environment
3. Click **🔌 Test Connection** to verify it works
4. Click **Add Environment** to save
5. To switch: click **⚡ Activate** on any environment card
6. The active environment's color appears in the sidebar and top bar so you always know where you are

**Actions available per environment:**

| Button | What it does |
|---|---|
| ⚡ Activate | Switch all panels to use this environment |
| 🔌 Test | Check if the Camunda server is reachable |
| ✏️ Edit | Change name, URL, credentials, or color |
| 🗑️ Delete | Remove this environment (with confirmation) |

---

### 2. Engine Health

> **Where:** Sidebar → 📊 Engine Health (loads by default on startup)

**What it does:** Gives you a quick overview of your Camunda engine's current state.

**What you see:**

| Card | Meaning |
|---|---|
| **Running Instances** | How many process instances are currently executing |
| **Failed Jobs** | Steps that failed and need attention (shown red if > 0) |
| **Open Incidents** | Total active incidents across all processes |
| **Process Definitions** | How many different process types are deployed |

Below the cards is a **table** showing each process definition with its instance count, failed jobs, and incidents. This helps you quickly spot which process is causing the most problems.

**How to use:** Just open the panel — data loads automatically. Click **↻ Refresh** in the top bar to reload.

---

### 3. Incident Management

> **Where:** Sidebar → 🔴 Incidents

**What it does:** Shows every active incident (error) in your Camunda engine. You can filter, inspect, retry, modify, or batch-process incidents.

**Filters (top of panel):**

| Filter | Purpose |
|---|---|
| Incident Type | Show only "Failed Job" or "Failed External Task" |
| Process Definition | Show only incidents for a specific process |
| Process Instance ID | Find incidents for one specific instance |

**Single Incident Actions:**

| Action | What it does |
|---|---|
| **↻ Retry** | Sets the failed job's retries back to 1 — the engine will re-attempt the step |
| **🔄 Modify** | Opens a dialog to move the process to a different step (e.g., restart from beginning) |
| Click the **ID** link | Opens a detail panel showing the full error stacktrace, all IDs, and timestamps |

**Batch Actions (for handling many incidents at once):**

1. **Select incidents** using the checkboxes on the left
2. Use **Select All** / **Deselect** buttons for bulk selection
3. Set the **Batch size** (how many to process at once, default 10)
4. Click **↻ Retry Selected** to retry all selected incidents
5. Click **🔄 Modify** to move all selected instances to a target activity
6. A progress overlay shows real-time progress during batch operations

---

### 4. Process Instances

> **Where:** Sidebar → ⚙️ Process Instances

**What it does:** Lists running process instances with filtering, detail view, and lifecycle actions.

**Filters:**

| Filter | Purpose |
|---|---|
| Def Key | Show instances of a specific process definition |
| Business Key | Search by business key (partial match) |
| State | Filter by Active, Suspended, or With Incidents |

**Actions per instance:**

| Action | What it does |
|---|---|
| **Details** | Opens the activity tree, variables, and modification form |
| **⏸ Suspend** | Pauses the instance — no further steps will execute |
| **▶ Activate** | Resumes a suspended instance |

**Inside the Detail Panel:**

- View the **Activity Instance Tree** (shows exactly which step the process is at)
- View all **process variables** (the data the process is carrying)
- **Modify Instance** — enter a "Cancel Activity" and/or "Start Before Activity" to move the token
- **Delete Instance** — permanently removes the instance (destructive, with confirmation)

---

### 5. Jobs

> **Where:** Sidebar → 🔄 Jobs

**What it does:** Shows scheduled and failed jobs. A "job" is a unit of work the engine needs to execute.

**Filters:**

| Filter | Purpose |
|---|---|
| Filter dropdown | All Jobs, Failed (0 retries), or With Exception |
| Process Instance | Show jobs for one specific instance |

**Actions per job:**

| Action | What it does |
|---|---|
| **↻ Retry** | Sets retries to 1 — the engine will try again |
| Click the **Job ID** | Opens detail panel with full error stacktrace, due date, priority, etc. |

**Inside the Detail Panel:**

- **Set Retries** — manually set any retry count
- **▶ Execute Now** — forces the job to run immediately (ignores due date)

---

### 6. DMN Evaluate

> **Where:** Sidebar → 📋 DMN Evaluate

**What it does:** Lets you test DMN decision tables by providing input values and seeing which rules match. This is incredibly useful for debugging business rules.

**Step-by-step:**

1. Click the **Decision Key** input and start typing — a searchable dropdown appears
2. Select a decision — the panel loads:
   - Decision metadata (key, name, version, deployment)
   - **Input fields** — auto-generated from the DMN XML, with correct types and sample values
   - **Output columns** — shows what the decision will return
   - **JSON payload** — the actual request body (auto-generated, but editable)
3. Modify input values as needed (either via the form fields or the JSON textarea)
4. Click **▶ Evaluate Decision** — the result shows which rules matched
5. Click **View DMN XML** to see the raw XML source

**Special features:**

- **Nested objects** are detected and rendered as grouped input cards
- **Type awareness** — Boolean fields show `true / false`, Date fields show date format hints
- **🔄 Regenerate** button rebuilds the JSON payload from the form fields

---

### 7. Process Definitions

> **Where:** Sidebar → 📄 Process Definitions

**What it does:** Lists all deployed process definitions (latest versions).

**Actions per definition:**

| Action | What it does |
|---|---|
| **XML** | View the BPMN XML source in a detail panel |
| **▶ Start** | Start a new process instance (optionally with variables as JSON) |

---

### 8. Deployments

> **Where:** Sidebar → 📦 Deployments

**What it does:** Lists all deployments sorted by date (newest first).

**Actions per deployment:**

| Action | What it does |
|---|---|
| **Resources** | Shows the files included in this deployment (BPMN, DMN, forms, etc.) |

---

### 9. User Tasks

> **Where:** Sidebar → ✅ User Tasks

**What it does:** Lists human tasks that are waiting for someone to complete them.

**Filters:**

| Filter | Purpose |
|---|---|
| Assignee | Show tasks assigned to a specific person |
| State | All or Unassigned only |

**Actions per task:**

| Action | What it does |
|---|---|
| **✓ Complete** | Marks the task as done — the process continues to the next step |
| Click the **Instance** link | Navigate to the parent process instance |

---

### 10. History

> **Where:** Sidebar → 📜 History

**What it does:** Shows historical process instances — completed, running, and terminated.

**Filters:**

| Filter | Purpose |
|---|---|
| Process Instance ID | Find a specific historical instance |
| State | Finished, Running, or All |

**Columns shown:** Instance ID, Definition Key, State (color-coded), Started, Ended, Duration.

---

### 11. Maintenance & Cleanup

> **Where:** Sidebar → 🧹 Maintenance

**What it does:** Housekeeping tools for cleaning up incidents in bulk. Contains three tools:

#### Tool A: Find & Remove Duplicates

When the same error happens repeatedly, you get duplicate incidents. This tool:

1. Click **🔍 Scan for Duplicates** — groups incidents by (process + activity + type)
2. Shows how many duplicates exist in each group
3. **Remove** button per group, or **🗑️ Remove All Duplicates** for everything
4. Keeps the newest incident in each group, resolves the rest

#### Tool B: Batch Resolve Incidents

Resolve many incidents at once with filters:

1. Choose **Incident Type** and/or **Process Definition Key**
2. Click **Preview** — shows how many incidents match
3. Choose a **Strategy**:
   - **Retry** — sets retries=1, engine re-attempts (safe)
   - **Delete** — removes the process instance entirely (destructive!)
4. Click **Execute**

#### Tool C: Stale Incident Report

Find incidents that have been stuck for a long time:

1. Set **Older than (days)** — default is 30
2. Click **🔍 Find Stale Incidents** — shows a table of old incidents with their age
3. Click **🗑️ Resolve All Stale** to retry them in batch

---

### 12. API Query Explorer

> **Where:** Inside the 📊 Engine Health panel → click the **🔍 API Query Explorer** bar to expand

**What it does:** A built-in REST API client with 20 pre-built queries for common scenarios. Think of it as "Postman inside the dashboard".

**How to use:**

1. Expand the explorer by clicking the header bar
2. Select a query from the dropdown (organized by category):
   - 🔴 Incident Analysis (5 queries)
   - 📊 Process Instances (5 queries)
   - ⚙️ Jobs & External Tasks (3 queries)
   - 📜 History & Audit (5 queries)
   - 📦 Definitions & Deployments (2 queries)
   - 🛠 Custom (write your own)
3. The endpoint and request body are auto-filled
4. Modify the JSON body or max results as needed
5. Click **▶ Execute Query** — results appear as a formatted table
6. Use **📋 Copy Results** to copy the JSON to your clipboard

---

### 13. AI Agent Tools (MCP)

> **Where:** Runs as a separate process (`npm run dev:run`), used by AI tools like Cursor

**What it does:** Exposes **60+ tools** that an AI assistant can call through natural language. For example, you can tell Cursor:

> *"Show me all failed incidents in the order-process and retry them"*

The AI will use the MCP tools to list incidents, filter them, and retry the failed jobs.

**Tool categories (60+ tools total):**

| Category | Tools | Examples |
|---|---|---|
| **Incidents** (6) | List, get, count, resolve, annotate, clear annotation | `camunda_list_incidents`, `camunda_resolve_incident` |
| **Process Instances** (11) | List, get, modify, suspend, activate, delete, get/set variables | `camunda_modify_process_instance`, `camunda_get_instance_variables` |
| **Process Definitions** (9) | List, get, start instance, get XML, get statistics | `camunda_start_process_instance`, `camunda_get_process_xml` |
| **Decision Definitions** (8) | List, get, evaluate by key/id/tenant, get XML | `camunda_evaluate_decision_by_key` |
| **Jobs** (7) | List, get, retry, set retries, execute, set due date, get stacktrace | `camunda_execute_job`, `camunda_set_job_retries` |
| **Tasks** (9) | List, get, complete, claim, unclaim, assign, delegate, get/set variables | `camunda_complete_task`, `camunda_claim_task` |
| **History** (6) | List instances/activities/variables/incidents, get details, delete | `camunda_list_historic_process_instances` |
| **Deployments** (4) | List, get, get resources, delete | `camunda_delete_deployment` |
| **External Tasks** (4) | List, get, set retries, get error details | `camunda_list_external_tasks` |
| **Executions** (4) | List, get, signal, deliver message | `camunda_deliver_message` |

---

## Feature Roadmap

A quick-reference map of where every feature lives in the codebase:

| Feature | Dashboard Panel | Frontend Code | Backend Code |
|---|---|---|---|
| Environment Management | 🌐 Environments | `public/js/panels/environments.js` | `src/routes/environment.routes.ts` · `src/services/environment.service.ts` |
| Engine Health | 📊 Engine Health | `public/js/panels/health.js` | Proxied → Camunda `/process-definition/statistics` |
| Incidents | 🔴 Incidents | `public/js/panels/incidents.js` | `src/tools/incidents.ts` · `src/routes/actions.routes.ts` |
| Process Instances | ⚙️ Process Instances | `public/js/panels/instances.js` | `src/tools/process-instances.ts` |
| Jobs | 🔄 Jobs | `public/js/panels/jobs.js` | `src/tools/jobs.ts` |
| DMN Evaluate | 📋 DMN Evaluate | `public/js/panels/dmn.js` | `src/tools/decision-definitions.ts` · `src/parsers/dmn-parser.ts` |
| Process Definitions | 📄 Process Definitions | `public/js/panels/definitions.js` | `src/tools/process-definitions.ts` · `src/parsers/bpmn-parser.ts` |
| Deployments | 📦 Deployments | `public/js/panels/deployments.js` | `src/tools/deployments.ts` |
| User Tasks | ✅ User Tasks | `public/js/panels/tasks.js` | `src/tools/tasks.ts` |
| History | 📜 History | `public/js/panels/history.js` | `src/tools/history.ts` |
| Maintenance | 🧹 Maintenance | `public/js/panels/maintenance.js` | `src/services/incident.service.ts` · `src/routes/actions.routes.ts` |
| Query Explorer | Inside Health panel | `public/js/components/query-explorer.js` | Proxied → Camunda REST API |
| Batch Operations | Incidents + Maintenance | `public/js/components/progress.js` | `src/routes/actions.routes.ts` |
| Modify Dialog | Incidents panel | `public/js/components/modify-dialog.js` | `src/parsers/bpmn-parser.ts` |
| MCP AI Tools | — (STDIO only) | — | `src/tools/*.ts` (10 files, 60+ tools) |
