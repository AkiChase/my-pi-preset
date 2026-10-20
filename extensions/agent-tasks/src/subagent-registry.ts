import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export const SUBAGENT_REGISTRY_VERSION = 1;

export type PersistentAgentStatus = "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error" | "interrupted";

export interface RootRegistryLocator {
  rootSessionFile: string;
  registryFile: string;
}

export interface PersistentAgentEntry {
  agentId: string;
  type: string;
  index: number;
  parentAgentId: string | null;
  sessionFile?: string;
  status: PersistentAgentStatus;
  interruptionReason?: "pi_exit";
  createdAt: number;
  updatedAt: number;
}

export interface SubagentRegistry {
  version: typeof SUBAGENT_REGISTRY_VERSION;
  rootSessionFile: string;
  agents: Record<string, PersistentAgentEntry>;
  nextIndexByParent: Record<string, number>;
}

const ROOT_SCOPE = "root";
const PERSISTENT_AGENT_STATUSES: ReadonlySet<PersistentAgentStatus> = new Set([
  "queued", "running", "completed", "steered", "aborted", "stopped", "error", "interrupted",
]);
const PERSISTENT_AGENT_ID = /^agent_[a-z0-9]+(?:_[a-z0-9]+)*_[0-9]+_[a-f0-9]{8}$/;

function scopeKey(parentAgentId: string | undefined): string {
  return parentAgentId ?? ROOT_SCOPE;
}

function normalizeType(type: string): string {
  const normalized = type.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "agent";
}

export function registryLocatorForRootSession(rootSessionFile: string): RootRegistryLocator {
  if (!isAbsolute(rootSessionFile)) throw new Error("Subagent persistence requires an absolute root session file.");
  if (!rootSessionFile.endsWith(".jsonl")) throw new Error("Subagent persistence requires a root session JSONL file.");
  return {
    rootSessionFile,
    registryFile: join(dirname(rootSessionFile), `${basename(rootSessionFile, ".jsonl")}.subagents.json`),
  };
}

function assertEntry(entry: unknown, agentId: string): asserts entry is PersistentAgentEntry {
  if (!entry || typeof entry !== "object") throw new Error(`Invalid subagent registry entry: ${agentId}`);
  const value = entry as Record<string, unknown>;
  const index = value.index;
  const status = value.status;
  if (!PERSISTENT_AGENT_ID.test(agentId) || value.agentId !== agentId || typeof value.type !== "string" || !value.type.trim() ||
    typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 ||
    (value.parentAgentId !== null && (typeof value.parentAgentId !== "string" || !PERSISTENT_AGENT_ID.test(value.parentAgentId))) ||
    (value.sessionFile !== undefined && (typeof value.sessionFile !== "string" || !isAbsolute(value.sessionFile) || !value.sessionFile.endsWith(".jsonl"))) ||
    typeof status !== "string" || !PERSISTENT_AGENT_STATUSES.has(status as PersistentAgentStatus) ||
    (value.interruptionReason !== undefined && (status !== "interrupted" || value.interruptionReason !== "pi_exit")) ||
    !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) {
    throw new Error(`Invalid subagent registry entry: ${agentId}`);
  }
}

function validateRegistry(value: unknown, locator: RootRegistryLocator): SubagentRegistry {
  if (!value || typeof value !== "object") throw new Error("Invalid subagent registry.");
  const registry = value as Partial<SubagentRegistry>;
  if (registry.version !== SUBAGENT_REGISTRY_VERSION || registry.rootSessionFile !== locator.rootSessionFile ||
    !registry.agents || typeof registry.agents !== "object" || !registry.nextIndexByParent || typeof registry.nextIndexByParent !== "object") {
    throw new Error("Invalid subagent registry.");
  }
  for (const [agentId, entry] of Object.entries(registry.agents)) {
    assertEntry(entry, agentId);
    if (entry.parentAgentId !== null && !registry.agents[entry.parentAgentId]) {
      throw new Error(`Invalid subagent registry parent: ${agentId}`);
    }
  }
  for (const [scope, next] of Object.entries(registry.nextIndexByParent)) {
    if ((scope !== ROOT_SCOPE && !registry.agents[scope]) || !Number.isSafeInteger(next) || next < 0) {
      throw new Error("Invalid subagent registry index state.");
    }
  }
  return registry as SubagentRegistry;
}

