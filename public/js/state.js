export const state = {
  currentPanel: 'health',
  envSelectedColor: '#3b82f6',

  currentIncidents: [],
  procDefNameCache: {},
  procDefFilterBuilt: false,

  dmnDecisions: [],
  dmnInputsMeta: [],
  dmnGroupedVars: {},

  duplicateData: null,
  resolvePreviewIds: [],
  resolvePreviewData: [],
  staleIncidentIds: [],

  modifyDialog: {
    mode: 'single',
    incidentIds: [],
    processDefinitionId: null,
    stuckActivityId: null,
    selectedTargetId: null,
    activities: [],
  },

  qeResultData: null,
};

/**
 * Registry for panel loader functions.
 * Each panel module registers its loader here during import.
 * Avoids circular dependencies between navigation and panels.
 */
export const panelLoaders = {};

export const sidebarRefreshers = {
  envIndicator: null,
  badges: null,
};

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
