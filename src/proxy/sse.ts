import { errorBody,ApiError } from "./errors";
export type Event = {event:string;data:string};
export function frame(value:any,event=value.type):string {return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;}
export async function* parseSSE(body:ReadableStream<Uint8Array>):AsyncGenerator<Event> {
  const reader=body.getReader(),decoder=new TextDecoder();let buffer="",event="message",data:string[]=[],eventSize=0;
  try {while(true){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
    let match:RegExpExecArray|null;
    while((match=/[\r\n]/.exec(buffer))){const at=match.index;
      if(buffer[at]==="\r"&&at===buffer.length-1&&!done)break;
      const line=buffer.slice(0,at),length=buffer[at]==="\r"&&buffer[at+1]==="\n"?2:1;buffer=buffer.slice(at+length);
      eventSize+=line.length+length;if(eventSize>16*1024*1024)throw new ApiError(502,"api_error","Provider stream event exceeded the supported size");
      if(line===""){if(data.length)yield {event,data:data.join("\n")};event="message";data=[];eventSize=0;continue;}
      if(line.startsWith("event:"))event=line.slice(6).replace(/^ /,"");if(line.startsWith("data:"))data.push(line.slice(5).replace(/^ /,""));
    }
    if(buffer.length+eventSize>16*1024*1024)throw new ApiError(502,"api_error","Provider stream event exceeded the supported size");
    if(done)break;
  }} finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function eventStream(iterator:AsyncGenerator<string>,abort:()=>void):ReadableStream<Uint8Array> {
  const encoder=new TextEncoder();let pending:Promise<IteratorResult<string>>|undefined,cancelled=false;
  return new ReadableStream({async pull(controller){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {pending??=iterator.next();
      const result=await Promise.race([pending.then(value=>({value})),new Promise<{ping:true}>(resolve=>{timer=setTimeout(()=>resolve({ping:true}),15000);})]);
      clearTimeout(timer);if(cancelled)return;if("ping" in result){controller.enqueue(encoder.encode(frame({type:"ping"})));return;}
      pending=undefined;if(result.value.done)controller.close();else controller.enqueue(encoder.encode(result.value.value));
    } catch(error){if(cancelled)return;controller.enqueue(encoder.encode(frame(errorBody(error))));controller.close();abort();}
    finally{clearTimeout(timer);}
  },cancel(){cancelled=true;abort();void iterator.return("").catch(()=>{});}});
}
