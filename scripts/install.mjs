#!/usr/bin/env node
// Interactive installer. Reconciliation remains owned by sync.mjs.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";

export const DOMAINS = [
  { id: "packages", name: "Packages", detail: "User-installed Pi packages. Project packages are untouched." },
  { id: "settings", name: "Settings", detail: "Preset entries in settings.json. Pi-owned keys stay protected." },
  { id: "keybindings", name: "Keybindings", detail: "Preset shortcuts in keybindings.json." },
  { id: "files", name: "Config files", detail: "Only extension JSON files declared by the preset." },
  { id: "extensions", name: "Extensions", detail: "Direct Pi entries in the user extensions directory." },
];

export function localCheckout(scriptPath) {
  try {
    const root = resolve(dirname(realpathSync(scriptPath)), "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.name !== "my-pi-preset" || !pkg.pi?.extensions?.includes("extensions/*.ts") ||
        !existsSync(join(root, ".git")) || !statSync(join(root, "extensions")).isDirectory() ||
        !statSync(join(root, "install.sh")).isFile() || !statSync(join(root, "pi-preset.json")).isFile()) return undefined;
    return root;
  } catch {
    return undefined;
  }
}

export function createState(checkout) {
  return {
    page: "source", cursor: 0, selected: new Set(DOMAINS.map(({ id }) => id)), cleanup: new Set(),
    dev: false, checkout, notice: "", plan: [], scroll: 0,
  };
}

export function syncArgs(state, manifest) {
  const selected = DOMAINS.filter(({ id }) => state.selected.has(id)).map(({ id }) => id);
  const cleanup = DOMAINS.filter(({ id }) => state.selected.has(id) && state.cleanup.has(id)).map(({ id }) => id);
  if (!selected.length) throw new Error("Select at least one area to continue.");
  if (state.dev && !state.checkout) throw new Error("Local source requires an independent checkout.");
  return ["--manifest", manifest, "--sync", selected.join(","), "--prune", cleanup.join(",") || "none", ...(state.dev ? ["--dev"] : [])];
}

function listFor(state) {
  return state.page === "cleanup" ? DOMAINS.filter(({ id }) => state.selected.has(id)) : DOMAINS;
}

// Returns an effect to the terminal/process owner; no I/O happens in this reducer.
export function handleKey(state, text, key = {}) {
  if (key.ctrl && key.name === "c") return "quit";
  if (key.name === "q") return "quit";
  state.notice = "";
  if (state.page === "loading") return key.name === "escape" ? "cancel-preview" : undefined;
  if (state.page === "review" || state.page === "error") {
    if (key.name === "escape") { state.page = "cleanup"; state.cursor = 0; state.plan = []; }
    else if (key.name === "up") state.scroll = Math.max(0, state.scroll - 1);
    else if (key.name === "down") state.scroll += 1;
    else if (key.name === "pageup") state.scroll = Math.max(0, state.scroll - 10);
    else if (key.name === "pagedown") state.scroll += 10;
    else if (key.name === "home") state.scroll = 0;
    else if (key.name === "end") state.scroll = Number.MAX_SAFE_INTEGER;
    else if (key.name === "return" && state.page === "review") return "apply";
    return;
  }
  if (state.page === "source") {
    if (["up", "down", "space"].includes(key.name)) state.cursor = 1 - state.cursor;
    else if (key.name === "return") {
      if (state.cursor === 1 && !state.checkout) state.notice = "Unavailable here. Run ./install.sh in an independent checkout.";
      else { state.dev = state.cursor === 1; state.page = "sync"; state.cursor = 0; }
    }
    return;
  }
  const list = listFor(state);
  const checked = state.page === "cleanup" ? state.cleanup : state.selected;
  if (key.name === "up" && list.length) state.cursor = (state.cursor + list.length - 1) % list.length;
  else if (key.name === "down" && list.length) state.cursor = (state.cursor + 1) % list.length;
  else if (key.name === "space" && list[state.cursor]) {
    const id = list[state.cursor].id;
    if (checked.has(id)) checked.delete(id);
    else checked.add(id);
  } else if (key.name === "a") {
    const all = list.every(({ id }) => checked.has(id));
    for (const { id } of list) {
      if (all) checked.delete(id);
      else checked.add(id);
    }
  } else if (key.name === "escape") {
    state.page = state.page === "cleanup" ? "sync" : "source";
    state.cursor = 0;
  } else if (key.name === "return") {
    if (!state.selected.size) state.notice = "Select at least one area to continue.";
    else if (state.page === "sync") { state.page = "cleanup"; state.cursor = 0; }
    else { state.page = "loading"; state.scroll = 0; return "preview"; }
  }
  for (const id of state.cleanup) if (!state.selected.has(id)) state.cleanup.delete(id);
}

export function cleanText(text) {
  // Remove terminal controls before wrapping or styling external plan output.
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

function wrap(text, width) {
  const result = [];
  for (const raw of cleanText(text).replace(/\t/g, "    ").split("\n")) {
    // Keep the reserved pointer column and aligned labels intact.
    if (raw.length <= width) { result.push(raw); continue; }
    let remaining = raw;
    while (remaining.length > width) {
      const space = remaining.lastIndexOf(" ", width);
      const end = space > width / 2 ? space : width;
      result.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    result.push(remaining);
  }
  return result;
}

export function renderFrame(state, { columns = 80, rows = 24, color = false, unicode = true } = {}) {
  if (columns < 35 || rows < 20) return "\n  Terminal too small.\n  Resize to at least 35 x 20.\n  Q / Ctrl+C Quit";
  const width = Math.max(8, columns - 4);
  const styles = { muted: "2;37", accent: "36", good: "32", danger: "33", title: "1", focus: "1;36" };
  const paint = (text, kind) => color && kind ? `\x1b[${styles[kind]}m${text}\x1b[0m` : text;
  const symbols = unicode ? { focus: "›", on: "◉", off: "○" } : { focus: ">", on: "[x]", off: "[ ]" };
  const lines = [];
  const add = (text = "", kind) => { for (const line of wrap(text, width)) lines.push(`  ${paint(line, kind)}`); };
  const steps = { source: "SOURCE", sync: "01 / 03", cleanup: "02 / 03", loading: "03 / 03", review: "03 / 03", error: "PREVIEW FAILED" };
  const footer = [];
  add();
  add(`pi preset    ${steps[state.page]}`, "accent");
  add();
  if (state.page === "source") {
    add("Choose your preset source", "title");
    add("Third-party packages keep their declared remote sources.", "muted");
    add();
    ["Remote preset (default)", `Local checkout${state.checkout ? "" : " (unavailable)"}`].forEach((name, i) => {
      add(`${i === state.cursor ? symbols.focus : " "} ${i === state.cursor ? symbols.on : symbols.off} ${name}`, i === state.cursor ? "focus" : "muted");
    });
    add();
    add(state.checkout ? `Local: ${state.checkout}` : "Local source requires running ./install.sh from a checkout.", "muted");
    add("Local Packages: pnpm install runs before Pi synchronization.", "muted");
    footer.push("Up/Down Move   Enter Next   Q Quit");
  } else if (state.page === "sync" || state.page === "cleanup") {
    const pruning = state.page === "cleanup";
    const list = listFor(state);
    const checked = pruning ? state.cleanup : state.selected;
    add(pruning ? "Choose what to clean up" : "Choose what to sync", "title");
    add(pruning ? "Optional. Unchecked areas use Merge." : "All areas selected by default. Uncheck to leave untouched.", "muted");
    add();
    list.forEach((domain, i) => {
      const active = i === state.cursor;
      add(`${active ? symbols.focus : " "} ${checked.has(domain.id) ? symbols.on : symbols.off} ${domain.name}${pruning && checked.has(domain.id) ? "  Prune" : ""}`, active ? "focus" : pruning && checked.has(domain.id) ? "danger" : undefined);
    });
    add();
    add(list[state.cursor]?.detail ?? "No areas selected.", "muted");
    if (pruning) {
      add("Prune can remove undeclared local entries.", "danger");
      add("Merge can also remove preset conflicts or declared null values.", "muted");
    } else add(`${state.selected.size} of ${DOMAINS.length} selected`, "muted");
    footer.push("Up/Down Move   Space Toggle   A All/None", `Enter ${pruning ? "Review" : "Next"}   Esc Back   Q Quit`);
  } else if (state.page === "loading") {
    add("Reading your current Pi state", "title");
    add("Generating the real dry-run plan. No changes are being applied.", "muted");
    footer.push("Esc Back   Q Quit");
  } else {
    add(state.page === "error" ? "Unable to preview changes" : "Review your setup", "title");
    add(`Source: ${state.dev ? "local checkout" : "remote preset"}`, "muted");
    if (state.dev && state.selected.has("packages")) add("First: pnpm install in the local checkout.", "danger");
    for (const domain of DOMAINS) {
      const mode = !state.selected.has(domain.id) ? "Skip" : state.cleanup.has(domain.id) ? "Prune" : "Merge";
      add(`${domain.name.padEnd(17)} ${mode}`, mode === "Prune" ? "danger" : mode === "Skip" ? "muted" : "good");
    }
    add();
    add("Actual dry-run plan", "title");
    const planLines = state.plan.flatMap((line) => wrap(line, width));
    const footerText = ["Up/Down/PgUp/PgDn Scroll", `${state.page === "review" ? "Enter Apply   " : ""}Esc Back   Q Quit`];
    const reserve = 1 + footerText.reduce((count, text) => count + wrap(text, width).length, 0) +
      (state.notice ? wrap(state.notice, width).length : 0) + 1;
    const count = Math.max(0, rows - 1 - lines.length - reserve);
    state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, planLines.length - count)));
    for (const line of planLines.slice(state.scroll, state.scroll + count)) add(line);
    add(`${planLines.length && count ? state.scroll + 1 : 0}-${Math.min(planLines.length, state.scroll + count)} of ${planLines.length} lines`, "muted");
    footer.push(...footerText);
  }
  if (state.notice) footer.unshift(state.notice);
  const footLines = footer.flatMap((line) => wrap(line, width).map((part) => `  ${paint(part, "muted")}`));
  const height = Math.max(4, rows - 1);
  const body = lines.slice(0, Math.max(1, height - footLines.length - 1));
  return [...body, "", ...footLines].slice(0, height).join("\n");
}

// Each sync child owns a process group on POSIX: cancellation covers pi and its
// descendants, not just the Node sync wrapper (which uses spawnSync internally).
export function runSync(script, args, { preview = false, onStart, maxBytes = 1024 * 1024, timeoutMs = 12 * 60 * 1000, env = process.env, command, cwd } = {}) {
  const grouped = process.platform !== "win32";
  const child = spawn(command ?? process.execPath, command ? args : [script, ...args, ...(preview ? ["--dry-run"] : [])], {
    env, cwd, detached: grouped, stdio: preview ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let reason;
  let bytes = 0;
  const chunks = [];
  let killTimer;
  let deadline;
  const signal = (name) => {
    try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); }
    catch (error) { if (error.code !== "ESRCH") reason ??= error.message; }
  };
  const cancel = (message = "Cancelled") => {
    if (reason) return;
    reason = message;
    signal("SIGTERM");
    killTimer = setTimeout(() => signal("SIGKILL"), 1000);
  };
  const done = new Promise((resolveDone) => {
    child.on("error", (error) => { reason ??= error.message; });
    if (preview) {
      const collect = (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { cancel("Preview exceeds the 1 MiB display limit. Narrow the sync selection."); return; }
        chunks.push(chunk);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      deadline = setTimeout(() => cancel("Preview timed out."), timeoutMs);
    }
    child.on("close", (code, exitSignal) => {
      clearTimeout(deadline);
      // Still kill a non-cooperative descendant if the group leader exited first.
      if (reason && grouped) signal("SIGKILL");
      clearTimeout(killTimer);
      resolveDone({ code: code ?? 1, signal: exitSignal, error: reason, output: cleanText(Buffer.concat(chunks).toString("utf8")) });
    });
  });
  onStart?.({ child, cancel, done });
  return done;
}

export async function runInstaller({ manifest, script, input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Interactive installation needs a terminal. Run ./install.sh or curl | sh in an interactive shell.");
  }
  const state = createState(localCheckout(script));
  let active;
  let quitting = false;
  let terminal = false;
  let busy = false;
  let resolveFinished;
  const finished = new Promise((resolveDone) => { resolveFinished = resolveDone; });
  const render = () => {
    if (terminal && !quitting) output.write(`\x1b[H\x1b[2J${renderFrame(state, {
      columns: output.columns, rows: output.rows,
      color: process.env.NO_COLOR === undefined && process.env.TERM !== "dumb",
      unicode: process.env.NO_UNICODE === undefined && process.env.TERM !== "dumb",
    })}`);
  };
  const leaveTerminal = () => {
    if (!terminal) return;
    terminal = false;
    input.setRawMode(false);
    output.write("\x1b[?25h\x1b[?1049l");
  };
  const quit = () => {
    if (quitting) return;
    quitting = true;
    leaveTerminal();
    if (active) active.cancel();
    else resolveFinished(0);
  };
  const onKey = async (text, key) => {
    if (quitting) return;
    if (busy && state.page !== "loading") {
      if (key?.ctrl && key.name === "c" || key?.name === "q") quit();
      return;
    }
    if (terminal && ((output.columns ?? 80) < 35 || (output.rows ?? 24) < 20)) {
      if (key?.name === "q" || key?.ctrl && key.name === "c") quit();
      return;
    }
    const effect = handleKey(state, text, key);
    if (effect === "quit") { quit(); return; }
    if (effect === "cancel-preview") {
      state.page = "cleanup"; state.cursor = 0;
      active?.cancel();
      render();
      return;
    }
    if (!effect) { render(); return; }
    busy = true;
    const args = syncArgs(state, manifest);
    const applying = effect === "apply";
    if (applying) {
      leaveTerminal();
      // The sync process (and any package prompt) now exclusively owns stdin.
      input.off("keypress", safeKey);
      input.pause();
    } else render();
    if (applying && state.dev && state.selected.has("packages")) {
      output.write(`Installing local dependencies in ${state.checkout}: pnpm install\n`);
      const dependencies = await runSync(undefined, ["install"], {
        command: "pnpm", cwd: state.checkout, onStart: (job) => { active = job; },
      });
      active = undefined;
      if (quitting) { resolveFinished(130); return; }
      if (dependencies.error || dependencies.code !== 0) {
        output.write(`\nLocal dependency installation failed: ${dependencies.error ?? `pnpm exited with ${dependencies.code}`}. Pi synchronization was not started.\n`);
        resolveFinished(dependencies.error ? 1 : dependencies.code);
        return;
      }
    }
    const result = await runSync(script, args, { preview: !applying, onStart: (job) => { active = job; } });
    active = undefined;
    busy = false;
    if (quitting) { resolveFinished(130); return; }
    if (applying) {
      if (result.error || result.code !== 0) output.write(`\nInstallation failed: ${result.error ?? `sync exited with ${result.code}${result.signal ? ` (${result.signal})` : ""}`}.\n`);
      else output.write("\nSetup complete. Run /reload in Pi, or restart it.\n");
      resolveFinished(result.error ? 1 : result.code);
      return;
    }
    if (state.page !== "loading") { render(); return; }
    state.plan = result.output.split(/\r?\n/);
    state.page = result.error || result.code !== 0 ? "error" : "review";
    state.notice = result.error ?? (result.code !== 0 ? `Preview failed (exit ${result.code}). No changes applied.` : "");
    render();
  };
  const safeKey = (text, key) => { onKey(text, key).catch(async (error) => {
    leaveTerminal();
    output.write(`\nInstaller error: ${cleanText(error.message)}\n`);
    quitting = true;
    if (active) {
      active.cancel();
      await active.done;
    }
    resolveFinished(1);
  }); };
  try {
    emitKeypressEvents(input, { escapeCodeTimeout: 100 });
    input.setRawMode(true);
    terminal = true;
    input.on("keypress", safeKey);
    output.on("resize", render);
    process.on("SIGINT", quit);
    process.on("SIGTERM", quit);
    output.write("\x1b[?1049h\x1b[?25l");
    render();
    return await finished;
  } finally {
    leaveTerminal();
    input.off("keypress", safeKey);
    output.off("resize", render);
    process.off("SIGINT", quit);
    process.off("SIGTERM", quit);
    input.pause();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { manifest: { type: "string" } } });
  const script = join(dirname(fileURLToPath(import.meta.url)), "sync.mjs");
  const manifest = values.manifest ? resolve(values.manifest) : join(dirname(script), "..", "pi-preset.json");
  return runInstaller({ manifest, script });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`Installer error: ${cleanText(error.message)}`);
    process.exitCode = 1;
  });
}
