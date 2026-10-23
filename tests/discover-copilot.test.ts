import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCopilot, discoveryArgs } from "../scripts/discover-copilot";

const temporary: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), "bridge-discovery-")); temporary.push(root); return root; }
function extension(root: string, name = "copilot-chat") {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ publisher: "GitHub", name, version: "1.2.3", main: "custom/main" }));
  return root;
}
const isolated = { defaults: false, env: {}, launchers: [] };
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("finds a renamed extension from manifest identity in an arbitrary custom directory", () => {
  const root = fixture();
  const path = extension(join(root, "extensions anywhere", ".uuid-renamed"));
  extension(join(root, "extensions anywhere", "github.copilot-chat-fake"), "other");
  const result = discoverCopilot({ ...isolated, paths: [join(root, "extensions anywhere")] });
  expect(result.map(item => item.path)).toEqual([path]);
  expect(result[0].main).toBe("custom/main");
});
test("discovers Windows versioned bundled installs and portable extensions", () => {
  const root = fixture();
  extension(join(root, "07f806f999", "resources/app/extensions/copilot"));
  extension(join(root, "data/extensions/custom"));
  expect(discoverCopilot({ ...isolated, vscodePaths: [root] })).toHaveLength(2);
});
test("discovers macOS application bundles and Linux application roots", () => {
  const root = fixture();
  extension(join(root, "Editor.app/Contents/Resources/app/extensions/copilot"));
  extension(join(root, "linux/resources/app/extensions/copilot"));
  expect(discoverCopilot({ ...isolated, vscodePaths: [join(root, "Editor.app"), join(root, "linux")] })).toHaveLength(2);
});
test("accepts environment overrides and deduplicates the same installation", () => {
  const path = extension(join(fixture(), "nonstandard"));
  const result = discoverCopilot({ ...isolated, paths: [path, path], env: { GHCP_COPILOT_PATH: path } });
  expect(result).toHaveLength(1);
});
test("ignores missing and malformed manifests without discarding valid candidates", () => {
  const root = fixture();
  mkdirSync(join(root, "broken")); writeFileSync(join(root, "broken/package.json"), "{");
  extension(join(root, "valid"));
  expect(discoverCopilot({ ...isolated, paths: [join(root, "missing"), root] })).toHaveLength(1);
});
test("discovers remote-host extension storage relative to the runtime home", () => {
  const home = fixture();
  extension(join(home, ".vscode-server-insiders/extensions/custom"));
  const result = discoverCopilot({ home, env: {}, launchers: [] });
  expect(result.some(item => item.path.includes(".vscode-server-insiders"))).toBe(true);
});
test("supports repeated path arguments and rejects missing or unknown arguments", () => {
  expect(discoveryArgs(["--extension-path", "one", "--extension-path", "two", "--vscode-path", "three"]))
    .toEqual({ paths: ["one", "two"], vscodePaths: ["three"] });
  expect(() => discoveryArgs(["--extension-path"])).toThrow();
  expect(() => discoveryArgs(["--unknown"])).toThrow();
});
