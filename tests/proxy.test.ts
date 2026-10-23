import { expect,test } from "bun:test";
import { clampTokens,initiator,upstreamError,errorBody } from "../src/proxy/errors";
import { parseSSE,frame } from "../src/proxy/sse";
import { fromResponses,responsesStream,toResponses } from "../src/proxy/responses";
import { startProxy } from "../src/proxy/server";
import { CopilotClient } from "../src/proxy/copilot";
import { toChat,fromChat,chatStream } from "../src/proxy/chat";
const caps={supports:{tool_calls:true,vision:true,reasoning_effort:["none","medium"]},limits:{max_output_tokens:8192}};
const final={id:"resp_fixture",status:"completed",output:[{type:"message",content:[{type:"output_text",text:"OK"}]}],usage:{input_tokens:100,output_tokens:5,input_tokens_details:{cached_tokens:20,cache_write_tokens:10}}};
test("context overflow, rate limits and output clamps have Anthropic semantics without leaking source errors",()=>{
  expect(errorBody(upstreamError(400,{error:{code:"model_max_prompt_tokens_exceeded",message:"internal secret"}})))
    .toEqual({type:"error",error:{type:"invalid_request_error",message:"prompt is too long"}});
  expect(upstreamError(429,{},"12").retryAfter).toBe("12");expect(clampTokens(1,100,4096)).toBe(100);expect(clampTokens(9000,100,4096)).toBe(4096);
  expect(()=>clampTokens(-1,100,4096)).toThrow();
});
test("initiator follows user/tool/user turns rather than sticky assistant history",()=>{
  expect(initiator([{role:"user",content:"first"}])).toBe("user");
  expect(initiator([{role:"assistant",content:[]},{role:"user",content:[{type:"tool_result",content:"done"}]}])).toBe("agent");
  expect(initiator([{role:"user",content:[{type:"tool_result",content:"done"}]},{role:"system",content:"client reminder"}])).toBe("agent");
  expect(initiator([{role:"assistant",content:[]},{role:"user",content:"follow-up"}])).toBe("user");
});
test("SSE parser handles byte-fragmented unicode, CRLF, comments and multiline data",async()=>{
  const bytes=new TextEncoder().encode(': ping\r\nevent: example\r\ndata: {"text":\r\ndata: "hello 🦀"}\r\n\r\n');
  const body=new ReadableStream<Uint8Array>({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const events=[];for await(const event of parseSSE(body))events.push(event);
  expect(events).toHaveLength(1);expect(JSON.parse(events[0].data).text).toBe("hello 🦀");
});
test("Responses preserves linked tool calls/results, system prompt and opaque reasoning without model substitution",()=>{
  const response={...final,output:[{type:"reasoning",id:"r1",summary:[{text:"summary"}],encrypted_content:"opaque"},{type:"function_call",call_id:"call_a",name:"Read",arguments:'{"path":"fixture"}'}]};
  const translated=fromResponses(response,"gpt-fixture");expect(translated.stop_reason).toBe("tool_use");expect(translated.usage.input_tokens).toBe(70);
  const request={model:"copilot-auto",max_tokens:100,system:[{type:"text",text:"original system"}],messages:[{role:"assistant",content:translated.content},{role:"user",content:[{type:"tool_result",tool_use_id:"call_a",content:"fixture result"}]}],tools:[{name:"Read",input_schema:{type:"object"}}]};
  const wire=toResponses(request,"gpt-fixture",100,caps);expect(wire.instructions).toBe("original system");expect(wire.input[0].encrypted_content).toBe("opaque");
  expect(wire.input.at(-1)).toEqual({type:"function_call_output",call_id:"call_a",output:"fixture result"});
  expect(()=>toResponses(request,"different-model",100,caps)).toThrow("another model");
});
test("streaming parallel tools retain separate blocks, partial JSON and terminal real usage",async()=>{
  const output=[{type:"function_call",call_id:"a",name:"Read",arguments:'{"a":1}'},{type:"function_call",call_id:"b",name:"Bash",arguments:'{"b":2}'}];
  const events=[{type:"response.created",response:{id:"resp_parallel"}},...output.map((item,i)=>({type:"response.output_item.added",output_index:i,item:{...item,arguments:""}})),
    {type:"response.function_call_arguments.delta",output_index:1,delta:'{"b":'},
    {type:"response.function_call_arguments.delta",output_index:0,delta:'{"a":1}'},
    {type:"response.function_call_arguments.delta",output_index:1,delta:'2}'},
    ...output.map((item,i)=>({type:"response.output_item.done",output_index:i,item})),{type:"response.completed",response:{...final,output}}];
  let complete:any;const response=new Response(events.map(e=>frame(e)).join(""));const translated=[];
  for await(const value of responsesStream(response,"fixture",m=>complete=m))translated.push(JSON.parse(value.split("data: ")[1]));
  expect(translated.filter(e=>e.type==="content_block_start").map(e=>e.index)).toEqual([0,1]);
  expect(translated.at(-2).delta.stop_reason).toBe("tool_use");expect(translated.at(-2).usage.output_tokens).toBe(5);expect(complete.usage.input_tokens).toBe(70);
  expect(translated.at(-1).type).toBe("message_stop");
});
test("truncated provider stream fails instead of manufacturing message_stop",async()=>{
  const iterator=responsesStream(new Response(frame({type:"response.created",response:{id:"x"}})),"fixture",()=>{});
  await iterator.next();await expect(iterator.next()).rejects.toThrow("before completion");
});
test("proxy enforces local auth, performs Auto handshake and maps provider overflow",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}});const port=listener.port;listener.stop(true);
  const calls:any[]=[];let overflow=false;
  const auth:any={status:{},get:async()=>({token:"copilot-fixture",api:"https://api.individual.githubcopilot.com"}),models:async()=>({data:[]}),stop(){}};
  const client=new CopilotClient(auth,(async(url:any,init:any)=>{const body=JSON.parse(init.body);calls.push({url,body,headers:init.headers});
    if(String(url).endsWith("/auto"))return Response.json({session_token:"auto-secret",expires_at:Date.now()/1000+3600,selected_model:{id:"gpt-fixture",vendor:"OpenAI",supported_endpoints:["/responses"],capabilities:caps}});
    if(overflow)return Response.json({error:{code:"model_max_prompt_tokens_exceeded",message:"internal"}},{status:400});return Response.json(final);
  }) as any);
  const proxy=await startProxy(auth,{port,key:"local-fixture",models:{}},{client});
  try {const url=`http://127.0.0.1:${port}/v1/messages`,body={model:"copilot-auto",max_tokens:100,messages:[{role:"user",content:"hello"}],metadata:{user_id:"session-fixture"}};
    expect((await fetch(url,{method:"POST",body:JSON.stringify(body)})).status).toBe(401);
    let response=await fetch(url,{method:"POST",headers:{Authorization:"Bearer local-fixture"},body:JSON.stringify(body)});
    expect(response.status).toBe(200);expect((await response.json() as any).content[0].text).toBe("OK");
    expect(calls[1].headers["Copilot-Session-Token"]).toBe("auto-secret");
    overflow=true;response=await fetch(url,{method:"POST",headers:{Authorization:"Bearer local-fixture"},body:JSON.stringify(body)});
    expect(response.status).toBe(400);expect((await response.json() as any).error.message).toBe("prompt is too long");
    expect(calls.filter(c=>c.url.endsWith("/auto"))).toHaveLength(1);
  }finally{proxy.stop();}
});
test("Chat Completions maps tool identities, cached usage and cutoff without renaming models",()=>{
  const wire=toChat({system:"unchanged",stream:true,messages:[{role:"assistant",content:[{type:"tool_use",id:"call_1",name:"Read",input:{path:"fixture"}}]},{role:"user",content:[{type:"tool_result",tool_use_id:"call_1",content:"result"}]}],tools:[{name:"Read",input_schema:{type:"object"}}]},"gemini-fixture",100,caps);
  expect(wire.model).toBe("gemini-fixture");expect(wire.messages.at(-1).tool_call_id).toBe("call_1");
  expect(fromChat({id:"m",choices:[{message:{content:"partial"},finish_reason:"length"}],usage:{prompt_tokens:10,completion_tokens:3,prompt_tokens_details:{cached_tokens:4}}},"gemini-fixture").usage.input_tokens).toBe(6);
});
test("Chat stream waits for fragmented tool metadata and accepts trailing usage-only chunks",async()=>{
  const data=[{id:"x",choices:[{delta:{tool_calls:[{index:0,id:"call_",function:{name:"Re",arguments:""}}]}}]},
    {id:"x",choices:[{delta:{tool_calls:[{index:0,id:"1",function:{name:"ad",arguments:'{"path":"x"}'}}]},finish_reason:"tool_calls"}]},
    {choices:[],usage:{prompt_tokens:10,completion_tokens:5}}];
  const response=new Response(data.map(d=>`data: ${JSON.stringify(d)}\n\n`).join("")+"data: [DONE]\n\n");const events=[];
  for await(const value of chatStream(response,"fixture",()=>{}))events.push(JSON.parse(value.split("data: ")[1]));
  expect(events.find(e=>e.type==="content_block_start").content_block).toEqual({type:"tool_use",id:"call_1",name:"Read",input:{}});
  expect(events.at(-2).usage.input_tokens).toBe(10);
});
test("Claude route forwards native tools/thinking/images and beta headers, and never uses OpenAI adapters",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}});const port=listener.port;listener.stop(true);
  const calls:any[]=[];const model={id:"claude-fixture",vendor:"Anthropic",supported_endpoints:["/v1/messages"],capabilities:caps};
  const auth:any={status:{},models:async()=>({data:[model]}),get:async()=>({token:"fixture",api:"https://api.githubcopilot.com"}),stop(){}};
  const client=new CopilotClient(auth,(async(url:any,init:any)=>{calls.push({url,body:JSON.parse(init.body),headers:init.headers});return Response.json({id:"m",type:"message",role:"assistant",model:model.id,content:[],stop_reason:"end_turn",usage:{input_tokens:1,output_tokens:1}});}) as any);
  const proxy=await startProxy(auth,{port,key:"key",models:{}},{client});
  try {const messages=[{role:"assistant",content:[{type:"thinking",thinking:"opaque",signature:"native-signature"},{type:"tool_use",id:"t",name:"Read",input:{}}]},
    {role:"user",content:[{type:"tool_result",tool_use_id:"t",content:[{type:"image",source:{type:"base64",media_type:"image/png",data:"fixture"}}]}]}];
    const response=await fetch(`http://127.0.0.1:${port}/v1/messages`,{method:"POST",headers:{Authorization:"Bearer key","anthropic-beta":"verified-fixture"},body:JSON.stringify({model:model.id,messages,max_tokens:20000,system:"unchanged"})});
    expect(response.status).toBe(200);expect(calls).toHaveLength(1);expect(calls[0].url.endsWith("/v1/messages")).toBe(true);
    expect(calls[0].body.messages).toEqual(messages);expect(calls[0].body.max_tokens).toBe(4096);expect(calls[0].headers["anthropic-beta"]).toBe("verified-fixture");expect(calls[0].headers["Copilot-Vision-Request"]).toBe("true");
  }finally{proxy.stop();}
});
