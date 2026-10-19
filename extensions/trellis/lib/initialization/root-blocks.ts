import { replaceBlock, template, type Fingerprint } from "./engine.ts";
import type { ProvenanceReader } from "./provenance-reader.ts";

/** Root files that carry one Trellis-owned block; content outside the markers belongs to the project. */
export const ROOT_BLOCKS = [
	{ path: "AGENTS.md", source: "agents-block.md", start: "<!-- TRELLIS:START -->", end: "<!-- TRELLIS:END -->" },
	{ path: ".gitignore", source: "root.gitignore-block.txt", start: "# pi-trellis:ignore:start", end: "# pi-trellis:ignore:end" },
] as const;

export type RootBlockState = "Current block" | "Block update" | "Missing block — will restore" | "Malformed block — preserved" | "Unreadable file — preserved";
/** States that are never rewritten; Update resources treats them as conflicts. */
export const PRESERVED_ROOT_BLOCK_STATES: readonly RootBlockState[] = ["Malformed block — preserved", "Unreadable file — preserved"];
export interface RootBlockReview {
	path: string;
	state: RootBlockState;
	/** Current file fingerprint; null when the file is absent. */
	before: Fingerprint | null;
	/** Full next file bytes for an update or restore; absent for current or malformed blocks. */
	next?: Buffer;
	/** Malformed-block or read-failure reason, reported as a preserved conflict. */
	reason?: string;
}

/**
 * Compare each root block with the current package template. The block is package-owned: any difference
 * (an older release or a local edit) is replaced by Update resources after a backup of the whole file.
 * Repeated, incomplete or stray markers, and symlinked/nonregular/oversized files, are never rewritten.
 * A read failure (symlink, nonregular, oversized, invalid text) is a preserved row instead of an exception, so
 * menu status, Check and Apply template still work; Update resources treats it as a conflict. Callers with
 * cooperative cancellation must recheck it after this returns. Package template damage still throws.
 */
export function reviewRootBlocks(readFile: (path: string) => (Fingerprint & { data: Buffer }) | undefined, reader?: ProvenanceReader): RootBlockReview[] {
	return ROOT_BLOCKS.map(({ path, source, start, end }) => {
		let actual: ReturnType<typeof readFile>;
		try { actual = readFile(path); }
		catch (error) { return { path, state: "Unreadable file — preserved", before: null, reason: error instanceof Error ? error.message : String(error) }; }
		const before = actual ? { sha256: actual.sha256, mode: actual.mode } : null;
		const block = template(source, reader);
		let next: Buffer;
		try { next = replaceBlock(actual?.data, block, start, end); }
		catch (error) { return { path, state: "Malformed block — preserved", before, reason: error instanceof Error ? error.message : String(error) }; }
		if (actual && next.equals(actual.data)) return { path, state: "Current block", before };
		const hasBlock = !!actual && actual.data.includes(start);
		return { path, state: hasBlock ? "Block update" : "Missing block — will restore", before, next };
	});
}
