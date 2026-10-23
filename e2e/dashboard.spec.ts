import {test,expect} from "@playwright/test";

const secret="synthetic-local-secret-not-a-real-credential";
async function fixture(page:any) {
  const now=Date.now(),day=new Date().toLocaleDateString("en-CA");
  const requests=Array.from({length:8},(_,i)=>({id:"fixture-"+i,at:now-i*50000,model:i%2?"gpt-fixture":"copilot-auto",status:i===3?429:200,input:1200+i*100,output:230,tools:i%2,latency:1200+i*100,body:JSON.stringify({messages:[{role:"user",content:"[redacted: 20 chars]"}]})}));
  let settings={port:4141,retentionDays:90,requireApiKey:true,models:{default:"copilot-auto",sonnet:"copilot-auto",opus:"copilot-auto",haiku:"copilot-auto"}};
  const calls:{url:string;body:any}[]=[];
  await page.route("**/api/**",async(route:any)=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.slice(5);
    calls.push({url:request.url(),body:request.postDataJSON()});
    const result:any={
      status:{running:true,port:4141,uptimeMs:360000,contextWindowTokens:200000,context:{source:"model"},auth:{source:"vscode",login:"developer",plan:"individual",storage:"windows-vault",api:"https://api.individual.githubcopilot.com",expiresAt:now+3600000,refreshAt:now+3300000,quotaUpdatedAt:now,quota:{chat:{percent_remaining:68,has_quota:true},completions:{percent_remaining:98,has_quota:true},premium_interactions:{has_quota:false}}},limits:{"x-ratelimit-remaining":"99"},limitsObservedAt:now,metrics:{driver:"bun:sqlite",error:false}},
      summary:{totals:{requests:1248,input:3450000,output:127500,p50:1200,p95:3400,errorRate:.01,toolRatio:.6,tools:300,activeHours:14,cacheRead:1234,cacheWrite:222},days:30,daily:[{day,requests:180}],models:[{model:"copilot-auto",requests:1248,input:3450000,output:127500,errors:3}],availableModels:["copilot-auto","gpt-fixture"],sessions:{count:22,averageRequests:8,averageDurationMs:12000}},
      logs:{requests,events:[{id:1,at:now,ok:true}],limit:200},
      catalog:[{id:"gpt-fixture",name:"GPT Fixture",policy:{state:"enabled"}}],
      env:{script:'$env:ANTHROPIC_BASE_URL="http://localhost:4141"\n$env:ANTHROPIC_AUTH_TOKEN="'+secret+'"\n$env:ANTHROPIC_MODEL="copilot-auto"'},
      refresh:{ok:true}
    };
    if(path==="settings") {if(request.method()==="POST")settings=request.postDataJSON();await route.fulfill({json:settings});}
    else if(path in result)await route.fulfill({json:result[path]});
    else await route.fulfill({status:404,json:{error:{message:"Unexpected fixture path"}}});
  });
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Gateway overview"})).toBeVisible();
  return calls;
}
test("secret preview is masked, requires reveal, and copy is explicitly labeled",async({page,context})=>{
  await fixture(page);
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await page.getByText("Manual environment setup",{exact:false}).click();
  await expect(page.getByText("Contains a local secret",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Generate script",exact:true}).click();
  const preview=page.getByRole("textbox",{name:"Environment preview, local secret masked"});
  await expect(preview).toBeVisible();expect(await preview.inputValue()).not.toContain(secret);
  await page.getByRole("button",{name:"Reveal secret",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Environment script, local secret visible"})).toHaveValue(new RegExp(secret));
  await page.getByRole("button",{name:"Hide secret",exact:true}).click();expect(await preview.inputValue()).not.toContain(secret);
  await page.getByRole("button",{name:"Copy script + secret",exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(secret);
  expect(await preview.inputValue()).not.toContain(secret);
});
test("API-key protection needs confirmation and cancellation preserves protection",async({page})=>{
  const calls=await fixture(page);
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  const toggle=page.getByRole("switch",{name:"Require proxy API key"});
  await toggle.click();
  const dialog=page.getByRole("dialog",{name:"Disable the proxy API key?"});
  await expect(dialog).toBeVisible();await expect(toggle).toHaveAttribute("aria-checked","true");
  await page.getByRole("button",{name:"Keep protection"}).click();await expect(dialog).not.toBeVisible();await expect(toggle).toHaveAttribute("aria-checked","true");
  await toggle.click();await page.getByRole("button",{name:"Disable key requirement",exact:true}).click();
  await expect(toggle).toHaveAttribute("aria-checked","false");
  expect(calls.filter(c=>new URL(c.url).pathname==="/api/settings"&&c.body)).toHaveLength(0);
  await page.getByRole("button",{name:"Save changes"}).click();
  await expect.poll(()=>calls.filter(c=>new URL(c.url).pathname==="/api/settings"&&c.body).length).toBe(1);
  expect(calls.find(c=>new URL(c.url).pathname==="/api/settings"&&c.body)?.body.requireApiKey).toBe(false);
});
test("filters reach API; live log pauses and resumes without exposing content",async({page})=>{
  const calls=await fixture(page);
  await page.getByRole("button",{name:"Usage",exact:true}).click();
  await page.getByLabel("Date range",{exact:true}).selectOption("7");
  await page.getByLabel("Filter by model",{exact:true}).selectOption("gpt-fixture");
  await page.getByLabel("Filter by status",{exact:true}).selectOption("error");
  await expect.poll(()=>calls.some(c=>c.url.includes("/api/summary?")&&c.url.includes("model=gpt-fixture")&&c.url.includes("status=error"))).toBe(true);
  await page.getByRole("button",{name:"Live log",exact:true}).click();
  await page.getByRole("button",{name:"Pause",exact:true}).click();
  await expect(page.getByLabel("Date range",{exact:true})).toBeDisabled();
  const pausedCalls=calls.filter(c=>c.url.includes("/api/logs")).length;
  await page.waitForTimeout(4500);
  expect(calls.filter(c=>c.url.includes("/api/logs")).length).toBe(pausedCalls);
  await page.getByRole("button",{name:"Resume",exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.url.includes("/api/logs")).length).toBeGreaterThan(pausedCalls);
  await page.locator("details.request").first().locator("summary").click();
  await expect(page.locator("details.request").first().locator("pre")).toBeVisible();
  await expect(page.locator("details.request").first().locator("pre")).toContainText("[redacted: 20 chars]");
});
test("charts have descriptions and daily tables; overview and mobile layouts fit",async({page},testInfo)=>{
  const consoleErrors:string[]=[];page.on("pageerror",e=>consoleErrors.push(e.message));
  await fixture(page);
  const nav=page.getByRole("navigation",{name:"Main navigation"});await expect(nav.getByRole("button",{name:"Overview",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page.getByRole("img",{name:/Daily request activity/})).toBeVisible();
  await page.getByText("View daily data",{exact:true}).first().click();
  await expect(page.getByRole("table",{name:"Exact local dates and request counts for this chart"})).toBeVisible();
  await page.getByText("View daily data",{exact:true}).first().click();
  await page.screenshot({path:testInfo.outputPath("overview-desktop.png"),fullPage:true,animations:"disabled"});
  for(const name of ["Usage","Live log","Limits","Settings"]){await nav.getByRole("button",{name,exact:true}).click();await page.screenshot({path:testInfo.outputPath(name.replace(" ","-").toLowerCase()+"-desktop.png"),fullPage:true,animations:"disabled"});}
  await expect(page.getByRole("switch",{name:"Require proxy API key"})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  for(const name of ["Overview","Usage","Live log","Limits","Settings"]){
    await nav.getByRole("button",{name,exact:true}).click();
    const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    await page.screenshot({path:testInfo.outputPath(name.replace(" ","-").toLowerCase()+"-mobile.png"),fullPage:true,animations:"disabled"});
  }
  expect(consoleErrors).toEqual([]);
});
test("activity map uses compact fixed cells across date ranges and viewport sizes",async({page},testInfo)=>{
  await fixture(page);
  await page.getByRole("button",{name:"Usage",exact:true}).click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    for(const days of ["7","30","90"]){
      await page.getByLabel("Date range",{exact:true}).selectOption(days);
      const map=page.locator(".heatmap"),cell=map.locator(".heat").first();
      await expect(cell).toHaveCSS("width","12px");await expect(cell).toHaveCSS("height","12px");
      await expect(map).toHaveCSS("height","108px");
      expect((await map.boundingBox())!.width).toBeLessThanOrEqual(236);
      await expect(map.locator(".heat")).toHaveCount(Number(days));
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator(".panel").filter({has:page.getByRole("heading",{name:"Activity map",exact:true})}).screenshot({path:testInfo.outputPath("compact-activity-map.png")});
});
