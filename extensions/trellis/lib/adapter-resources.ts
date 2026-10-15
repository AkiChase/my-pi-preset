import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { canonicalPath } from "./config.ts";
import { entryPath, presetRoot, resourceRoot, skillsPrefix } from "./paths.ts";

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

/** Rebase one package-relative filter pattern of this preset onto the Trellis resource root.
 * Paths under `extensions/trellis/` drop that prefix; other preset-relative paths stay outside
 * the resource root (they can never name a Trellis skill). Absolute, basename and leading-glob
 * patterns are root independent. Transitional: init deployment replaces conditional discovery.
 */
function rebasePattern(pattern: string): string {
	const marker = /^[!+-]/.test(pattern) ? pattern[0]! : "";
	const body = pattern.slice(marker.length).replace(/^\.\//, "");
	const nested = skillsPrefix.slice(0, -"skills".length);
	if (body.startsWith(nested)) return marker + body.slice(nested.length);
	if (isAbsolute(body) || body.startsWith("*") || !body.includes("/")) return marker + body;
	return `${marker}../../${body}`;
}

/** Discover this package's conditional skills through Pi's public filter resolver.
 * The preset manifest declares no skills, so the resolver runs against a virtual local
 * package rooted at the Trellis resource root, carrying the configured scope/filters of
 * this preset. Virtual settings never persist or install a missing source.
 */
export async function projectSkillPaths(cwd: string, projectTrusted: boolean, agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent")): Promise<string[]> {
	const actual = SettingsManager.create(cwd, agentDir, { projectTrusted });
	if (actual.drainErrors().length) throw new Error("Pi resource settings are unreadable or invalid");
	const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: actual });
	const own = manager.listConfiguredPackages().filter(entry => entry.installedPath && canonicalPath(entry.installedPath) === canonicalPath(presetRoot));
	// Local source strings are relative to their scope. An identical spelling in
	// the other scope may name a different package and must keep its defaults.
	const sources = new Set(own.map(entry => `${entry.scope}\0${entry.source}`));
	if (!sources.size) {
		return readdirSync(join(resourceRoot, "skills"), { withFileTypes: true })
			.filter(entry => entry.isDirectory())
			.map(entry => join(resourceRoot, "skills", entry.name, "SKILL.md"))
			.filter(path => existsSync(path));
	}
	const defaults = (settings: ReturnType<SettingsManager["getSettings"]>, scope: "user" | "project") => ({
		...settings,
		packages: (settings.packages ?? []).flatMap(entry => {
			const source = typeof entry === "string" ? entry : entry.source;
			if (!sources.has(`${scope}\0${source}`)) return [];
			if (typeof entry === "string") return [{ source: resourceRoot, skills: ["skills/**/SKILL.md"] }];
			const skills = entry.skills?.map(rebasePattern) ?? (entry.autoload === false ? undefined : ["skills/**/SKILL.md"]);
			return [{ source: resourceRoot, ...(entry.autoload === false ? { autoload: false } : {}), ...(skills ? { skills } : {}) }];
		}),
	});
	const global = defaults(actual.getGlobalSettings(), "user"), project = defaults(actual.getProjectSettings(), "project");
	const virtual = SettingsManager.fromStorage({ withLock(scope, fn) { fn(JSON.stringify(scope === "global" ? global : project)); } }, { projectTrusted });
	const resources = await new DefaultPackageManager({ cwd, agentDir, settingsManager: virtual }).resolve(async () => "skip");
	return resources.skills.filter(resource => resource.enabled && resource.metadata.packageRoot && canonicalPath(resource.metadata.packageRoot) === canonicalPath(resourceRoot)).map(resource => resource.path);
}
