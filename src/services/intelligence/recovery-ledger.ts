/**
 * Recovery Ledger — Persists recovery action outcomes.
 *
 * Records every recovery action executed through the intelligence system
 * and tracks whether the action led to a successful process completion.
 *
 * This data feeds back into the Recovery Ranker to replace heuristic
 * confidence scores with real, data-driven success rates over time.
 *
 * Storage: Simple append-only JSON file (one JSON object per line, JSONL).
 * Kept lightweight — no database dependency.
 */

import fs from "fs";
import path from "path";
import { logger } from "../../utils/logger.js";
import type { RecoveryType } from "../../interfaces/intelligence.js";

// ── Configuration ───────────────────────────────────────────────

const LEDGER_FILENAME = "recovery-ledger.jsonl";
const MAX_LOOKUP_ENTRIES = 500; // cap for in-memory lookups

// ── Types ───────────────────────────────────────────────────────

export interface RecoveryRecord {
  /** Unique ID for this record */
  id: string;
  /** ISO timestamp when the action was executed */
  timestamp: string;
  /** Process definition key (BPMN) */
  definitionKey: string;
  /** The activity that failed */
  failedActivityId: string;
  /** Normalized error pattern (first 100 chars of error message) */
  errorPattern: string;
  /** Recovery type that was executed */
  recoveryType: RecoveryType;
  /** Target activity for the recovery */
  targetActivityId: string;
  /** Process instance ID */
  instanceId: string;
  /** Whether the immediate Camunda API call succeeded */
  executionSuccess: boolean;
  /** Outcome verification: "pending" → "success" | "failed" | "unknown" */
  outcome: "pending" | "success" | "failed" | "unknown";
  /** Timestamp of outcome verification */
  outcomeVerifiedAt?: string;
}

/** Aggregated success rate for a specific recovery pattern */
export interface RecoverySuccessRate {
  /** How many times this pattern was attempted */
  totalAttempts: number;
  /** How many led to successful outcomes */
  successCount: number;
  /** Computed rate (0.0 to 1.0), or null if not enough data */
  rate: number | null;
  /** Whether this rate is meaningful (>= 3 data points) */
  isSignificant: boolean;
}

// ── Ledger Class ────────────────────────────────────────────────

class RecoveryLedger {
  private filePath: string;
  private entries: RecoveryRecord[] = [];
  private loaded = false;

  constructor() {
    // Store in the project data directory
    this.filePath = path.resolve(
      process.cwd(),
      "data",
      LEDGER_FILENAME
    );
  }

  /**
   * Record a new recovery action.
   */
  record(entry: Omit<RecoveryRecord, "id" | "timestamp" | "outcome">): string {
    const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const record: RecoveryRecord = {
      ...entry,
      id,
      timestamp: new Date().toISOString(),
      outcome: entry.executionSuccess ? "pending" : "failed",
    };

    // Write immediately (append-only)
    this.appendToFile(record);
    this.entries.push(record);

    logger.info(
      `[LEDGER] Recorded recovery: ${record.recoveryType} on ${record.definitionKey}/${record.failedActivityId} → ${record.outcome}`
    );

    return id;
  }

  /**
   * Update the outcome of a previously recorded recovery action.
   */
  updateOutcome(
    recordId: string,
    outcome: "success" | "failed" | "unknown"
  ): void {
    this.ensureLoaded();
    const entry = this.entries.find((e) => e.id === recordId);
    if (!entry) return;

    entry.outcome = outcome;
    entry.outcomeVerifiedAt = new Date().toISOString();

    // Rewrite the full file to persist the update
    this.persistAll();

    logger.info(`[LEDGER] Updated outcome: ${recordId} → ${outcome}`);
  }

  /**
   * Get aggregated success rate for a recovery pattern.
   * Pattern = definitionKey + failedActivityId + recoveryType
   */
  getSuccessRate(
    definitionKey: string,
    failedActivityId: string,
    recoveryType: RecoveryType
  ): RecoverySuccessRate {
    this.ensureLoaded();

    const matching = this.entries.filter(
      (e) =>
        e.definitionKey === definitionKey &&
        e.failedActivityId === failedActivityId &&
        e.recoveryType === recoveryType &&
        (e.outcome === "success" || e.outcome === "failed") // only count verified outcomes
    );

    const successCount = matching.filter(
      (e) => e.outcome === "success"
    ).length;

    return {
      totalAttempts: matching.length,
      successCount,
      rate: matching.length >= 3 ? successCount / matching.length : null,
      isSignificant: matching.length >= 3,
    };
  }

  /**
   * Get all pending entries (for background outcome verification).
   */
  getPending(): RecoveryRecord[] {
    this.ensureLoaded();
    return this.entries.filter((e) => e.outcome === "pending");
  }

  /**
   * Get recent recovery actions for a definition (for display in the UI).
   */
  getRecentForDefinition(
    definitionKey: string,
    limit = 10
  ): RecoveryRecord[] {
    this.ensureLoaded();
    return this.entries
      .filter((e) => e.definitionKey === definitionKey)
      .slice(-limit);
  }

  // ── Internal ────────────────────────────────────────────────

  private ensureLoaded(): void {
    if (this.loaded) return;

    try {
      // Ensure data directory exists
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.filePath)) {
        this.entries = [];
        this.loaded = true;
        return;
      }

      const content = fs.readFileSync(this.filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      this.entries = lines
        .map((line) => {
          try {
            return JSON.parse(line) as RecoveryRecord;
          } catch {
            return null;
          }
        })
        .filter((e): e is RecoveryRecord => e !== null)
        .slice(-MAX_LOOKUP_ENTRIES); // keep only the last N entries in memory

      this.loaded = true;
      logger.info(`[LEDGER] Loaded ${this.entries.length} recovery records`);
    } catch (err) {
      logger.warn(`[LEDGER] Failed to load ledger: ${err}`);
      this.entries = [];
      this.loaded = true;
    }
  }

  private appendToFile(record: RecoveryRecord): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    } catch (err) {
      logger.warn(`[LEDGER] Failed to append to ledger: ${err}`);
    }
  }

  private persistAll(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      fs.writeFileSync(this.filePath, content, "utf-8");
    } catch (err) {
      logger.warn(`[LEDGER] Failed to persist ledger: ${err}`);
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────

export const recoveryLedger = new RecoveryLedger();
