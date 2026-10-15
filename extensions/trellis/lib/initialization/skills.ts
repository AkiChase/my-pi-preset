import { skillFolder, skillFolderEntries, type Fingerprint, type SkillRecord } from "./engine.ts";

/** Row states shared by Update resources and Check so both report the same skill situation. */
export type SkillState =
	| "Current" | "Safe update" | "Update available" | "Missing — will restore" | "New — will install"
	| "Modified — preserved" | "Unrecorded file — preserved" | "Unmanaged folder — preserved";
export interface SkillReview {
	rows: { path: string; state: SkillState }[];
	/** Customized managed files, unrecorded files and unmanaged same-name folders; never overwritten. */
	conflicts: string[];
	/** Package files to publish, in publication order (supporting files before each SKILL.md). */
	changes: { path: string; record: SkillRecord; before: Fingerprint | null }[];
	/** Next last-published records; conflicts keep their prior record or stay unrecorded. */
	next: Record<string, SkillRecord>;
}
const equal = (a: Fingerprint | null | undefined, b: Fingerprint | null | undefined) => !!a && !!b && a.sha256 === b.sha256 && a.mode === b.mode;

/**
 * Classify deployed Trellis skills against recorded last-published rows and the package inventory.
 * A folder without recorded rows is adopted only when it holds nothing but exact package copies
 * (an interrupted publication); any other content preserves the whole folder as a conflict.
 * Skill state never affects runtime authority.
 */
export function reviewSkills(root: string, recorded: Record<string, SkillRecord>, expected: Record<string, SkillRecord>, stampOf: (path: string) => Fingerprint | null, options: { repair?: boolean } = {}): SkillReview {
	const review: SkillReview = { rows: [], conflicts: [], changes: [], next: {} };
	const folders = new Map<string, string[]>();
	for (const path of Object.keys(expected)) folders.set(skillFolder(path), [...folders.get(skillFolder(path)) ?? [], path]);
	for (const [folder, targets] of folders) {
		if (!targets.some(path => Object.hasOwn(recorded, path))) {
			const entries = skillFolderEntries(root, folder);
			if (entries && (entries.foreign.length || entries.files.some(path => !Object.hasOwn(expected, path) || !equal(stampOf(path), expected[path])))) {
				review.rows.push({ path: `${folder}/`, state: "Unmanaged folder — preserved" });
				review.conflicts.push(`${folder}/`);
				continue;
			}
			for (const path of targets) {
				const actual = entries ? stampOf(path) : null;
				review.next[path] = expected[path];
				if (actual) review.rows.push({ path, state: "Current" });
				else { review.rows.push({ path, state: "New — will install" }); review.changes.push({ path, record: expected[path], before: null }); }
			}
			continue;
		}
		for (const path of targets) {
			const want = expected[path], prior = recorded[path], actual = stampOf(path);
			if (equal(actual, want)) { review.rows.push({ path, state: "Current" }); review.next[path] = want; continue; }
			if (actual && !prior) { review.rows.push({ path, state: "Unrecorded file — preserved" }); review.conflicts.push(path); continue; }
			if (actual && !equal(actual, prior)) { review.rows.push({ path, state: "Modified — preserved" }); review.conflicts.push(path); review.next[path] = prior; continue; }
			if (actual && options.repair) { review.rows.push({ path, state: "Update available" }); review.next[path] = prior; continue; }
			review.rows.push({ path, state: actual ? "Safe update" : prior ? "Missing — will restore" : "New — will install" });
			review.changes.push({ path, record: want, before: actual });
			review.next[path] = want;
		}
	}
	return review;
}
