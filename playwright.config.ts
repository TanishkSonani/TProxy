import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"./e2e",
  fullyParallel:false,
  reporter:"list",
  use:{baseURL:"http://127.0.0.1:4143",channel:"chrome",headless:true,viewport:{width:1440,height:1100},trace:"retain-on-failure"},
  webServer:{command:"bun run build:ui && bun run vite preview --config dashboard/vite.config.ts --host 127.0.0.1 --port 4143 --strictPort",url:"http://127.0.0.1:4143",reuseExistingServer:false,timeout:30000}
});
