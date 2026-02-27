/**
 * App Entry Point — Bootstraps all modules and binds to the global scope.
 *
 * SRP: Only responsible for importing modules, binding window globals,
 *      and triggering the initial page load.
 *
 * Why window bindings?
 *   Inline `onclick` handlers in HTML need functions on the global scope.
 *   This is the ONLY file that touches `window.*` — all logic lives in modules.
 */

// ── Core Modules ────────────────────────────────────────────────────
import { switchPanel, refreshCurrentPanel } from './navigation.js';
import { openDetail, closeDetail } from './detail-panel.js';
import { showProgress, updateProgress, finishProgress, closeProgress } from './progress.js';
import { copyVal, toast } from './utils.js';

// ── Panel Modules (side-effect: each registers in panelLoaders) ─────
import { loadHealth } from './panels/health.js';
import {
  loadIncidents, retryIncident, showIncidentDetail,
  toggleAllIncidents, updateBatchBar, selectAllIncidents, deselectAllIncidents,
  batchRetry,
} from './panels/incidents.js';
import {
  loadInstances, showInstanceDetail, modifyInstance, toggleSuspend, deleteInstance,
} from './panels/instances.js';
import {
  loadJobs, retryJob, showJobDetail, setJobRetries, executeJob,
} from './panels/jobs.js';
import {
  loadDmnList, filterDmnList, showDmnDropdown, selectDmn,
  initDmnDropdownClose, regenerateDmnPayload, evaluateDmn, loadDmnXml,
} from './panels/dmn.js';
import {
  loadDefinitions, showBpmnXml, promptStartInstance,
} from './panels/definitions.js';
import {
  loadDeployments, showDeploymentResources,
} from './panels/deployments.js';
import {
  loadTasks, completeTask,
} from './panels/tasks.js';
import { loadHistory } from './panels/history.js';
import {
  loadEnvironments, saveEnvironment, activateEnv, deleteEnv, editEnv,
  cancelEnvEdit, selectEnvColor, testEnvConnection, testEnvById,
} from './panels/environments.js';
import {
  refreshMaintenance,
  scanDuplicates, removeDuplicateGroup, removeAllDuplicates,
  previewResolve, executeBatchResolve,
  findStaleIncidents, resolveStaleIncidents,
} from './panels/maintenance.js';

// ── Component Modules ───────────────────────────────────────────────
import {
  closeModifyDialog, selectModifyTarget, modifyIncidentToStart,
  batchModifyToStart, confirmModify,
} from './components/modify-dialog.js';
import {
  toggleQueryExplorer, onQeQuerySelect, executeQuery,
  copyQueryResults, resetQueryExplorer,
} from './components/query-explorer.js';

// ── Window Bindings ─────────────────────────────────────────────────
// Navigation
window.switchPanel = switchPanel;
window.refreshCurrentPanel = refreshCurrentPanel;

// Detail Panel
window.openDetail = openDetail;
window.closeDetail = closeDetail;

// Progress
window.showProgress = showProgress;
window.updateProgress = updateProgress;
window.finishProgress = finishProgress;
window.closeProgress = closeProgress;

// Clipboard
window.copyVal = copyVal;

// Incidents
window.loadIncidents = loadIncidents;
window.retryIncident = retryIncident;
window.showIncidentDetail = showIncidentDetail;
window.toggleAllIncidents = toggleAllIncidents;
window.updateBatchBar = updateBatchBar;
window.selectAllIncidents = selectAllIncidents;
window.deselectAllIncidents = deselectAllIncidents;
window.batchRetry = batchRetry;

// Instances
window.loadInstances = loadInstances;
window.showInstanceDetail = showInstanceDetail;
window.modifyInstance = modifyInstance;
window.toggleSuspend = toggleSuspend;
window.deleteInstance = deleteInstance;

// Jobs
window.loadJobs = loadJobs;
window.retryJob = retryJob;
window.showJobDetail = showJobDetail;
window.setJobRetries = setJobRetries;
window.executeJob = executeJob;

// DMN
window.loadDmnList = loadDmnList;
window.filterDmnList = filterDmnList;
window.showDmnDropdown = showDmnDropdown;
window.selectDmn = selectDmn;
window.regenerateDmnPayload = regenerateDmnPayload;
window.evaluateDmn = evaluateDmn;
window.loadDmnXml = loadDmnXml;

// Definitions
window.loadDefinitions = loadDefinitions;
window.showBpmnXml = showBpmnXml;
window.promptStartInstance = promptStartInstance;

// Deployments
window.loadDeployments = loadDeployments;
window.showDeploymentResources = showDeploymentResources;

// Tasks
window.loadTasks = loadTasks;
window.completeTask = completeTask;

// History
window.loadHistory = loadHistory;

// Environments
window.loadEnvironments = loadEnvironments;
window.saveEnvironment = saveEnvironment;
window.activateEnv = activateEnv;
window.deleteEnv = deleteEnv;
window.editEnv = editEnv;
window.cancelEnvEdit = cancelEnvEdit;
window.selectEnvColor = selectEnvColor;
window.testEnvConnection = testEnvConnection;
window.testEnvById = testEnvById;

// Maintenance
window.refreshMaintenance = refreshMaintenance;
window.scanDuplicates = scanDuplicates;
window.removeDuplicateGroup = removeDuplicateGroup;
window.removeAllDuplicates = removeAllDuplicates;
window.previewResolve = previewResolve;
window.executeBatchResolve = executeBatchResolve;
window.findStaleIncidents = findStaleIncidents;
window.resolveStaleIncidents = resolveStaleIncidents;

// Modify Dialog
window.closeModifyDialog = closeModifyDialog;
window.selectModifyTarget = selectModifyTarget;
window.modifyIncidentToStart = modifyIncidentToStart;
window.batchModifyToStart = batchModifyToStart;
window.confirmModify = confirmModify;

// Query Explorer
window.toggleQueryExplorer = toggleQueryExplorer;
window.onQeQuerySelect = onQeQuerySelect;
window.executeQuery = executeQuery;
window.copyQueryResults = copyQueryResults;
window.resetQueryExplorer = resetQueryExplorer;

// ── Initialization ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initialize DMN dropdown close behavior
  initDmnDropdownClose();

  // Load the default panel (health)
  switchPanel('health');
});
