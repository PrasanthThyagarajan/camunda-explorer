/**
 * Stacktrace Analyzer
 *
 * Parses raw stacktrace text into structured diagnostic information.
 * Supports .NET, Java, Python, and Node.js stacktrace formats.
 *
 * What it extracts:
 *   - Individual stack frames (method, file, line)
 *   - The root cause frame (deepest application code, not framework/runtime)
 *   - Failure layer classification (DataAccess, Service, Worker, HTTP, etc.)
 *   - Component identification (repository, service, controller, etc.)
 *   - Actionable fix hints based on detected patterns
 *   - Human-readable diagnosis summary
 *
 * This feeds into:
 *   - Diagnosis orchestrator (per-instance analysis)
 *   - Failure clusterer (per-cluster analysis)
 *   - Recovery ranker (adjusts retry confidence based on error nature)
 */

import { logger } from "../../utils/logger.js";
import type { IStacktraceAnalysis, IStackFrame, FailureLayer } from "../../interfaces/intelligence.js";

// ── Public API ──────────────────────────────────────────────────

/**
 * Analyze a raw stacktrace string and produce structured diagnostic info.
 *
 * @param rawTrace - The full stacktrace text (may include error message at top)
 * @param errorMessage - The error message from the incident (used for context)
 */
export function analyzeStacktrace(
  rawTrace: string,
  errorMessage?: string
): IStacktraceAnalysis {
  if (!rawTrace || rawTrace.trim().length === 0) {
    return emptyAnalysis();
  }

  try {
    const frames = parseFrames(rawTrace);
    if (frames.length === 0) {
      return emptyAnalysis();
    }

    const rootCause = findRootCauseFrame(frames);
    const layer = classifyLayer(frames, rootCause);
    const component = identifyComponent(rootCause, frames);
    const isTransient = detectTransientNature(frames, errorMessage || "");
    const fixHints = generateFixHints(layer, component, frames, errorMessage || "", isTransient);
    const summary = buildSummary(rootCause, layer, component, errorMessage || "", isTransient);
    const callChain = buildCallChain(frames);

    return {
      frames,
      rootCauseFrame: rootCause,
      failureLayer: layer,
      failureComponent: component,
      isTransient,
      fixHints,
      callChain,
      summary,
    };
  } catch (err) {
    logger.warn(`[STACKTRACE-ANALYZER] Failed to parse trace: ${err}`);
    return emptyAnalysis();
  }
}

/**
 * Produce a lightweight analysis when no actual stacktrace is available —
 * just the error message. This uses pattern matching on the error text to
 * classify the failure layer, transient nature, and generate fix hints.
 */
export function analyzeErrorMessageOnly(
  errorMessage: string
): IStacktraceAnalysis | null {
  if (!errorMessage || errorMessage.trim().length === 0) return null;

  const isTransient = detectTransientFromMessage(errorMessage);
  const layer = classifyLayerFromMessage(errorMessage);
  const fixHints = generateMessageHints(layer, errorMessage, isTransient);
  const summary = buildMessageSummary(layer, errorMessage, isTransient);

  // Only return if we could classify something meaningful
  if (layer === "unknown" && fixHints.length === 0) return null;

  return {
    frames: [],
    rootCauseFrame: null,
    failureLayer: layer,
    failureComponent: "External Task",
    isTransient,
    fixHints,
    callChain: [],
    summary,
  };
}

/**
 * Quick check: does the stacktrace suggest this is a transient/retriable error?
 * Used by recovery-ranker to adjust retry confidence.
 */
export function isLikelyTransient(analysis: IStacktraceAnalysis): boolean {
  return analysis.isTransient;
}

/**
 * Get a retry confidence modifier based on stacktrace analysis.
 * Returns a multiplier (0.0 - 1.0) that should be applied to retry confidence.
 *   - 1.0 = analysis doesn't change anything
 *   - 0.3 = analysis strongly suggests retry won't help
 */
