import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalPath } from "./config.ts";
import { entryPath } from "./paths.ts";

/** Use Pi's real package identity, project precedence and delta filters. Missing sources never install. */
export async function adapterConfigured(sourceRoot: string): Promise<boolean> {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
	const settingsManager = SettingsManager.create(sourceRoot, agentDir, { projectTrusted: true });
	if (settingsManager.drainErrors().length) throw new Error("Pi resource settings are unreadable or invalid");
	const manager = new DefaultPackageManager({ cwd: sourceRoot, agentDir, settingsManager });
	const resources = await manager.resolve(async () => "skip");
	const adapter = canonicalPath(entryPath);
	return resources.extensions.some(resource => resource.enabled && canonicalPath(resource.path) === adapter && resource.metadata.scope !== "temporary");
}
