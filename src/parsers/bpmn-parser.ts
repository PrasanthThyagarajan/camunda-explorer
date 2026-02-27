/**
 * BPMN XML Parser — pure functions, no side effects, no framework dependencies.
 *
 * Extracts structural information from BPMN 2.0 XML:
 *   - First executable activity after a start event
 *   - All activities in flow order (BFS traversal)
 *
 * SRP: This module's sole responsibility is BPMN XML analysis.
 */

import {
  MAX_GATEWAY_TRAVERSAL_HOPS,
  BPMN_ACTIVITY_TYPES,
  BPMN_GATEWAY_TYPES,
  BPMN_EVENT_TYPES,
} from "../constants.js";
import type { IBpmnFirstActivity, IBpmnActivity } from "../interfaces/parsers.js";

// ── Internal helpers ────────────────────────────────────────────────

/** Find the targetRef of a sequence flow from a given sourceRef */
function findTarget(bpmnXml: string, sourceId: string): string | null {
  const r1 = new RegExp(
    `<(?:bpmn2?:)?sequenceFlow[^>]+sourceRef="${sourceId}"[^>]+targetRef="([^"]+)"`
  );
  const r2 = new RegExp(
    `<(?:bpmn2?:)?sequenceFlow[^>]+targetRef="([^"]+)"[^>]+sourceRef="${sourceId}"`
  );
  return bpmnXml.match(r1)?.[1] || bpmnXml.match(r2)?.[1] || null;
}

/** Check if an element ID is a gateway */
function isGateway(bpmnXml: string, elementId: string): boolean {
  const r = new RegExp(`<(?:bpmn2?:)?\\w*[Gg]ateway[^>]+id="${elementId}"`);
  return r.test(bpmnXml);
}

/** Get the name attribute of an element by its ID */
function getElementName(bpmnXml: string, elementId: string): string | null {
  const r1 = new RegExp(`<(?:bpmn2?:)?\\w+[^>]+id="${elementId}"[^>]*?name="([^"]*)"`);
  const r2 = new RegExp(`<(?:bpmn2?:)?\\w+[^>]+name="([^"]*)"[^>]*?id="${elementId}"`);
  return bpmnXml.match(r1)?.[1] || bpmnXml.match(r2)?.[1] || null;
}

/** Extract the start event ID from BPMN XML */
function findStartEventId(bpmnXml: string): string | null {
  const match = bpmnXml.match(/<(?:bpmn2?:)?startEvent\s+[^>]*?id="([^"]+)"/);
  return match?.[1] || null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Find the first executable activity after the start event.
 * Traverses past gateways (up to MAX_GATEWAY_TRAVERSAL_HOPS) to find an actual task/event.
 */
export function parseFirstActivity(bpmnXml: string): IBpmnFirstActivity | null {
  const startEventId = findStartEventId(bpmnXml);
  if (!startEventId) return null;

  let currentId = startEventId;
  for (let hop = 0; hop < MAX_GATEWAY_TRAVERSAL_HOPS; hop++) {
    const nextId = findTarget(bpmnXml, currentId);
    if (!nextId) return null;

    if (!isGateway(bpmnXml, nextId)) {
      return {
        startEventId,
        firstActivityId: nextId,
        firstActivityName: getElementName(bpmnXml, nextId) || nextId,
      };
    }
    currentId = nextId;
  }

  return null;
}

/**
 * Extract ALL activities from BPMN XML in flow order (BFS from start event).
 * Activities not reachable from start are appended at the end.
 */
export function parseAllActivities(bpmnXml: string): IBpmnActivity[] {
  const firstAct = parseFirstActivity(bpmnXml);
  const firstId = firstAct?.firstActivityId || null;

  // 1. Build a map of all BPMN activity elements (id → { name, type })
  const elementMap: Record<string, { name: string; type: string }> = {};
  for (const elType of BPMN_ACTIVITY_TYPES) {
    const regex = new RegExp(`<(?:bpmn2?:)?${elType}\\s+([^>]*?)\\/?\\s*>`, "g");
    let m;
    while ((m = regex.exec(bpmnXml)) !== null) {
      const attrs = m[1];
      const idMatch = attrs.match(/id="([^"]+)"/);
      const nameMatch = attrs.match(/name="([^"]+)"/);
      if (idMatch) {
        elementMap[idMatch[1]] = {
          name: nameMatch ? nameMatch[1] : idMatch[1],
          type: elType,
        };
      }
    }
  }

  // 2. Build adjacency list from sequence flows
  const adjacency: Record<string, string[]> = {};
  const flowRegex = /<(?:bpmn2?:)?sequenceFlow\s+[^>]*?id="[^"]*"[^>]*>/g;
  let fm;
  while ((fm = flowRegex.exec(bpmnXml)) !== null) {
    const tag = fm[0];
    const srcMatch = tag.match(/sourceRef="([^"]+)"/);
    const tgtMatch = tag.match(/targetRef="([^"]+)"/);
    if (srcMatch && tgtMatch) {
      if (!adjacency[srcMatch[1]]) adjacency[srcMatch[1]] = [];
      adjacency[srcMatch[1]].push(tgtMatch[1]);
    }
  }

  // 3. Index all node IDs (for BFS traversal)
  const allNodeTypes = [
    ...BPMN_EVENT_TYPES,
    ...BPMN_GATEWAY_TYPES,
    ...BPMN_ACTIVITY_TYPES,
  ];
  const allNodeIds = new Set<string>();
  for (const nt of allNodeTypes) {
    const regex = new RegExp(`<(?:bpmn2?:)?${nt}\\s+[^>]*?id="([^"]+)"`, "g");
    let m;
    while ((m = regex.exec(bpmnXml)) !== null) {
      allNodeIds.add(m[1]);
    }
  }

  // 4. BFS from startEvent to produce activities in flow order
  const startId = findStartEventId(bpmnXml);
  const orderedActivities: IBpmnActivity[] = [];
  const visited = new Set<string>();
  let order = 0;

  if (startId) {
    const queue: string[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;

      if (elementMap[nodeId]) {
        orderedActivities.push({
          id: nodeId,
          name: elementMap[nodeId].name,
          type: elementMap[nodeId].type,
          isFirst: nodeId === firstId,
          order: order++,
        });
      }

      const targets = adjacency[nodeId] || [];
      for (const tgt of targets) {
        if (!visited.has(tgt)) {
          visited.add(tgt);
          queue.push(tgt);
        }
      }
    }
  }

  // 5. Append disconnected activities
  for (const [id, info] of Object.entries(elementMap)) {
    if (!visited.has(id)) {
      orderedActivities.push({
        id,
        name: info.name,
        type: info.type,
        isFirst: id === firstId,
        order: order++,
      });
    }
  }

  return orderedActivities;
}
