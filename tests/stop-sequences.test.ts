import {test,expect} from "bun:test";
import {StopText,stopSequences,stopMessage} from "../src/proxy/stop-sequences";
import {toResponses,fromResponses,responsesStream} from "../src/proxy/responses";
import {frame} from "../src/proxy/sse";
import {startProxy} from "../src/proxy/server";
import {CopilotClient} from "../src/proxy/copilot";
const model="gpt-fixture",usage={input_tokens:20,output_tokens:9};
const final=(text:string)=>({id:"r",status:"completed",usage,output:[{type:"message",content:[{type:"output_text",text}]}]});
const decode=(value:string)=>JSON.parse(value.slice(value.indexOf("data: ")+6));
test("classifier stop sequences are accepted without sending an unsupported Responses parameter",()=>{
  const body=toResponses({messages:[{role:"user",content:"classify fixture"}],stop_sequences:["</decision>"]},model,100,{});
  expect(body.stop_sequences).toBeUndefined();expect(body.stop).toBeUndefined();expect(body.input[0].content[0].text).toBe("classify fixture");
  for(const invalid of [null,"stop",[""],[5]])expect(()=>stopSequences(invalid)).toThrow("non-empty strings");
});
test("JSON stops at the earliest delimiter, preserves real usage and suppresses later tools",()=>{
  const response=final("<decision>allow</decision>discard");response.output.push({type:"function_call",call_id:"late",name:"Bash",arguments:"{}"} as any);
  const result=fromResponses(response,model,["discard","</decision>"]);
  expect(result.content).toEqual([{type:"text",text:"<decision>allow"}]);expect(result.stop_reason).toBe("stop_sequence");expect(result.stop_sequence).toBe("</decision>");expect(result.usage.output_tokens).toBe(9);
  expect(stopMessage(fromResponses(final("no match</dec"),model),["</decision>"]).content[0].text).toBe("no match</dec");
});
test("stop delimiters survive every delta boundary without leaking prefixes, including Unicode",()=>{
  const text="yes🙂終わりdiscard",stop="🙂終わり";
  for(let split=0;split<=text.length;split++){const scanner=new StopText([stop]);const result=scanner.push(text.slice(0,split))+scanner.push(text.slice(split))+scanner.flush();expect(result).toBe("yes");expect(scanner.matched).toBe(stop);}
  const scanner=new StopText(["ababX","stop"]);expect(scanner.push("ok aba")).toBe("ok ");expect(scanner.push("babXafter")).toBe("ab");expect(scanner.matched).toBe("ababX");
});
test("streaming classifier returns a matched Anthropic stop reason and terminal provider usage",async()=>{
  const events=[{type:"response.created",response:{id:"r"}},
    ...["<decision>allow</dec","ision>discard"].map(delta=>({type:"response.output_text.delta",output_index:0,content_index:0,delta})),
    {type:"response.output_text.done",output_index:0,content_index:0,text:"<decision>allow</decision>discard"},
    {type:"response.output_item.added",output_index:1,item:{type:"function_call",call_id:"late",name:"Bash",arguments:""}},
    {type:"response.function_call_arguments.delta",output_index:1,delta:"{}"},
    {type:"response.output_item.done",output_index:1,item:{type:"function_call",call_id:"late",name:"Bash",arguments:"{}"}},
    {type:"response.completed",response:final("<decision>allow</decision>discard")}];
  let completed:any;const translated=[];for await(const value of responsesStream(new Response(events.map(frame).join("")),model,v=>completed=v,["</decision>"]))translated.push(decode(value));
  expect(translated.filter(e=>e.delta?.type==="text_delta").map(e=>e.delta.text).join("")).toBe("<decision>allow");
  expect(translated.filter(e=>e.content_block?.type==="tool_use")).toHaveLength(0);expect(completed.content).toHaveLength(0);expect(completed.usage).toEqual(usage);
  expect(translated.at(-2).delta).toEqual({stop_reason:"stop_sequence",stop_sequence:"</decision>"});expect(translated.at(-1).type).toBe("message_stop");
});
test("unmatched partial prefix is flushed and reasoning/tool arguments are never stop-filtered",async()=>{
  const tool={type:"function_call",call_id:"c",name:"Read",arguments:'{"path":"STOP"}'},reasoning={type:"reasoning",id:"think",summary:[{text:"STOP"}],encrypted_content:"STOP"};
  const events=[{type:"response.created",response:{id:"r"}},{type:"response.output_item.added",output_index:0,item:reasoning},{type:"response.output_item.done",output_index:0,item:reasoning},
    {type:"response.output_text.delta",output_index:1,delta:"unfinished ST"},{type:"response.output_text.done",output_index:1,text:"unfinished ST"},
    {type:"response.output_item.added",output_index:2,item:{...tool,arguments:""}},{type:"response.output_item.done",output_index:2,item:tool},
    {type:"response.completed",response:{...final("unfinished ST"),output:[reasoning,tool]}}];
  const translated=[];for await(const value of responsesStream(new Response(events.map(frame).join("")),model,()=>{},["STOP"]))translated.push(decode(value));
  expect(translated.filter(e=>e.delta?.type==="text_delta").map(e=>e.delta.text).join("")).toBe("unfinished ST");
  expect(translated.find(e=>e.delta?.type==="thinking_delta").delta.thinking).toBe("STOP");expect(translated.find(e=>e.delta?.type==="input_json_delta").delta.partial_json).toBe(tool.arguments);expect(translated.at(-2).delta.stop_reason).toBe("tool_use");
});
test("a matched local stop cannot turn a truncated upstream stream into a successful classification",async()=>{
  const response=new Response(frame({type:"response.output_text.delta",output_index:0,delta:"allowSTOP"}));let completed=false;
  const run=async()=>{for await(const _ of responsesStream(response,model,()=>{completed=true;},["STOP"])){};};
  await expect(run()).rejects.toThrow("before completion");expect(completed).toBe(false);
});
test("Messages endpoint accepts classifier requests through Auto for both JSON and SSE",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  const calls:any[]=[];const auth:any={status:{},models:async()=>({data:[]}),get:async()=>({token:"fixture",api:"https://api.individual.githubcopilot.com"}),stop(){}};
  const client=new CopilotClient(auth,(async(url:any,init:any)=>{const body=JSON.parse(init.body);calls.push({url,body});
    if(String(url).endsWith("/auto"))return Response.json({session_token:"fixture-session",expires_at:Date.now()/1000+3600,selected_model:{id:model,vendor:"OpenAI",supported_endpoints:["/responses"],capabilities:{}}});
    if(body.stream)return new Response([{type:"response.output_text.delta",output_index:0,delta:"<decision>allow</dec"},{type:"response.output_text.delta",output_index:0,delta:"ision>ignored"},{type:"response.completed",response:final("<decision>allow</decision>ignored")}].map(frame).join(""));
    return Response.json(final("<decision>allow</decision>ignored"));
  }) as any);
  const proxy=await startProxy(auth,{port,key:"local",models:{}},{client});
  try{for(const stream of [false,true]){const response=await fetch(`http://127.0.0.1:${port}/v1/messages`,{method:"POST",headers:{Authorization:"Bearer local"},body:JSON.stringify({model:"copilot-auto",max_tokens:100,stream,stop_sequences:["</decision>"],messages:[{role:"user",content:"Classify fixture"}],metadata:{user_id:"classifier"}})});
    expect(response.status).toBe(200);if(!stream){const message=await response.json() as any;expect(message.stop_reason).toBe("stop_sequence");expect(message.content[0].text).toBe("<decision>allow");}
    else {const text=await response.text();expect(text).toContain('"stop_reason":"stop_sequence"');expect(text).not.toContain("ignored");expect(text).not.toContain("event: error");}
  }expect(calls.filter(c=>c.url.endsWith("/auto"))).toHaveLength(1);expect(calls.filter(c=>c.url.endsWith("/responses"))).toHaveLength(2);
  }finally{proxy.stop();}
});