export function getRetryModifier(analysis: IStacktraceAnalysis): number {
  if (!analysis.rootCauseFrame) return 1.0;

  // Transient errors are good candidates for retry
  if (analysis.isTransient) return 1.0;

  // Data access / not found errors — retry won't fix missing data
  if (analysis.failureLayer === "data_access") return 0.3;

  // Validation / business logic errors — retry won't change the logic
  if (analysis.failureLayer === "business_logic") return 0.2;

  // Configuration errors — need manual fix
  if (analysis.failureLayer === "configuration") return 0.1;

  // External service errors might be transient
  if (analysis.failureLayer === "external_service") return 0.7;

  // Worker / infrastructure — could be deployment issue
  if (analysis.failureLayer === "infrastructure") return 0.5;

  return 0.8;
}

// ── Frame Parsing ───────────────────────────────────────────────

/**
 * Parse stack frames from raw text. Supports:
 *   - .NET:  "at Namespace.Class.Method(params) in /path/to/file.cs:line 42"
 *   - Java:  "at com.package.Class.method(File.java:42)"
 *   - Python: "File "/path/to/file.py", line 42, in method"
 *   - Node.js: "at Object.method (/path/to/file.js:42:10)"
 */
function parseFrames(rawTrace: string): IStackFrame[] {
  const frames: IStackFrame[] = [];
  const lines = rawTrace.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try .NET format: "at Namespace.Class.Method(params) in /path:line N"
    const dotnetMatch = trimmed.match(
      /^\s*at\s+(.+?)(?:\((.*?)\))?\s*(?:in\s+(.+?))?(?::line\s+(\d+))?\s*$/i
    );
    if (dotnetMatch) {
      const fullMethod = dotnetMatch[1].trim();
      const params = dotnetMatch[2] || "";
      const file = dotnetMatch[3] || "";
      const lineNum = dotnetMatch[4] ? parseInt(dotnetMatch[4], 10) : null;

      const parts = fullMethod.split(".");
      const method = parts.pop() || fullMethod;
      const className = parts.pop() || "";
      const namespace = parts.join(".");

      frames.push({
        method,
        className,
        namespace,
        fullMethod: fullMethod,
        file,
        line: lineNum,
        params,
        isFramework: isFrameworkFrame(namespace, className, fullMethod),
      });
      continue;
    }

    // Try Java format: "at com.package.Class.method(File.java:42)"
    const javaMatch = trimmed.match(
      /^\s*at\s+([\w$.]+)\(([\w.]+)?(?::(\d+))?\)\s*$/
    );
    if (javaMatch) {
      const fullMethod = javaMatch[1];
      const file = javaMatch[2] || "";
      const lineNum = javaMatch[3] ? parseInt(javaMatch[3], 10) : null;

      const parts = fullMethod.split(".");
      const method = parts.pop() || fullMethod;
      const className = parts.pop() || "";
      const namespace = parts.join(".");

      frames.push({
        method,
        className,
        namespace,
        fullMethod,
        file,
        line: lineNum,
        params: "",
        isFramework: isFrameworkFrame(namespace, className, fullMethod),
      });
      continue;
    }

    // Try Node.js format: "at Object.method (/path/to/file.js:42:10)"
    const nodeMatch = trimmed.match(
      /^\s*at\s+(?:(.+?)\s+)?\(?((?:\/|[A-Z]:\\).+?):(\d+)(?::(\d+))?\)?\s*$/
    );
    if (nodeMatch) {
      const methodPart = nodeMatch[1] || "anonymous";
      const file = nodeMatch[2] || "";
      const lineNum = parseInt(nodeMatch[3], 10);

      const parts = methodPart.split(".");
      const method = parts.pop() || methodPart;
      const className = parts.pop() || "";

      frames.push({
        method,
        className,
        namespace: "",
        fullMethod: methodPart,
        file,
        line: lineNum,
        params: "",
        isFramework: false,
      });
      continue;
    }

    // Try Python format: File "/path/file.py", line 42, in method
    const pyMatch = trimmed.match(
      /^File\s+"(.+?)",\s+line\s+(\d+),\s+in\s+(\w+)/
    );
    if (pyMatch) {
      frames.push({
        method: pyMatch[3],
        className: "",
        namespace: "",
        fullMethod: pyMatch[3],
        file: pyMatch[1],
        line: parseInt(pyMatch[2], 10),
        params: "",
        isFramework: false,
      });
    }
  }

  return frames;
}

// ── Root Cause Detection ────────────────────────────────────────

