import { errorBody,ApiError } from "./errors";
export type Event = {event:string;data:string};
export function frame(value:any,event=value.type):string {return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;}
export async function* parseSSE(body:ReadableStream<Uint8Array>):AsyncGenerator<Event> {
  const reader=body.getReader(),decoder=new TextDecoder();let buffer="";
  try {while(true){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
    let match:RegExpExecArray|null;
    while((match=/\r?\n\r?\n/.exec(buffer))){const chunk=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
      let event="message";const data:string[]=[];
      for(const line of chunk.split(/\r?\n/)){if(line.startsWith("event:"))event=line.slice(6).trimStart();if(line.startsWith("data:"))data.push(line.slice(5).replace(/^ /,""));}
      if(data.length)yield {event,data:data.join("\n")};
    }
    if(buffer.length>16*1024*1024)throw new ApiError(502,"api_error","Provider stream event exceeded the supported size");
    if(done)break;
  }} finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function eventStream(iterator:AsyncGenerator<string>,abort:()=>void):ReadableStream<Uint8Array> {
  const encoder=new TextEncoder();let pending:Promise<IteratorResult<string>>|undefined;
  return new ReadableStream({async pull(controller){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {pending??=iterator.next();
      const result=await Promise.race([pending.then(value=>({value})),new Promise<{ping:true}>(resolve=>{timer=setTimeout(()=>resolve({ping:true}),15000);})]);
      clearTimeout(timer);if("ping" in result){controller.enqueue(encoder.encode(frame({type:"ping"})));return;}
      pending=undefined;if(result.value.done)controller.close();else controller.enqueue(encoder.encode(result.value.value));
    } catch(error){controller.enqueue(encoder.encode(frame(errorBody(error))));controller.close();abort();}
    finally{clearTimeout(timer);}
  },async cancel(){abort();await iterator.return("").catch(()=>{});}});
}
