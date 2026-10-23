export const DEFAULT_CONTEXT_WINDOW=200000; // Missing-metadata fallback only, never a discovered-model cap.
const valid=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=1000;
type ContextEntry={model:string;tokens:number;source:"copilot"|"fallback";totalTokens?:number;promptTokens?:number;outputTokens?:number};
export function modelContext(model:any){
  const limits=model?.capabilities?.limits??{};
  const bounds=[limits.max_context_window_tokens,limits.max_prompt_tokens].filter(valid);
  return bounds.length?{model:model.id,tokens:Math.min(...bounds),source:"copilot" as const,totalTokens:limits.max_context_window_tokens,promptTokens:limits.max_prompt_tokens,outputTokens:limits.max_output_tokens}:null;
}
export function contextPolicy(models:Iterable<any>,mapping:Record<string,string>,ceiling?:number,autoModels:Iterable<any>=[],fallback=DEFAULT_CONTEXT_WINDOW){
  if(ceiling!==undefined&&(!valid(ceiling)||ceiling>1000000))throw new Error("Context window ceiling must be between 1000 and 1000000 tokens");
  if(!valid(fallback)||fallback>1000000)throw new Error("Invalid context fallback");
  const catalog=new Map([...models].map(m=>[m.id,m])),observed=[...autoModels].filter(m=>m.policy?.state!=="disabled");
  const entries=[...new Set(Object.values(mapping))].flatMap<ContextEntry>(id=>{
    const candidates=id==="copilot-auto"?observed:[catalog.get(id)].filter(Boolean);
    const found=candidates.filter(m=>m.policy?.state!=="disabled").map(m=>{const live=modelContext(m),listed=modelContext(catalog.get(m.id));return live&&listed?{...live,tokens:Math.min(live.tokens,listed.tokens)}:live??listed??{model:m.id,tokens:fallback,source:"fallback" as const};});
    return found.length?found:[{model:id,tokens:fallback,source:"fallback" as const}];
  });
  if(!entries.length)entries.push({model:"unknown",tokens:fallback,source:"fallback"});
  const discovered=Math.min(...entries.map(e=>e.tokens));
  // This maximum is the installed CLI's supported override range, not a Copilot limit.
  return {tokens:Math.min(discovered,ceiling??Infinity,1000000),source:entries.some(e=>e.source==="fallback")?"fallback":"copilot",models:entries,ceiling:ceiling??null,fallbackTokens:fallback};
}
export function clientContextWindow(models:Iterable<any>,mapping:Record<string,string>,ceiling?:number,autoModels:Iterable<any>=[],fallback=DEFAULT_CONTEXT_WINDOW):number {
  return contextPolicy(models,mapping,ceiling,autoModels,fallback).tokens;
}
