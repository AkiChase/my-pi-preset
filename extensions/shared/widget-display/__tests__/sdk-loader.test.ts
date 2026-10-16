import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("actual host loader connects independent entry graphs in either order, isolates buses and retires subscriptions", () => {
    const directory = mkdtempSync(`${tmpdir()}/widget-sdk-`);
    try {
        const ownerPath = new URL("../../../widget-display.ts", import.meta.url).pathname;
        const clientPath = new URL("../client.ts", import.meta.url).pathname;
        const consumerPath = join(directory, "consumer.ts");
        writeFileSync(consumerPath, `import {createWidgetClient} from ${JSON.stringify(clientPath)};
export default pi => { const client=createWidgetClient(pi,"recap");
pi.events.on("fixture:publish", ({ctx,content,ack})=>ack(client.set(ctx,content)));
pi.events.on("fixture:facade", ack=>ack(pi.events)); };`);
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
            import assert from "node:assert/strict";
            import {createEventBus, SessionManager} from "@earendil-works/pi-coding-agent";
            const {createExtensionRuntime,loadExtensionFromFactory,loadExtensionsCached} = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
            for (const first of [true,false]) {
                const bus=createEventBus(), runtime=createExtensionRuntime();
                const paths=first?[${JSON.stringify(consumerPath)},${JSON.stringify(ownerPath)}]:[${JSON.stringify(ownerPath)},${JSON.stringify(consumerPath)}];
                const loaded=await loadExtensionsCached(paths,process.cwd(),bus,runtime);
                assert.deepEqual(loaded.errors,[]); assert.equal(loaded.runtime,runtime);
                let inlineAPI; const inline=await loadExtensionFromFactory(pi=>{inlineAPI=pi},process.cwd(),bus,runtime);
                assert.ok(inline.handlers); assert.equal(inline.extension,undefined);
                let facade; bus.emit("fixture:facade",v=>facade=v); assert.notEqual(facade,inlineAPI.events);
                const manager=SessionManager.inMemory(process.cwd());const widgets=new Map();
                const ctx={sessionManager:manager,hasUI:true,mode:"rpc",ui:{setWidget(k,v){if(v)widgets.set(k,v);else widgets.delete(k)}}};
                for(const ext of loaded.extensions)for(const h of ext.handlers.get("session_start")??[])await h({},ctx);
                let answer;bus.emit("fixture:publish",{ctx,content:["connected"],ack:v=>answer=v});
                assert.equal(answer,true);assert.deepEqual([...widgets.values()],[["connected"]]);
                const isolated=createEventBus(), isolatedRuntime=createExtensionRuntime();
                const other=await loadExtensionsCached([${JSON.stringify(consumerPath)}],process.cwd(),isolated,isolatedRuntime);
                assert.deepEqual(other.errors,[]);
                isolated.emit("fixture:publish",{ctx,content:["wrong bus"],ack:v=>answer=v});assert.equal(answer,false);
                for(const ext of loaded.extensions)for(const h of ext.handlers.get("session_shutdown")??[])await h({},ctx);
                assert.equal(widgets.size,0);
                bus.emit("fixture:publish",{ctx,content:["retired"],ack:v=>answer=v});assert.equal(answer,false);
                runtime.invalidate("fixture reload"); isolatedRuntime.invalidate("fixture reload");
                let heard=false;bus.emit("fixture:facade",()=>heard=true);assert.equal(heard,false);
                assert.throws(()=>inlineAPI.events.emit("fixture:facade",()=>{}),/fixture reload/);
                // Cached factories load a fresh activation with a fresh runtime, not a revived closed owner.
                const freshRuntime=createExtensionRuntime();const fresh=await loadExtensionsCached(paths,process.cwd(),bus,freshRuntime);
                assert.deepEqual(fresh.errors,[]);
                for(const ext of fresh.extensions)for(const h of ext.handlers.get("session_start")??[])await h({},ctx);
                bus.emit("fixture:publish",{ctx,content:["fresh"],ack:v=>answer=v});assert.equal(answer,true);
                assert.deepEqual([...widgets.values()],[["fresh"]]);
                for(const ext of fresh.extensions)for(const h of ext.handlers.get("session_shutdown")??[])await h({},ctx);
                freshRuntime.invalidate("fixture done");assert.equal(widgets.size,0);
            }
        `], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1" } });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); assert.equal(result.error, undefined);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
