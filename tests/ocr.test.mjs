import test from "node:test";
import assert from "node:assert/strict";
import {recognizeImages} from "../scripts/ocr.mjs";

const file=name=>({name,type:"image/png",size:100});
function fixture({recognize}={}){
  const state={terminated:0,calls:[],options:null};
  const worker={async setParameters(){},async recognize(image){state.calls.push(image);return recognize?recognize(image):{data:{text:`${image.name}\nArmor Class 15`,confidence:92}};},async terminate(){state.terminated++;}};
  state.factory=async(language,oem,options)=>{assert.equal(language,"eng");assert.equal(oem,1);state.options=options;return worker;};
  return state;
}
test("image reading uses only bundled assets and one worker per batch",async()=>{
  const f=fixture(),result=await recognizeImages([file("First"),file("Second")],{env:{},workerFactory:f.factory});
  assert.equal(result.pages.length,2);assert.equal(result.pages[0].confidence,92);
  assert.equal(f.calls.length,2);assert.equal(f.terminated,1);
  for(const key of ["workerPath","corePath","langPath"]){assert.ok(f.options[key].startsWith("http://localhost/modules/telys-dnd-importer/vendor/ocr/"));assert.ok(!f.options[key].includes("cdn"));}
});
test("low image-reading confidence is included in review warnings",async()=>{
  const f=fixture({recognize:async()=>({data:{text:"Uncertain text",confidence:65}})});
  const result=await recognizeImages([file("Blurry.png")],{env:{},workerFactory:f.factory});
  assert.ok(result.warnings.some(w=>w.includes("65%")));
});
test("unreadable images fail and release the worker",async()=>{
  const f=fixture({recognize:async()=>({data:{text:"",confidence:0}})});
  await assert.rejects(recognizeImages([file("Blank.png")],{env:{},workerFactory:f.factory}),/no readable text/);
  assert.equal(f.terminated,1);
});
test("cancelling an active image read terminates it promptly",async()=>{
  let entered;
  const started=new Promise(resolve=>{entered=resolve;}),f=fixture({recognize:async()=>{entered();return new Promise(()=>{});}}),controller=new AbortController();
  const pending=recognizeImages([file("Page.png")],{env:{},workerFactory:f.factory,signal:controller.signal});
  await started;controller.abort();
  await assert.rejects(pending,{name:"AbortError"});assert.ok(f.terminated>=1);
});
test("cancellation during worker initialization cleans up a late worker",async()=>{
  let release;
  const f=fixture(),controller=new AbortController();
  const pending=recognizeImages([file("Page.png")],{env:{},signal:controller.signal,workerFactory:async(...args)=>{await new Promise(resolve=>{release=resolve;});return f.factory(...args);}});
  controller.abort();await assert.rejects(pending,{name:"AbortError"});release();
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.terminated,1);
});
