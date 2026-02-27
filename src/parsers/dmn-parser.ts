/**
 * DMN XML Parser — pure functions, no side effects, no framework dependencies.
 *
 * Extracts input/output columns and metadata from DMN XML.
 * Builds sample payloads for Camunda REST API evaluation.
 *
 * SRP: This module's sole responsibility is DMN XML analysis.
 */

import { DMN_TYPE_MAP } from "../constants.js";
import type {
  IDmnInput,
  IDmnOutput,
  IDmnParseResult,
  IDmnGroupedVariable,
} from "../interfaces/parsers.js";

/**
 * Parse a DMN XML string and extract inputs, outputs, hit policy, and decision name.
 */
export function parseDmnInputs(dmnXml: string): IDmnParseResult {
  const decNameMatch = dmnXml.match(/<decision[^>]+name="([^"]+)"/);
  const decisionName = decNameMatch?.[1] || "Unknown";

  const hitPolicyMatch = dmnXml.match(/<decisionTable[^>]+hitPolicy="([^"]+)"/);
  const hitPolicy = hitPolicyMatch?.[1] || "UNIQUE";

  // Extract inputs
  const inputs: IDmnInput[] = [];
  const inputBlockRegex = /<input\s+([^>]*?)>([\s\S]*?)<\/input>/g;
  let inputMatch;
  while ((inputMatch = inputBlockRegex.exec(dmnXml)) !== null) {
    const inputAttrs = inputMatch[1];
    const inputBody = inputMatch[2];

    const idMatch = inputAttrs.match(/id="([^"]+)"/);
    const labelMatch = inputAttrs.match(/label="([^"]+)"/);

    const exprMatch = inputBody.match(
      /<inputExpression[^>]*?typeRef="([^"]*)"[^>]*>([\s\S]*?)<\/inputExpression>/
    );
    let typeRef = "string";
    let expression = "";
    if (exprMatch) {
      typeRef = exprMatch[1].toLowerCase();
      const textMatch = exprMatch[2].match(/<text>\s*([\s\S]*?)\s*<\/text>/);
      expression = textMatch?.[1] || "";
    }

    const mapping = DMN_TYPE_MAP[typeRef] || DMN_TYPE_MAP["string"];

    inputs.push({
      id: idMatch?.[1] || "",
      label: labelMatch?.[1] || expression || "input",
      expression,
      typeRef,
      camundaType: mapping.camundaType,
      sampleValue: mapping.sampleValue,
    });
  }

  // Extract outputs
  const outputs: IDmnOutput[] = [];
  const outputRegex = /<output\s+([^>]*?)\/?\s*>/g;
  let outputMatch;
  while ((outputMatch = outputRegex.exec(dmnXml)) !== null) {
    const attrs = outputMatch[1];
    const idMatch = attrs.match(/id="([^"]+)"/);
    const labelMatch = attrs.match(/label="([^"]+)"/);
    const nameMatch = attrs.match(/name="([^"]+)"/);
    const typeMatch = attrs.match(/typeRef="([^"]+)"/);
    outputs.push({
      id: idMatch?.[1] || "",
      label: labelMatch?.[1] || "",
      name: nameMatch?.[1] || "",
      typeRef: typeMatch?.[1] || "string",
    });
  }

  return { inputs, outputs, hitPolicy, decisionName };
}

/**
 * Group DMN inputs by their root variable name.
 * Dot-notation expressions (e.g. "obj.field1", "obj.field2") are grouped
 * into a single nested variable.
 */
export function groupDmnInputs(
  inputs: IDmnInput[]
): Record<string, IDmnGroupedVariable> {
  const grouped: Record<string, IDmnGroupedVariable> = {};

  for (const inp of inputs) {
    const expr = inp.expression || inp.label;
    const dotIdx = expr.indexOf(".");
    if (dotIdx > 0) {
      const rootVar = expr.substring(0, dotIdx);
      const property = expr.substring(dotIdx + 1);
      if (!grouped[rootVar]) grouped[rootVar] = { fields: [], isNested: true };
      grouped[rootVar].fields.push({
        path: property,
        expression: expr,
        typeRef: inp.typeRef,
        camundaType: inp.camundaType,
        sampleValue: inp.sampleValue,
      });
    } else {
      if (!grouped[expr]) grouped[expr] = { fields: [], isNested: false };
      grouped[expr].fields.push({
        path: "",
        expression: expr,
        typeRef: inp.typeRef,
        camundaType: inp.camundaType,
        sampleValue: inp.sampleValue,
      });
    }
  }

  return grouped;
}

/**
 * Build a sample Camunda evaluation payload from grouped DMN inputs.
 */
export function buildSamplePayload(
  grouped: Record<string, IDmnGroupedVariable>
): Record<string, unknown> {
  const samplePayload: Record<string, unknown> = {};

  for (const [varName, group] of Object.entries(grouped)) {
    if (group.isNested) {
      const nestedValue: Record<string, unknown> = {};
      for (const field of group.fields) {
        nestedValue[field.path] = String(field.sampleValue);
      }
      samplePayload[varName] = { value: nestedValue };
    } else {
      const field = group.fields[0];
      samplePayload[varName] = { value: field.sampleValue, type: field.camundaType };
    }
  }

  return samplePayload;
}
