import { isUtf8 } from "node:buffer";
import type { Fingerprint } from "./engine.ts";

/** Default initialization and diagnostics use the same provenance policy, with different I/O owners. */
export interface ProvenanceReader {
	/** `binary` skips text validation (skill assets only); size/hash/mode remain checked. */
	file(root: string, path: string, limit?: number, inventory?: boolean, binary?: boolean): (Fingerprint & { data: Buffer; bytes: number; text?: string }) | undefined;
	json(root: string, path: string, limit?: number): unknown;
	stat(root: string, path: string): { mode: number } | undefined;
	path(root: string, path: string): string;
}
export function provenanceText(data: Buffer): string {
	if (!isUtf8(data) || data.includes(0)) throw Error("Invalid UTF-8 or NUL bytes");
	return data.toString("utf8");
}
