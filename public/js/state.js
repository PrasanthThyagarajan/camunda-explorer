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
    mode: 'single',           // 'single' | 'batch' | 'instance' | 'batch-instance'
    incidentIds: [],           // incident-mode IDs
    instanceIds: [],           // instance-mode IDs
    processInstanceId: null,   // current instance being modified
    processDefinitionId: null,
    stuckActivityId: null,
    activeTokens: [],          // IActiveToken[] from instance context
    selectedSourceIds: [],     // which tokens to cancel (instance mode)
    selectedTargetId: null,
    instructionType: 'startBeforeActivity',  // 'startBeforeActivity' | 'startAfterActivity'
    activities: [],
    skipCustomListeners: false,
    skipIoMappings: false,
    annotation: '',
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
  dmn: 'DMN Evaluate',
  definitions: 'Process Definitions',
  deployments: 'Deployments',
  tasks: 'User Tasks',
  history: 'History',
  intelligence: 'Process Intelligence',
  environments: 'Environment Setup',
  maintenance: 'Maintenance',
};