/**
 * Find the "root cause frame" — the deepest application-level frame
 * (not framework/runtime code). This is typically where the actual
 * error originated.
 */
function findRootCauseFrame(frames: IStackFrame[]): IStackFrame | null {
  // The root cause is typically the FIRST frame in the trace
  // (deepest in the call stack, first line printed).
  // We prefer the first non-framework frame.
  const appFrames = frames.filter((f) => !f.isFramework);
  if (appFrames.length > 0) return appFrames[0];

  // Fallback to first frame overall
  return frames[0] || null;
}

// ── Layer Classification ────────────────────────────────────────

const LAYER_PATTERNS: Array<{ layer: FailureLayer; patterns: RegExp[] }> = [
  {
    layer: "data_access",
    patterns: [
      /repository/i, /dataaccess/i, /\.dal\./i, /\.data\./i,
      /sqlserver/i, /mysql/i, /postgres/i, /mongodb/i,
      /entityframework/i, /hibernate/i, /sequelize/i,
      /dbcontext/i, /dbcommand/i, /sqlexception/i,
    ],
  },
  {
    layer: "external_service",
    patterns: [
      /httpclient/i, /webclient/i, /restclient/i, /\.http\./i,
      /fetch/i, /axios/i, /urllib/i, /requests\./i,
      /grpc/i, /soap/i, /graphql/i,
      /apigateway/i, /proxy/i,
    ],
  },
  {
    layer: "business_logic",
    patterns: [
      /\.service\./i, /\.services\./i, /businessrule/i,
      /\.domain\./i, /\.logic\./i, /\.rules\./i,
      /validator/i, /\.validation\./i,
      /computeservice/i, /processingservice/i,
    ],
  },
  {
    layer: "worker",
    patterns: [
      /worker/i, /externaltask/i, /pollingagent/i,
      /jobexecutor/i, /taskhandler/i,
      /\.jobs\./i, /\.tasks\./i, /\.workers\./i,
    ],
  },
  {
    layer: "infrastructure",
    patterns: [
      /middleware/i, /\.config\./i, /startup/i,
      /dependencyinjection/i, /\.ioc\./i,
      /serialization/i, /deserialization/i,
      /messaging/i, /queue/i, /kafka/i, /rabbitmq/i,
    ],
  },
  {
    layer: "configuration",
    patterns: [
      /configuration/i, /appsettings/i, /environment/i,
      /connection.?string/i, /\.settings\./i,
    ],
  },
];

/**
 * Classify which software layer the failure originates from.
 * Uses the root cause frame and scans all frames for pattern matches.
 */
function classifyLayer(frames: IStackFrame[], rootCause: IStackFrame | null): FailureLayer {
  // Score each layer based on how many frames match its patterns
  const scores = new Map<FailureLayer, number>();

  for (const { layer, patterns } of LAYER_PATTERNS) {
    let score = 0;
    for (const frame of frames) {
      const searchText = `${frame.namespace}.${frame.className}.${frame.method} ${frame.file}`;
      for (const pat of patterns) {
        if (pat.test(searchText)) {
          // Root cause frame matches count double
          score += frame === rootCause ? 3 : 1;
        }
      }
    }
    if (score > 0) scores.set(layer, score);
  }

  if (scores.size === 0) return "unknown";

  // Return the highest-scoring layer
  let best: FailureLayer = "unknown";
  let bestScore = 0;
  for (const [layer, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = layer;
    }
  }

  return best;
}

// ── Component Identification ────────────────────────────────────

/**
 * Identify the specific component that failed
 * (e.g., "SubResourcesRepository", "PaymentService").
 */
function identifyComponent(
  rootCause: IStackFrame | null,
  frames: IStackFrame[]
): string {
  if (!rootCause) return "Unknown";

  // Use the class name from root cause
  if (rootCause.className) return rootCause.className;

  // Fallback: first non-framework class
  for (const f of frames) {
    if (!f.isFramework && f.className) return f.className;
  }

  return "Unknown";
}

// ── Transient Error Detection ───────────────────────────────────

