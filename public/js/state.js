/**
 * Shared application state — single source of truth.
 *
 * SRP: Only manages global mutable state and registries.
 * All modules read/write through this object.
 */

export const state = {
  currentPanel: 'health',
  envSelectedColor: '#3b82f6',

  // Incident state
  currentIncidents: [],
  procDefNameCache: {},
  procDefFilterBuilt: false,

  // DMN state
  dmnDecisions: [],
  dmnInputsMeta: [],
  dmnGroupedVars: {},

  // Maintenance state
  duplicateData: null,
  resolvePreviewIds: [],
  resolvePreviewData: [],
  staleIncidentIds: [],

  // Modify dialog state
  modifyDialog: {
    mode: 'single',
    incidentIds: [],
    processDefinitionId: null,
    stuckActivityId: null,
    selectedTargetId: null,
    activities: [],
  },

  // Query Explorer state
  qeResultData: null,
};

/**
 * Registry for panel loader functions.
 * Each panel module registers its loader here during import.
 * Avoids circular dependencies between navigation and panels.
 */
export const panelLoaders = {};

/**
 * Registry for sidebar refresh functions.
 * Set by navigation module, read by other modules.
 */
export const sidebarRefreshers = {
  envIndicator: null,
  badges: null,
};

/**
 * Panel title mapping.
 */
export const PANEL_TITLES = {
  health: 'Engine Health',
  incidents: 'Incidents',
  instances: 'Process Instances',
  jobs: 'Jobs',
  dmn: 'DMN Evaluate',
  definitions: 'Process Definitions',
  deployments: 'Deployments',
  tasks: 'User Tasks',
  history: 'History',
  environments: 'Environment Setup',
  maintenance: 'Maintenance',
};
