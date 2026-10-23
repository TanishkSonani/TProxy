export const DEFAULT_CONTEXT_WINDOW=200000;
export function clientContextWindow(models:Iterable<any>,mapping:Record<string,string>,ceiling=DEFAULT_CONTEXT_WINDOW,autoModels:Iterable<any>=[]):number {
  if(!Number.isInteger(ceiling)||ceiling<1000||ceiling>1000000)throw new Error("Context window must be between 1000 and 1000000 tokens");
  const observed=[...autoModels],observedIds=new Set(observed.map(m=>m.id)),selected=new Set(Object.values(mapping));let window=ceiling;
  for(const model of [...models,...observed]){
    // Include configured slots, selectable chat models, and Auto's observed selections.
    if(!selected.has(model.id)&&!model.model_picker_enabled&&!observedIds.has(model.id))continue;
    if(model.policy?.state==="disabled")continue;
    const limits=model.capabilities?.limits;
    for(const value of [limits?.max_context_window_tokens,limits?.max_prompt_tokens])if(Number.isInteger(value)&&value>=1000)window=Math.min(window,value);
  }
  return window;
}
