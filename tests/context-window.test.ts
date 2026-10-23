import {expect,test} from "bun:test";
import {clientContextWindow} from "../src/client/context-window";
import {claudeEnvironment} from "../src/client/claude-launch";
const model=(id:string,context:number,prompt:number,picker=false)=>({id,model_picker_enabled:picker,capabilities:{limits:{max_context_window_tokens:context,max_prompt_tokens:prompt}}});
test("Auto defaults to a 200k ceiling without assuming catalog advertisements are entitled Auto selections",()=>{
  expect(clientContextWindow([model("hidden",16384,12288)],{default:"copilot-auto"})).toBe(200000);
  expect(clientContextWindow([],{default:"copilot-auto"},128000)).toBe(128000);
});
test("configured slots and selectable models lower the ceiling to the smaller total or prompt limit",()=>{
  expect(clientContextWindow([model("large",1000000,872000),model("small",200000,128000)],{default:"large",haiku:"small"})).toBe(128000);
  expect(clientContextWindow([model("picker",128000,64000,true)],{default:"copilot-auto"})).toBe(64000);
  expect(clientContextWindow([{...model("disabled",16000,12000,true),policy:{state:"disabled"}}],{default:"copilot-auto"})).toBe(200000);
});
test("observed Auto selections lower future launcher windows and invalid provider metadata never raises a limit",()=>{
  const autos=function*(){yield model("selected",128000,64000);};
  expect(clientContextWindow([],{default:"copilot-auto"},200000,autos())).toBe(64000);
  expect(clientContextWindow([{id:"bad",capabilities:{limits:{max_context_window_tokens:NaN,max_prompt_tokens:-1}}}],{default:"bad"})).toBe(200000);
  for(const n of [NaN,0,999,1000001])expect(()=>clientContextWindow([],{},n)).toThrow();
});
test("launcher overrides inherited 1M/disabled compaction flags with truthful window settings",()=>{
  const env=claudeEnvironment({port:4141,key:"fixture",model:"copilot-auto",smallModel:"copilot-auto",contextWindowTokens:128000},{CLAUDE_CODE_MAX_CONTEXT_TOKENS:"1000000",CLAUDE_CODE_AUTO_COMPACT_WINDOW:"1000000",DISABLE_COMPACT:"1",DISABLE_AUTO_COMPACT:"1",CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT:"1"});
  expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("128000");expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("128000");expect(env.CLAUDE_CODE_DISABLE_1M_CONTEXT).toBe("1");expect(env.DISABLE_COMPACT).toBe("");expect(env.DISABLE_AUTO_COMPACT).toBe("");expect(env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT).toBe("");
  expect(claudeEnvironment({port:4141,key:"fixture",model:"copilot-auto",smallModel:"copilot-auto"},{}).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("200000");
});
