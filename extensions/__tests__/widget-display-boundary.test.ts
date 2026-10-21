import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const owner = "extensions/shared/widget-display/owner.ts";

it("only the shared widget owner may reference the host setter in production expressions", () => {
    const violations: string[] = [];
    for (const file of globSync("extensions/**/*.ts", { cwd: root })) {
        if (file.includes("/__tests__/") || file === owner) continue;
        const source = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);
        function visit(node: ts.Node): void {
            // Includes optional calls and aliases/destructuring; type-only SDK slices are allowed.
            if (ts.isTypeNode(node)) return;
            const setter = (ts.isPropertyAccessExpression(node) && ["setWidget", "setFooter"].includes(node.name.text)) ||
                (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && ["setWidget", "setFooter"].includes(node.argumentExpression.text)) ||
                (ts.isBindingElement(node) && ["setWidget", "setFooter"].includes((node.propertyName ?? node.name).getText(source).replaceAll(/["']/g, "")));
            if (setter) violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
    assert.deepEqual(violations, [], "host widget publication and setter aliases belong only to the shared owner");
});

it("the shared widget owner is loaded once through its dedicated top-level entry", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).pi;
    const entries: string[] = manifest.extensions.flatMap((entry: string) => entry.includes("*") ? globSync(entry, { cwd: root }) : [entry]);
    assert.equal(entries.filter(entry => entry === "extensions/widget-display.ts").length, 1);
    assert.equal(entries.some(entry => entry.startsWith("extensions/shared/widget-display/")), false);
    const imports = globSync("extensions/**/*.ts", { cwd: root }).filter(file => !file.includes("/__tests__/"))
        .filter(file => /(?:from\s*|import\s*\()["'][^"']*widget-display\/owner\.ts["']/.test(readFileSync(resolve(root, file), "utf8")));
    assert.deepEqual(imports, ["extensions/widget-display.ts"]);
});