const TRANSIENT_PATTERNS = [
  /timeout/i, /timed?\s*out/i,
  /connection\s*(refused|reset|closed|aborted)/i,
  /network\s*(error|unreachable|failure)/i,
  /socket\s*(exception|error|closed|hang)/i,
  /too\s*many\s*requests/i, /rate\s*limit/i, /throttl/i,
  /service\s*unavailable/i, /503/i, /502/i, /504/i,
  /deadlock/i, /lock\s*timeout/i,
  /temporary/i, /transient/i, /intermittent/i,
  /retry/i, /retryable/i,
  /econnrefused/i, /econnreset/i, /etimedout/i, /epipe/i,
];

const NON_TRANSIENT_PATTERNS = [
  /not\s*found/i, /404/i, /does\s*not\s*exist/i,
  /cannot\s*find/i, /missing/i,
  /invalid/i, /malformed/i, /illegal/i,
  /unauthorized/i, /forbidden/i, /401/i, /403/i,
  /null\s*reference/i, /nullpointer/i, /undefined\s*is\s*not/i,
  /argument\s*(null|out\s*of\s*range)/i,
  /cast\s*exception/i, /type\s*mismatch/i,
  /constraint\s*violation/i, /duplicate\s*key/i,
  /permission\s*denied/i, /access\s*denied/i,
];

function detectTransientNature(frames: IStackFrame[], errorMessage: string): boolean {
  const fullText = `${errorMessage} ${frames.map((f) => f.fullMethod).join(" ")}`;

  // Check for strong non-transient indicators first
  for (const pat of NON_TRANSIENT_PATTERNS) {
    if (pat.test(fullText)) return false;
  }

  // Check for transient indicators
  for (const pat of TRANSIENT_PATTERNS) {
    if (pat.test(fullText)) return true;
  }

  // Default: assume not transient if we can't determine
  return false;
}

// ── Fix Hint Generation ─────────────────────────────────────────

interface FixHint {
  category: string;
  description: string;
  confidence: "high" | "medium" | "low";
}

function generateFixHints(
  layer: FailureLayer,
  component: string,
  frames: IStackFrame[],
  errorMessage: string,
  isTransient: boolean
): string[] {
  const hints: FixHint[] = [];

  // Transient-specific hints
  if (isTransient) {
    hints.push({
      category: "Retry",
      description: "This appears to be a transient error. A retry is likely to succeed.",
      confidence: "high",
    });
    hints.push({
      category: "Infrastructure",
      description: "Check service health and network connectivity if retries continue to fail.",
      confidence: "medium",
    });
  }

  // Layer-specific hints
  switch (layer) {
    case "data_access":
      hints.push({
        category: "Data",
        description: `The failure originates in the data access layer (${component}). Verify that the required data exists in the database.`,
        confidence: "high",
      });
      if (/not\s*found|cannot\s*find/i.test(errorMessage)) {
        hints.push({
          category: "Data",
          description: "The queried record does not exist. Check if the entity IDs passed to this process are valid and have been created beforehand.",
          confidence: "high",
        });
      }
      if (/null\s*reference|nullpointer/i.test(errorMessage)) {
        hints.push({
          category: "Bug",
          description: "A null reference occurred in the data access layer. This likely means a query returned null where an object was expected.",
          confidence: "high",
        });
      }
      hints.push({
        category: "Recovery",
        description: "Retry is unlikely to help for data-related errors. Fix the underlying data issue, then use Modify to restart from the failed step.",
        confidence: "high",
      });
      break;

    case "external_service":
      hints.push({
        category: "External",
        description: `An external service call failed in ${component}. Check if the downstream service is healthy and responding.`,
        confidence: "high",
      });
      hints.push({
        category: "Recovery",
        description: "If the external service was temporarily down, a retry may succeed. Otherwise, investigate the API contract and request payload.",
        confidence: "medium",
      });
      break;

    case "business_logic":
      hints.push({
        category: "Logic",
        description: `The failure is in the business logic layer (${component}). This suggests a validation failure or an unhandled edge case.`,
        confidence: "high",
      });
      hints.push({
        category: "Recovery",
        description: "Retry will not fix a logic error. Review the input variables and fix the root cause in the code, then use Modify to re-execute.",
        confidence: "high",
      });
      break;

    case "worker":
      hints.push({
        category: "Worker",
        description: `The Camunda external task worker (${component}) failed during execution. This may be a worker deployment or configuration issue.`,
        confidence: "medium",
      });
      break;

    case "infrastructure":
      hints.push({
        category: "Infrastructure",
        description: `Infrastructure-level failure in ${component}. Check application configuration, dependency injection, and service wiring.`,
        confidence: "medium",
      });
      break;

    case "configuration":
      hints.push({
        category: "Configuration",
        description: `Configuration error detected in ${component}. Verify environment variables, connection strings, and application settings.`,
        confidence: "high",
      });
      hints.push({
        category: "Recovery",
        description: "Retry will not help. Fix the configuration and redeploy, then retry the failed step.",
        confidence: "high",
      });
      break;
  }

  // Method-specific hints from the root cause
  const rootCause = frames.find((f) => !f.isFramework);
  if (rootCause) {
    const method = rootCause.method.toLowerCase();
    if (method.includes("get") || method.includes("find") || method.includes("fetch")) {
      hints.push({
        category: "Query",
        description: `The failure occurred during a data retrieval operation (${rootCause.method}). Verify the query parameters and that the target entity exists.`,
        confidence: "medium",
      });
    }
    if (method.includes("save") || method.includes("create") || method.includes("insert") || method.includes("update")) {
      hints.push({
        category: "Persistence",
        description: `The failure occurred during a write operation (${rootCause.method}). Check for constraint violations, required fields, or duplicate entries.`,
        confidence: "medium",
      });
    }
    if (method.includes("compute") || method.includes("calculate") || method.includes("process")) {
      hints.push({
        category: "Computation",
        description: `The failure occurred during a computation (${rootCause.method}). Review the input data for invalid or unexpected values.`,
        confidence: "medium",
      });
    }
  }

  // Deduplicate and return description strings
  const seen = new Set<string>();
  const result: string[] = [];
  for (const h of hints) {
    if (!seen.has(h.description)) {
      seen.add(h.description);
      result.push(h.description);
    }
  }

  return result;
}

