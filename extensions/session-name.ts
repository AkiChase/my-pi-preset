import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSessionName from "./session-assist/session-name/index.ts";

export default function sessionName(pi: ExtensionAPI): void {
    registerSessionName(pi);
}
