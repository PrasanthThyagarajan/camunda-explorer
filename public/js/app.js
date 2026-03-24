/**
 * App Entry Point — imports all modules and binds them to window scope
 * for inline onclick handlers in HTML.
 */

import { switchPanel, refreshCurrentPanel } from './navigation.js';
import { openDetail, closeDetail } from './detail-panel.js';
import { showProgress, updateProgress, finishProgress, closeProgress } from './progress.js';
import { copyVal, toast } from './utils.js';
import { toggleTheme, initTheme } from './theme.js';

import { loadHealth, healthNavigate } from './panels/health.js';
import {
  loadIncidents, retryIncident, showIncidentDetail,
  toggleAllIncidents, updateBatchBar, selectAllIncidents, deselectAllIncidents,
  batchRetry, toggleStacktrace,
} from './panels/incidents.js';
import {
  loadInstances, showInstanceDetail, modifyInstance, toggleSuspend, deleteInstance,
  initInstanceFilters,
} from './panels/instances.js';
import {
  openJobsPopup, closeJobsPopup, refreshJobsPopup,
  retryJob, showJobDetail, setJobRetries, executeJob,
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
import { loadHistory, refreshDefKeyDropdown } from './panels/history.js';
import {
  showHistoryTrack, closeHistoryTrack, switchTrackTab,
  toggleTrackStep, filterTrackSteps, expandAllSteps,
  collapseAllSteps, exportTrackJson,
} from './components/history-track.js';
import {
  loadIntelligence, filterIntelDefs, selectIntelDef,
  clearIntelDef, switchIntelTab, toggleClusterDetail,
  toggleClAccordion, toggleClErrorExpand,
  loadClusterStacktrace, toggleClusterStacktraceItem,
  openStacktraceViewer, closeStacktraceViewer, copyStacktraceToClipboard,
} from './panels/intelligence.js';
import {
  openDiagnosis, closeDiagnosis, executeDxRecovery,
  cancelDxConfirm, confirmDxExecute, toggleDxMore, toggleDxSection,
  toggleDxSubSection, toggleDxErrorExpand,
} from './components/diagnosis-panel.js';
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

import {
  closeModifyDialog, selectModifyTarget, modifyIncidentToStart,
  batchModifyToStart, confirmModify, modifyInstanceFromPanel,
  toggleSourceToken, toggleSkipListeners, toggleSkipIoMappings, setInstructionType,
  updateAnnotationValue,
} from './components/modify-dialog.js';
import {
  closeStartDialog, regenerateStartPayload, confirmStartInstance,
} from './components/start-dialog.js';
import {
  toggleQueryExplorer, onQeQuerySelect, executeQuery,
  copyQueryResults, resetQueryExplorer,
} from './components/query-explorer.js';
import {
  openMigrationOverlay, closeMigrationOverlay,
  toggleMigrationDef, toggleMigSelect, toggleMigSelectAll,
  migrateDef, migrateSelected, showVersionPicker, expandVersionPicker,
  selectMigrationVersion, closeMigrationConfirm, confirmMigration,
  deleteDefInstances, deleteSelected,
} from './panels/migration.js';

// Theme
window.toggleTheme = toggleTheme;

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
window.toggleStacktrace = toggleStacktrace;

// Instances
window.loadInstances = loadInstances;
window.showInstanceDetail = showInstanceDetail;
window.modifyInstance = modifyInstance;
window.toggleSuspend = toggleSuspend;
window.deleteInstance = deleteInstance;

// Jobs (popup from Process Instances)
window.openJobsPopup = openJobsPopup;
window.closeJobsPopup = closeJobsPopup;
window.refreshJobsPopup = refreshJobsPopup;
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
window.refreshDefKeyDropdown = refreshDefKeyDropdown;
window.showHistoryTrack = showHistoryTrack;
window.closeHistoryTrack = closeHistoryTrack;
window.switchTrackTab = switchTrackTab;
window.toggleTrackStep = toggleTrackStep;
window.filterTrackSteps = filterTrackSteps;
window.expandAllSteps = expandAllSteps;
window.collapseAllSteps = collapseAllSteps;
window.exportTrackJson = exportTrackJson;

// Intelligence
window.loadIntelligence = loadIntelligence;
window.filterIntelDefs = filterIntelDefs;
window.selectIntelDef = selectIntelDef;
window.clearIntelDef = clearIntelDef;
window.switchIntelTab = switchIntelTab;
window.toggleClusterDetail = toggleClusterDetail;
window.toggleClAccordion = toggleClAccordion;
window.toggleClErrorExpand = toggleClErrorExpand;
window.loadClusterStacktrace = loadClusterStacktrace;
window.toggleClusterStacktraceItem = toggleClusterStacktraceItem;
window.openStacktraceViewer = openStacktraceViewer;
window.closeStacktraceViewer = closeStacktraceViewer;
window.copyStacktraceToClipboard = copyStacktraceToClipboard;

// Diagnosis
window.openDiagnosis = openDiagnosis;
window.closeDiagnosis = closeDiagnosis;
window.executeDxRecovery = executeDxRecovery;
window.cancelDxConfirm = cancelDxConfirm;
window.confirmDxExecute = confirmDxExecute;
window.toggleDxMore = toggleDxMore;
window.toggleDxSection = toggleDxSection;
window.toggleDxSubSection = toggleDxSubSection;
window.toggleDxErrorExpand = toggleDxErrorExpand;

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
window.modifyInstanceFromPanel = modifyInstanceFromPanel;
window.toggleSourceToken = toggleSourceToken;
window.toggleSkipListeners = toggleSkipListeners;
window.toggleSkipIoMappings = toggleSkipIoMappings;
window.setInstructionType = setInstructionType;
window.updateAnnotationValue = updateAnnotationValue;

// Start Instance Dialog
window.closeStartDialog = closeStartDialog;
window.regenerateStartPayload = regenerateStartPayload;
window.confirmStartInstance = confirmStartInstance;

// Health Card Navigation
window.healthNavigate = healthNavigate;

// Query Explorer
window.toggleQueryExplorer = toggleQueryExplorer;
window.onQeQuerySelect = onQeQuerySelect;
window.executeQuery = executeQuery;
window.copyQueryResults = copyQueryResults;
window.resetQueryExplorer = resetQueryExplorer;

// Migration
window.openMigrationOverlay = openMigrationOverlay;
window.closeMigrationOverlay = closeMigrationOverlay;
window.toggleMigrationDef = toggleMigrationDef;
window.toggleMigSelect = toggleMigSelect;
window.toggleMigSelectAll = toggleMigSelectAll;
window.migrateDef = migrateDef;
window.migrateSelected = migrateSelected;
window.showVersionPicker = showVersionPicker;
window.expandVersionPicker = expandVersionPicker;
window.selectMigrationVersion = selectMigrationVersion;
window.closeMigrationConfirm = closeMigrationConfirm;
window.confirmMigration = confirmMigration;
window.deleteDefInstances = deleteDefInstances;
window.deleteSelected = deleteSelected;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDmnDropdownClose();
  initInstanceFilters();
  switchPanel('health');
});