// ── Summary Builder ─────────────────────────────────────────────

function buildSummary(
  rootCause: IStackFrame | null,
  layer: FailureLayer,
  component: string,
  errorMessage: string,
  isTransient: boolean
): string {
  if (!rootCause) return "Unable to parse stacktrace for analysis.";

  const layerLabels: Record<FailureLayer, string> = {
    data_access: "Data Access",
    external_service: "External Service",
    business_logic: "Business Logic",
    worker: "Worker",
    infrastructure: "Infrastructure",
    configuration: "Configuration",
    unknown: "Unknown",
  };

  const layerLabel = layerLabels[layer];
  const transientNote = isTransient
    ? " This appears to be a transient error that may resolve on retry."
    : " This is likely a persistent error — retry alone will not fix it.";

  const method = rootCause.method || "unknown method";
  const file = rootCause.file
    ? ` (${rootCause.file.split(/[/\\]/).pop()}${rootCause.line ? `:${rootCause.line}` : ""})`
    : "";

  return (
    `Root cause in ${layerLabel} layer: ${component}.${method}${file}. ` +
    `Error: "${truncate(errorMessage, 100)}".` +
    transientNote
  );
}

// ── Call Chain Builder ──────────────────────────────────────────

/**
 * Build a concise call chain from the parsed frames.
 * Shows only application frames in execution order (reversed from stacktrace).
 */
function buildCallChain(frames: IStackFrame[]): string[] {
  const appFrames = frames.filter((f) => !f.isFramework);
  // Stacktraces are printed deepest-first; reverse for execution order
  return appFrames
    .slice(0, 8)
    .reverse()
    .map((f) => {
      const cls = f.className || "";
      const method = f.method || "?";
      const loc = f.line ? `:${f.line}` : "";
      return cls ? `${cls}.${method}${loc}` : `${method}${loc}`;
    });
}

// ── Framework Detection ─────────────────────────────────────────

const FRAMEWORK_NAMESPACES = [
  /^system\./i, /^microsoft\./i, /^mscorlib/i,
  /^java\./i, /^javax\./i, /^sun\./i, /^jdk\./i,
  /^org\.springframework/i, /^org\.apache/i,
  /^node:internal/i, /^internal\//i,
  /^express\./i, /^koa\./i,
  /^camunda\./i, /^org\.camunda/i,
];

