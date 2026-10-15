import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { isUtf8 } from "node:buffer";

export const PROCESS_LIMITS = Object.freeze({ stream: 256 * 1024, stdin: 8 * 1024 * 1024, cleanup: 2000 });
export type ProcessState = "complete" | "spawn" | "exit" | "timeout" | "output-limit" | "input-limit" | "aborted" | "pipe" | "cleanup-unconfirmed" | "unsupported";
export interface ProcessResult { state: ProcessState; stdout: Buffer; stderr: Buffer; exitCode: number | null; pid?: number; ownedPidGone: boolean }
/** Diagnostic-only environment; never edits the shared host environment. */
export function diagnosticEnvironment(developer?: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "LC_CTYPE", "COMSPEC", "PATHEXT"]) if (inherited[key] !== undefined) env[key] = inherited[key];
	env.GIT_OPTIONAL_LOCKS = "0";
	if (developer !== undefined) env.TRELLIS_DEVELOPER = developer;
	return env;
}
/** Internal fixed-argv transport, not a shell or dynamic request/response execution tool.
 * Terminal delivery waits for close AND proof the directly owned PID is gone.
 * POSIX groups bound inherited-pipe cleanup; escaped adversarial descendants are not sandboxed.
 */
export async function runDiagnosticProcess(options: { executable: string; argv: string[]; cwd: string; env: NodeJS.ProcessEnv; input?: Buffer; deadline: number; timeout: number; signal?: AbortSignal }): Promise<ProcessResult> {
	const empty = (state: ProcessState): ProcessResult => ({ state, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: null, ownedPidGone: true });
	if (process.platform === "win32") return empty("unsupported");
	if (options.signal?.aborted) return empty("aborted");
	if ((options.input?.length ?? 0) > PROCESS_LIMITS.stdin) return empty("input-limit");
	const duration = Math.min(options.timeout, options.deadline - performance.now());
	if (duration <= 0) return empty("timeout");
	return new Promise(resolve => {
		let child: ChildProcessByStdio<Writable, Readable, Readable>;
		try { child = spawn(options.executable, options.argv, { cwd: options.cwd, env: options.env, shell: false, detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
		catch { resolve(empty("spawn")); return; }
		let state: ProcessState = "complete", closed = false, settled = false, terminating = false, exitCode: number | null = null;
		const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }, sizes = { stdout: 0, stderr: 0 };
		let grace: ReturnType<typeof setTimeout> | undefined, cleanup: ReturnType<typeof setTimeout> | undefined;
		const gone = () => {
			if (!child.pid) return true;
			try { process.kill(child.pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
		};
		const kill = (signal: NodeJS.Signals) => {
			if (!child.pid) return;
			try { process.kill(-child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") { try { child.kill(signal); } catch { /* no proof of cleanup from a kill request */ } } }
		};
		const finish = (confirmed: boolean) => {
			if (settled) return;
			settled = true; clearTimeout(timer); if (grace) clearTimeout(grace); if (cleanup) clearTimeout(cleanup);
			options.signal?.removeEventListener("abort", abort);
			child.removeListener("error", error); child.removeListener("exit", exit); child.removeListener("close", close);
			child.stdout.removeListener("data", stdout); child.stderr.removeListener("data", stderr); child.stdin.removeListener("error", pipe);
			child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
			// Streams may emit a late error after destruction; detached no-op listener owns it, not this run.
			child.stdin.on("error", ignore); child.stdout.on("error", ignore); child.stderr.on("error", ignore); child.on("error", ignore);
			resolve({ state: confirmed ? state : "cleanup-unconfirmed", stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr), exitCode, pid: child.pid, ownedPidGone: confirmed });
		};
		const terminate = (reason: ProcessState) => {
			if (settled || terminating) return;
			terminating = true; state = reason; kill("SIGTERM");
			grace = setTimeout(() => kill("SIGKILL"), 150);
			cleanup = setTimeout(() => { kill("SIGKILL"); finish(closed && gone()); }, PROCESS_LIMITS.cleanup - 100);
		};
		const consume = (name: "stdout" | "stderr", data: Buffer) => {
			if (settled || terminating) return;
			sizes[name] += data.length;
			if (sizes[name] > PROCESS_LIMITS.stream) { terminate("output-limit"); return; }
			chunks[name].push(Buffer.from(data));
		};
		const stdout = (data: Buffer) => consume("stdout", data), stderr = (data: Buffer) => consume("stderr", data);
		const error = () => terminate("spawn"), pipe = () => terminate("pipe"), abort = () => terminate("aborted");
		const exit = (code: number | null) => { exitCode = code; if (code !== 0 && !terminating) state = "exit"; };
		const close = () => { closed = true; if (gone()) { if (terminating) kill("SIGKILL"); finish(true); } else terminate("cleanup-unconfirmed"); };
		const ignore = () => {};
		const timer = setTimeout(() => terminate("timeout"), duration);
		child.on("error", error); child.on("exit", exit); child.on("close", close);
		child.stdout.on("data", stdout); child.stderr.on("data", stderr); child.stdin.on("error", pipe);
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
		if (!terminating) child.stdin.end(options.input ?? Buffer.alloc(0));
	});
}
export function diagnosticJSON(result: ProcessResult): unknown {
	if (result.state !== "complete" || !result.ownedPidGone || result.exitCode !== 0) throw Error(`Diagnostic process ${result.state}`);
	if (!isUtf8(result.stdout) || result.stdout.includes(0)) throw Error("Invalid diagnostic UTF-8 response");
	try { return JSON.parse(result.stdout.toString("utf8")); } catch { throw Error("Invalid diagnostic JSON response"); }
}
