import {ApiError} from "./errors";
import {frame} from "./sse";

export function stopSequences(value:unknown):string[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some(s=>typeof s!=="string"||!s.length))throw new ApiError(400,"invalid_request_error","stop_sequences must be an array of non-empty strings");
  return [...new Set(value)];
}

// Retain only a possible delimiter prefix between deltas. Never expose a partial stop.
export class StopText {
  private pending="";
  matched:string|null=null;
  constructor(private sequences:readonly string[]){}
  push(chunk:string){
    if(this.matched!==null)return "";
    const value=this.pending+chunk;this.pending="";
    let first=-1,match:string|null=null;
    for(const sequence of this.sequences){const at=value.indexOf(sequence);if(at!==-1&&(first===-1||at<first)){first=at;match=sequence;}}
    if(match!==null){this.matched=match;return value.slice(0,first);}
    let keep=0;
    for(const sequence of this.sequences)for(let n=Math.min(sequence.length-1,value.length);n>keep;n--){if(value.endsWith(sequence.slice(0,n))){keep=n;break;}}
    if(keep)this.pending=value.slice(-keep);
    return keep?value.slice(0,-keep):value;
  }
  flush(){const tail=this.pending;this.pending="";return this.matched===null?tail:"";}
}

export function stopMessage(message:any,sequences:readonly string[]){
  if(!sequences.length)return message;
  const content:any[]=[];
  for(const block of message.content){
    if(block.type!=="text"){content.push(block);continue;}
    const scanner=new StopText(sequences),text=scanner.push(block.text)+scanner.flush();
    content.push({...block,text});
    if(scanner.matched!==null)return {...message,content,stop_reason:"stop_sequence",stop_sequence:scanner.matched};
  }
  return message;
}

// Applied to the adapter's own one-frame-per-yield stream, never raw provider SSE.
// Drain to the real terminal usage: do not invent token counts or a successful EOF.
export async function* stopStream(source:AsyncIterable<string>,sequences:readonly string[],onComplete:(message:any)=>void):AsyncGenerator<string>{
  const textBlocks=new Map<number,StopText>(),visible=new Set<number>();let matched:string|null=null,tools=0,usage:any,model:string|undefined;
  for await(const value of source){
    const event=JSON.parse(value.slice(value.indexOf("data: ")+6));
    if(event.type==="message_start")model=event.message.model;
    if(event.type==="content_block_start"){
      if(matched!==null)continue;
      visible.add(event.index);
      if(event.content_block.type==="text"){
        const scanner=new StopText(sequences);textBlocks.set(event.index,scanner);
        event.content_block={...event.content_block,text:scanner.push(event.content_block.text??"")};matched=scanner.matched;
      }
      if(event.content_block.type==="tool_use")tools++;
      yield frame(event);continue;
    }
    if(event.type==="content_block_delta"){
      if(!visible.has(event.index))continue;
      if(event.delta.type==="text_delta"){
        if(matched!==null)continue;
        const scanner=textBlocks.get(event.index);if(!scanner)throw new ApiError(502,"api_error","Text delta arrived before its block");
        const text=scanner.push(event.delta.text);matched=scanner.matched;
        if(text)yield frame({...event,delta:{...event.delta,text}});continue;
      }
    }
    if(event.type==="content_block_stop"){
      if(!visible.has(event.index))continue;
      const tail=textBlocks.get(event.index)?.flush();
      if(tail&&matched===null)yield frame({type:"content_block_delta",index:event.index,delta:{type:"text_delta",text:tail}});
      visible.delete(event.index);
    }
    if(event.type==="message_delta"){
      usage=event.usage;
      if(matched!==null)event.delta={...event.delta,stop_reason:"stop_sequence",stop_sequence:matched};
    }
    if(event.type==="message_stop")onComplete({usage,model,content:Array.from({length:tools},()=>({type:"tool_use"}))});
    yield frame(event);
  }
}