function isFrameworkFrame(namespace: string, className: string, fullMethod: string): boolean {
  const searchText = `${namespace}.${className}`;
  for (const pattern of FRAMEWORK_NAMESPACES) {
    if (pattern.test(searchText) || pattern.test(fullMethod)) return true;
  }
  return false;
}

// ── Helpers ─────────────────────────────────────────────────────

function emptyAnalysis(): IStacktraceAnalysis {
  return {
    frames: [],
    rootCauseFrame: null,
    failureLayer: "unknown",
    failureComponent: "Unknown",
    isTransient: false,
    fixHints: [],
    callChain: [],
    summary: "",
  };
}

function truncate(str: string, len: number): string {
  if (!str) return "";
  return str.length > len ? str.substring(0, len - 1) + "…" : str;
}

// ── Message-Only Analysis Helpers ───────────────────────────────

function detectTransientFromMessage(msg: string): boolean {
  for (const pat of NON_TRANSIENT_PATTERNS) {
    if (pat.test(msg)) return false;
  }
  for (const pat of TRANSIENT_PATTERNS) {
    if (pat.test(msg)) return true;
  }
  return false;
}

function classifyLayerFromMessage(msg: string): FailureLayer {
  if (/not\s+found|cannot\s+(?:be\s+)?found|cannot\s+find|does\s*not\s*exist|404|no\s*such\s*entity|resource.+not.+found/i.test(msg)) return "external_service";
  if (/unauthorized|forbidden|401|403|access\s*denied|permission/i.test(msg)) return "configuration";
  if (/timeout|timed?\s*out|connection\s*(refused|reset)/i.test(msg)) return "infrastructure";
  if (/null\s*reference|nullpointer|undefined\s*is\s*not|key.+not\s+present|keynotfound|index\s*out\s*of\s*range/i.test(msg)) return "business_logic";
  if (/database|sql|constraint|duplicate\s*key/i.test(msg)) return "data_access";
  if (/invalid|malformed|illegal|bad\s*request|400/i.test(msg)) return "business_logic";
  if (/service\s*unavailable|503|502|504/i.test(msg)) return "external_service";
  return "unknown";
}

function generateMessageHints(layer: FailureLayer, msg: string, isTransient: boolean): string[] {
  const hints: string[] = [];

  if (isTransient) {
    hints.push("This appears to be a transient error — a retry may succeed.");
    hints.push("If retries keep failing, check downstream service health.");
  }

  switch (layer) {
    case "external_service":
      if (/not\s+found|cannot\s+(?:be\s+)?found|cannot\s+find|404|resource.+not.+found/i.test(msg)) {
        hints.push("The requested resource was not found. Verify the resource URL or ID is correct.");
        hints.push("Check if the downstream API endpoint has changed or if the resource has been deleted.");
        hints.push("Retry is unlikely to help — fix the resource reference, then restart or modify the process.");
      } else {
        hints.push("An external service call failed. Check if the downstream service is healthy.");
      }
      break;
    case "configuration":
      hints.push("Authentication or authorization failure. Check service credentials and permissions.");
      hints.push("Verify API keys, tokens, or certificates have not expired.");
      break;
    case "infrastructure":
      hints.push("Network or connectivity issue detected. Check infrastructure health.");
      break;
    case "data_access":
      hints.push("A database-level error occurred. Check data integrity and constraints.");
      break;
    case "business_logic":
      hints.push("A logic or validation error occurred. Review the input data and business rules.");
      break;
    default:
      if (msg.length > 0) hints.push("Review the error message and check the external task worker logs for more details.");
  }

  return hints;
}

function buildMessageSummary(layer: FailureLayer, msg: string, isTransient: boolean): string {
  const layerLabels: Record<FailureLayer, string> = {
    data_access: "data access",
    external_service: "external service",
    business_logic: "business logic",
    worker: "worker",
    infrastructure: "infrastructure",
    configuration: "configuration",
    unknown: "unknown",
  };

  const truncMsg = msg.length > 120 ? msg.substring(0, 117) + "…" : msg;
  const transientStr = isTransient ? "transient" : "persistent";
  return `${transientStr.charAt(0).toUpperCase() + transientStr.slice(1)} ${layerLabels[layer]} error: "${truncMsg}"`;
}