export function loadSubagentRegistry(locator: RootRegistryLocator): SubagentRegistry | undefined {
  if (!existsSync(locator.registryFile)) return undefined;
  try {
    return validateRegistry(JSON.parse(readFileSync(locator.registryFile, "utf8")), locator);
  } catch (error) {
    throw new Error(`Cannot read subagent registry ${locator.registryFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function emptyRegistry(locator: RootRegistryLocator): SubagentRegistry {
  return { version: SUBAGENT_REGISTRY_VERSION, rootSessionFile: locator.rootSessionFile, agents: {}, nextIndexByParent: {} };
}

function writeRegistry(locator: RootRegistryLocator, registry: SubagentRegistry): void {
  mkdirSync(dirname(locator.registryFile), { recursive: true });
  const temp = join(dirname(locator.registryFile), `.${basename(locator.registryFile)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    fd = openSync(temp, "r");
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, locator.registryFile);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch { /* cleanup only */ }
    throw new Error(`Cannot update subagent registry ${locator.registryFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadOrCreate(locator: RootRegistryLocator): SubagentRegistry {
  if (!existsSync(locator.rootSessionFile)) {
    throw new Error("Subagent persistence requires the parent session JSONL file.");
  }
  return loadSubagentRegistry(locator) ?? emptyRegistry(locator);
}

export function allocatePersistentAgent(
  locator: RootRegistryLocator,
  type: string,
  parentAgentId: string | undefined,
  options: { now?: () => number; uuid?: () => string } = {},
): PersistentAgentEntry {
  const registry = loadOrCreate(locator);
  if (parentAgentId !== undefined && !registry.agents[parentAgentId]) {
    throw new Error(`Cannot create nested subagent: parent "${parentAgentId}" is not in the root registry.`);
  }
  const scope = scopeKey(parentAgentId);
  const index = registry.nextIndexByParent[scope] ?? 0;
  const now = (options.now ?? Date.now)();
  const prefix = `agent_${normalizeType(type)}_${index}_`;
  const uuid = options.uuid ?? randomUUID;
  let agentId: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = uuid().replace(/-/g, "").slice(0, 8).toLowerCase();
    if (/^[a-f0-9]{8}$/.test(suffix) && !registry.agents[`${prefix}${suffix}`]) {
      agentId = `${prefix}${suffix}`;
      break;
    }
  }
  if (!agentId) throw new Error("Could not allocate a unique persistent subagent ID.");
  const entry: PersistentAgentEntry = {
    agentId,
    type,
    index,
    parentAgentId: parentAgentId ?? null,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  registry.agents[agentId] = entry;
  registry.nextIndexByParent[scope] = index + 1;
  writeRegistry(locator, registry);
  return entry;
}

export function updatePersistentAgent(
  locator: RootRegistryLocator,
  agentId: string,
  update: Partial<Pick<PersistentAgentEntry, "sessionFile" | "status" | "interruptionReason">>,
  now = Date.now(),
): PersistentAgentEntry {
  const registry = loadOrCreate(locator);
  const entry = registry.agents[agentId];
  if (!entry) throw new Error(`Subagent registry entry not found: ${agentId}`);
  Object.assign(entry, update, { updatedAt: now });
  if (entry.status !== "interrupted") delete entry.interruptionReason;
  writeRegistry(locator, registry);
  return entry;
}

export function markRunningAgentsInterrupted(locator: RootRegistryLocator): number {
  const registry = loadOrCreate(locator);
  let changed = 0;
  const now = Date.now();
  for (const entry of Object.values(registry.agents)) {
    if (entry.status === "queued" || entry.status === "running") {
      entry.status = "interrupted";
      entry.interruptionReason = "pi_exit";
      entry.updatedAt = now;
      changed++;
    }
  }
  if (changed) writeRegistry(locator, registry);
  return changed;
}
