import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Trellis resource root (`extensions/trellis/`): runtime, templates, roles, skills, baselines and protocol. */
export const resourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
/** Installed Pi package root (this preset); owns package identity and settings filters. */
export const presetRoot = dirname(dirname(resourceRoot));
/** The only Trellis entry the host loads from this package manifest. */
export const entryPath = join(presetRoot, "extensions/trellis.ts");
/** Package-relative prefix of the skill source tree, as seen by settings filters on this package. */
export const skillsPrefix = "extensions/trellis/skills";
