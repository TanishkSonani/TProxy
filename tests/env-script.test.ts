import { expect, test } from "bun:test";
import { generateEnvScript } from "../src/client/env-script";
test("PowerShell and POSIX exports quote literal values and unset conflicting keys", () => {
  const values = {ANTHROPIC_API_KEY:undefined, ANTHROPIC_AUTH_TOKEN:"a'b $literal"};
  expect(generateEnvScript(values,"powershell")).toBe("Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue\n$env:ANTHROPIC_AUTH_TOKEN = 'a''b $literal'\nclaude");
  expect(generateEnvScript(values,"bash")).toBe("unset ANTHROPIC_API_KEY\nexport ANTHROPIC_AUTH_TOKEN='a'\\''b $literal'\nclaude");
});
test("unsafe variable names and CMD expansion are rejected", () => {
  expect(() => generateEnvScript({"X;exit":"bad"},"powershell")).toThrow();
  expect(() => generateEnvScript({KEY:"%PATH%"},"cmd")).toThrow();
  expect(() => generateEnvScript({KEY:"bad\0value"},"bash")).toThrow();
});
test("CMD clears an old API key and fish retains literal backslashes", () => {
  expect(generateEnvScript({ANTHROPIC_API_KEY:undefined,KEY:"safe-value"},"cmd"))
    .toBe('set "ANTHROPIC_API_KEY="\nset "KEY=safe-value"\nclaude');
  expect(generateEnvScript({KEY:"a\\b"},"fish")).toBe("set -gx KEY 'a\\\\b'\nclaude");
});
