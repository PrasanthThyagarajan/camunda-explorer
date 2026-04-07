import {
  MAX_GATEWAY_TRAVERSAL_HOPS,
  BPMN_ACTIVITY_TYPES,
  BPMN_GATEWAY_TYPES,
  BPMN_EVENT_TYPES,
} from "../constants.js";
import type { IBpmnFirstActivity, IBpmnActivity, IBpmnFormField, IBpmnStartFormResult } from "../interfaces/parsers.js";

function findTarget(bpmnXml: string, sourceId: string): string | null {
  const r1 = new RegExp(
    `<(?:bpmn2?:)?sequenceFlow[^>]+sourceRef="${sourceId}"[^>]+targetRef="([^"]+)"`
  );
  const r2 = new RegExp(
    `<(?:bpmn2?:)?sequenceFlow[^>]+targetRef="([^"]+)"[^>]+sourceRef="${sourceId}"`
  );
  return bpmnXml.match(r1)?.[1] || bpmnXml.match(r2)?.[1] || null;
}

function isGateway(bpmnXml: string, elementId: string): boolean {
  const r = new RegExp(`<(?:bpmn2?:)?\\w*[Gg]ateway[^>]+id="${elementId}"`);
  return r.test(bpmnXml);
}

function getElementName(bpmnXml: string, elementId: string): string | null {
  const r1 = new RegExp(`<(?:bpmn2?:)?\\w+[^>]+id="${elementId}"[^>]*?name="([^"]*)"`);
  const r2 = new RegExp(`<(?:bpmn2?:)?\\w+[^>]+name="([^"]*)"[^>]*?id="${elementId}"`);
  return bpmnXml.match(r1)?.[1] || bpmnXml.match(r2)?.[1] || null;
}

function findStartEventId(bpmnXml: string): string | null {
  const match = bpmnXml.match(/<(?:bpmn2?:)?startEvent\s+[^>]*?id="([^"]+)"/);
  return match?.[1] || null;
}

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

