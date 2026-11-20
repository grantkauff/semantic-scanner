import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const scannerConfigFile = 'scanner.config.local.json';
const fields = ['tenantId', 'clientId', 'workspaceId'];
const guid = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function validateScannerSettings(value) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw new Error('Scanner settings must contain only tenantId, clientId, and workspaceId. Never put secrets in scanner settings.');
  }
  const settings = {};
  for (const field of fields) {
    const input = value[field];
    if (
      typeof input !== 'string' || !guid.test(input.trim()) ||
      input.trim() === '00000000-0000-0000-0000-000000000000'
    ) {
      throw new Error(`Scanner ${field} must be a nonempty, nonzero GUID. Run npm run setup.`);
    }
    settings[field] = input.trim().toLowerCase();
  }
  return settings;
}

export function readScannerSettings(root, { required = true } = {}) {
  let contents;
  try {
    contents = readFileSync(resolve(root, scannerConfigFile), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!required) return undefined;
    throw new Error(`Missing ${scannerConfigFile}. Run npm run setup before previewing or deploying.`);
  }
  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`${scannerConfigFile} is not valid JSON. Run npm run setup or correct the file.`);
  }
  return validateScannerSettings(value);
}

export function saveScannerSettings(root, value) {
  const settings = validateScannerSettings(value);
  writeFileSync(resolve(root, scannerConfigFile), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return settings;
}
