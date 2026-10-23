import test from"node:test";import assert from"node:assert/strict";
import{chatEndpoint,bridgeEndpoint,extractWithModel,postJSON,testModelConnection}from"../scripts/providers.mjs";import{feat}from"./fixtures.mjs";import{runMultiattack}from"../scripts/handlers.mjs";import{ID}from"../scripts/constants.mjs";
const json=data=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
test("chat endpoint normalization keeps an existing completions path",()=>{assert.equal(chatEndpoint("http://127.0.0.1:11434/v1"),"http://127.0.0.1:11434/v1/chat/completions");assert.equal(chatEndpoint("https://example.com/v1/chat/completions"),"https://example.com/v1/chat/completions");assert.throws(()=>chatEndpoint("https://example.com/v1?api_key=secret"),/query/);assert.throws(()=>bridgeEndpoint("https://public.example","/fetch"),/localhost/);});
test("model extraction receives declarative schema and returns normalized entries",async()=>{let sent;const result=await extractWithModel({text:"Import this spell-like feature",config:{endpoint:"http://localhost:11434/v1",model:"test",maxTokens:4096},credentials:{apiKey:"secret-key"},fetcher:async(url,options)=>{sent={url,options};return json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({entries:[feat()]})}}]});}});assert.equal(result.entries[0].name,"Arc Spark");const body=JSON.parse(sent.options.body);assert.match(body.messages[0].content,/Never return scripts/);assert.equal(sent.options.headers.Authorization,"Bearer secret-key");assert.equal(sent.options.redirect,"error");assert.equal(JSON.stringify(result).includes("secret-key"),false);});
test("truncated or malformed model output cannot proceed to import",async()=>{const base={text:"x",config:{endpoint:"http://localhost:11434/v1",model:"test"}};await assert.rejects(extractWithModel({...base,fetcher:async()=>json({choices:[{finish_reason:"length",message:{content:"{"}}]})}),/cut off/);await assert.rejects(extractWithModel({...base,fetcher:async()=>json({choices:[{finish_reason:"stop",message:{content:"not JSON"}}]})}),/valid import JSON/);});
test("bridge forwards model requests and tokens separately from the endpoint URL",async()=>{let sent;await extractWithModel({text:"x",config:{endpoint:"http://localhost:11434/v1",model:"test",bridge:"http://127.0.0.1:8765"},credentials:{bridgeToken:"private-token"},fetcher:async(url,options)=>{sent={url,options};return json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({entries:[feat()]})}}]});}});assert.equal(sent.url,"http://127.0.0.1:8765/extract");assert.equal(sent.options.headers["X-Tely-Token"],"private-token");assert.ok(!sent.url.includes("private-token"));});
test("request cancellation propagates without leaking credentials",async()=>{const c=new AbortController();c.abort();await assert.rejects(postJSON("https://example.com",{},{signal:c.signal,fetcher:async()=>{throw new Error("should not run");}}),{name:"AbortError"});});
test("fixed multiattack calls Midi's current item-use handler with explicit targets",async()=>{const calls=[],attack={name:"Claw"},item={name:"Multiattack",uuid:"Item.multi",flags:{[ID]:{multiattack:[{name:"Claw",count:2}]}}};item.actor={items:[attack],isOwner:true};const env={game:{user:{id:"gm",isGM:true,targets:new Set()}},foundry:{applications:{api:{DialogV2:{confirm:async()=>true}}}},MidiQOL:{completeItemUse:async(...args)=>{calls.push(args);return{aborted:false};}}};await runMultiattack({id:"w1",userId:"gm",item,targets:new Set([{document:{uuid:"Scene.test.Token.target"}}])},env);assert.equal(calls.length,2);assert.deepEqual(calls[0][1].midiOptions.targetUuids,["Scene.test.Token.target"]);assert.equal(calls[0][1].midiOptions.workflowOptions[ID].child,true);assert.equal(calls[0][2].configure,true);});
test("cancelling multiattack does not roll child attacks",async()=>{
  let calls=0;
  const attack={name:"Claw"};
  const item={uuid:"Item.multi2",flags:{[ID]:{multiattack:[{name:"Claw",count:1}]}}};
  const env={game:{user:{id:"gm",isGM:true}},foundry:{applications:{api:{DialogV2:{confirm:async()=>false}}}},MidiQOL:{completeItemUse:async()=>calls++}};
  item.actor={items:[attack],isOwner:true};
  await runMultiattack({id:"w2",userId:"gm",item},env);assert.equal(calls,0);
});
test("Ollama model connection sends a short chat request without an API key",async()=>{
  let sent;
  const result=await testModelConnection({config:{endpoint:"http://127.0.0.1:11434/v1",model:"gemma3:4b"},fetcher:async(url,options)=>{sent={url,options};return json({choices:[{message:{content:'{"ready":true}'}}]});}});
  assert.equal(result.ok,true);assert.equal(sent.url,"http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(sent.options.headers.Authorization,undefined);assert.equal(JSON.parse(sent.options.body).max_tokens,64);
});
test("model connection can use the companion and requires a chat response",async()=>{
  let sent;
  await testModelConnection({config:{endpoint:"http://127.0.0.1:11434/v1",model:"gemma3:4b",bridge:"http://127.0.0.1:8765"},credentials:{bridgeToken:"test-token"},fetcher:async(url,options)=>{sent={url,options};return json({choices:[{message:{content:"Ready"}}]});}});
  assert.equal(sent.url,"http://127.0.0.1:8765/extract");assert.equal(sent.options.headers["X-Tely-Token"],"test-token");
  await assert.rejects(testModelConnection({config:{endpoint:"http://localhost:11434/v1",model:"x"},fetcher:async()=>json({models:[]})}),/chat-completions/);
});
test("model errors explain a missing vision capability and redact both credentials",async()=>{
  await assert.rejects(postJSON("https://example.com",{apiKey:"model-secret"},{key:"model-secret",bridgeToken:"bridge-secret",fetcher:async()=>new Response(JSON.stringify({error:"model does not support images (model-secret, bridge-secret)"}),{status:400,headers:{"Content-Type":"application/json"}})}),error=>{
    assert.match(error.message,/does not support images/);assert.ok(!error.message.includes("model-secret"));assert.ok(!error.message.includes("bridge-secret"));return true;
  });
});