export function parseAllActivities(bpmnXml: string): IBpmnActivity[] {
  const firstAct = parseFirstActivity(bpmnXml);
  const firstId = firstAct?.firstActivityId || null;

  // Include all BPMN node types (activities, events, gateways) in the
  // element map so boundary events and gateways appear as valid targets
  // for process instance modification.
  const allElementTypes = [
    ...BPMN_ACTIVITY_TYPES,
    ...BPMN_EVENT_TYPES,
    ...BPMN_GATEWAY_TYPES,
  ];
  const elementMap: Record<string, { name: string; type: string }> = {};
  for (const elType of allElementTypes) {
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

  const startId = findStartEventId(bpmnXml);
  const orderedActivities: IBpmnActivity[] = [];
  const visited = new Set<string>();
  let order = 0;

  if (startId) {
    // ── Step 1: detect back-edges (loops) via DFS so they don't block
    //    the topological sort. BPMN processes can have retry/approval loops.
    const backEdges = new Set<string>();
    const onStack = new Set<string>();
    const dfsVisited = new Set<string>();

    function detectBackEdges(nodeId: string): void {
      dfsVisited.add(nodeId);
      onStack.add(nodeId);
      for (const tgt of adjacency[nodeId] || []) {
        if (onStack.has(tgt)) {
          backEdges.add(`${nodeId}→${tgt}`);
        } else if (!dfsVisited.has(tgt)) {
          detectBackEdges(tgt);
        }
      }
      onStack.delete(nodeId);
    }
    detectBackEdges(startId);

    // ── Step 2: compute in-degree for each node, excluding back-edges
    const inDegree: Record<string, number> = {};
    for (const nodeId of allNodeIds) {
      inDegree[nodeId] = 0;
    }
    for (const [src, targets] of Object.entries(adjacency)) {
      for (const tgt of targets) {
        if (!backEdges.has(`${src}→${tgt}`)) {
          inDegree[tgt] = (inDegree[tgt] || 0) + 1;
        }
      }
    }

    // ── Step 3: Kahn's topological sort with path-following priority.
    //    Instead of a plain FIFO queue, we prefer to continue along the
    //    current path (successors of the last processed node) before
    //    switching to a different branch. This produces flow-order output
    //    that follows each branch to completion before moving to the next.
    const availableSet = new Set<string>();
    const availableList: string[] = [];

    function addAvailable(nodeId: string): void {
      if (!availableSet.has(nodeId) && !visited.has(nodeId)) {
        availableSet.add(nodeId);
        availableList.push(nodeId);
      }
    }

    if ((inDegree[startId] || 0) === 0) {
      addAvailable(startId);
    }

    let lastSuccessors: string[] = [];

    while (availableSet.size > 0) {
      // pick next: prefer a successor of the last-processed node
      let nextNode: string | null = null;
      for (const s of lastSuccessors) {
        if (availableSet.has(s)) {
          nextNode = s;
          break;
        }
      }
      // fallback: first available node (preserves discovery order)
      if (!nextNode) {
        for (const n of availableList) {
          if (availableSet.has(n)) {
            nextNode = n;
            break;
          }
        }
      }
      if (!nextNode) break;

      availableSet.delete(nextNode);
      visited.add(nextNode);

      if (elementMap[nextNode]) {
        orderedActivities.push({
          id: nextNode,
          name: elementMap[nextNode].name,
          type: elementMap[nextNode].type,
          isFirst: nextNode === firstId,
          order: order++,
        });
      }

      // remember this node's successors as the preferred next picks
      lastSuccessors = (adjacency[nextNode] || []).filter(
        (tgt) => !backEdges.has(`${nextNode}→${tgt}`)
      );

      // decrement in-degree of successors; when a node reaches 0 it's ready
      for (const tgt of lastSuccessors) {
        inDegree[tgt]--;
        if (inDegree[tgt] === 0) {
          addAvailable(tgt);
        }
      }
    }
  }

  // append any activities not reachable from the start event (isolated nodes,
  // or activities inside event sub-processes that have their own entry point)
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

export function parseStartFormFields(bpmnXml: string): IBpmnStartFormResult {
  const nameMatch = bpmnXml.match(/<(?:bpmn2?:)?process[^>]+name="([^"]+)"/);
  const keyMatch = bpmnXml.match(/<(?:bpmn2?:)?process[^>]+id="([^"]+)"/);
  const processName = nameMatch?.[1] || keyMatch?.[1] || "Unknown";
  const processKey = keyMatch?.[1] || "";

  const formFields: IBpmnFormField[] = [];

  const startEventRegex = /<(?:bpmn2?:)?startEvent\s+[^>]*?id="[^"]*"[^>]*>([\s\S]*?)<\/(?:bpmn2?:)?startEvent>/;
  const startEventMatch = bpmnXml.match(startEventRegex);

  if (startEventMatch) {
    const startEventBody = startEventMatch[1];

    const formFieldRegex = /<camunda:formField\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/camunda:formField>)/g;
    let fieldMatch;
    while ((fieldMatch = formFieldRegex.exec(startEventBody)) !== null) {
      const attrs = fieldMatch[1];
      const body = fieldMatch[2] || "";

      const idMatch = attrs.match(/id="([^"]+)"/);
      const labelMatch = attrs.match(/label="([^"]+)"/);
      const typeMatch = attrs.match(/type="([^"]+)"/);
      const defaultMatch = attrs.match(/defaultValue="([^"]*)"/);

      const enumValues: Array<{ id: string; name: string }> = [];
      if (typeMatch?.[1] === "enum") {
        const valueRegex = /<camunda:value\s+([^>]*?)\/?>/g;
        let valMatch;
        while ((valMatch = valueRegex.exec(body)) !== null) {
          const valAttrs = valMatch[1];
          const valId = valAttrs.match(/id="([^"]+)"/);
          const valName = valAttrs.match(/name="([^"]+)"/);
          if (valId) {
            enumValues.push({ id: valId[1], name: valName?.[1] || valId[1] });
          }
        }
      }

      formFields.push({
        id: idMatch?.[1] || "",
        label: labelMatch?.[1] || idMatch?.[1] || "field",
        type: (typeMatch?.[1] || "string").toLowerCase(),
        defaultValue: defaultMatch?.[1] || "",
        enumValues,
      });
    }
  }

  const samplePayload: Record<string, unknown> = {};
  for (const field of formFields) {
    let value: unknown;
    let type: string;

    switch (field.type) {
      case "long":
      case "integer":
        value = field.defaultValue ? parseInt(field.defaultValue) || 0 : 0;
        type = field.type === "long" ? "Long" : "Integer";
        break;
      case "double":
        value = field.defaultValue ? parseFloat(field.defaultValue) || 0.0 : 0.0;
        type = "Double";
        break;
      case "boolean":
        value = field.defaultValue === "true";
        type = "Boolean";
        break;
      case "date":
        value = field.defaultValue || "2026-01-01T00:00:00.000+0000";
        type = "Date";
        break;
      case "enum":
        value = field.defaultValue || (field.enumValues[0]?.id ?? "");
        type = "String";
        break;
      default:
        value = field.defaultValue || "";
        type = "String";
        break;
    }

    samplePayload[field.id] = { value, type };
  }

  return {
    processDefinitionKey: processKey,
    processDefinitionName: processName,
    hasFormFields: formFields.length > 0,
    formFields,
    samplePayload,
  };
}
