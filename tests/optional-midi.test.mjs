import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ID} from "../scripts/constants.mjs";
import {ImportService,checkEnvironment,checkAutomation} from "../scripts/importer.mjs";
import {registerHandlers} from "../scripts/handlers.mjs";
import {parseText} from "../scripts/parser.mjs";
import {testEnvironment} from "./fixtures.mjs";

const source=await readFile(new URL("../examples/training-creature.txt",import.meta.url),"utf8");
const bundle=parseText(source);
function setup(state="ready"){
  const f=testEnvironment();
  f.env.game.system.version="6.0.6";
  f.env.game.modules.set("midi-qol",{active:true,version:"14.6.0"});
  if(state==="missing")f.env.game.modules.delete("midi-qol");
  if(state==="disabled")f.env.game.modules.get("midi-qol").active=false;
  if(state==="incompatible")f.env.game.modules.get("midi-qol").version="14.0.15";
  if(state==="failed startup")delete f.env.MidiQOL;
  f.service=new ImportService({env:f.env,adapter:f.adapter});
  return f;
}

for(const state of ["missing","disabled","incompatible","failed startup"]){
  test(`native creature import and undo work with ${state} Midi-QOL`,async()=>{
    const f=setup(state);
    assert.deepEqual(checkEnvironment(f.env),[]);
    assert.ok(checkAutomation(f.env).length);
    const plan=await f.service.prepare(bundle);
    assert.ok(plan.warnings.some(x=>x.startsWith("Midi automation unavailable:")));
    assert.ok(plan.nodes.every(n=>!n.errors.length));
    const batch=await f.service.commit(plan);
    assert.equal(batch.status,"complete");assert.equal(batch.created.length,1);
    assert.ok(batch.warnings.some(x=>x.includes("Native content can still be imported")));
    assert.deepEqual(f.history[0].warnings,batch.warnings);
    const actor=[...f.store.Actor.values()][0];
    assert.equal(actor.system.attributes.hp.max,45);
    const claw=actor.data.items.find(i=>i.name==="Claw");
    assert.ok(Object.values(claw.system.activities).some(a=>a.type==="attack"));
    const bolt=actor.data.items.find(i=>i.name==="Spark Bolt");
    assert.ok(Object.values(bolt.system.activities).some(a=>a.type==="save"));
    const result=await f.service.undo(batch.id);
    assert.equal(result.removed.length,1);assert.equal(f.store.Actor.size,0);
  });
}

test("a compatible active Midi package with a failed API is reported separately",()=>{
  const f=setup("failed startup");
  assert.match(checkAutomation(f.env).join(" "),/API is unavailable/);
  f.env.MidiQOL={completeItemUse:true};
  assert.match(checkAutomation(f.env).join(" "),/API is unavailable/);
  f.env.MidiQOL={completeItemUse:async()=>({})};
  assert.deepEqual(checkAutomation(f.env),[]);
});

test("compatible Midi keeps native and automation imports free of fallback warnings",async()=>{
  const f=setup();
  const plan=await f.service.prepare(bundle);
  assert.ok(!plan.warnings.some(x=>x.startsWith("Midi automation unavailable:")));
  const batch=await f.service.commit(plan);
  assert.deepEqual(batch.warnings,[]);
});

test("optional automation rejects unsupported or malformed Midi versions",()=>{
  const {env}=setup();
  for(const version of [undefined,"","14","14.x.y","13.0.40","15.0.0"]){
    env.game.modules.get("midi-qol").version=version;
    assert.ok(checkAutomation(env).length,String(version));
    assert.deepEqual(checkEnvironment(env),[]);
  }
});

test("a registered workflow hook ignores unusable Midi and checks availability at call time",async()=>{
  const f=setup("missing"),callbacks=new Map();let calls=0,confirmations=0;
  f.env.Hooks={on:(name,callback)=>callbacks.set(name,callback)};
  f.env.foundry={applications:{api:{DialogV2:{confirm:async()=>{confirmations++;return true;}}}}};
  f.env.ui={notifications:{error:message=>assert.fail(message)}};
  registerHandlers(f.env);
  const attack={name:"Claw"};
  const item={uuid:"Item.multi",flags:{[ID]:{multiattack:[{name:"Claw",count:2}]}},actor:{isOwner:true,items:[attack]}};
  const workflow={id:"optional-midi-hook",item,userId:f.env.game.user.id,targets:new Set()};
  const callback=callbacks.get("midi-qol.RollComplete");
  callback(workflow);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(confirmations,0);assert.equal(calls,0);
  f.env.game.modules.set("midi-qol",{active:true,version:"14.6.0"});
  f.env.MidiQOL={completeItemUse:async()=>{calls++;return {aborted:false};}};
  callback(workflow);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(confirmations,1);assert.equal(calls,2);
});

test("actual init/ready entrypoint and UI Analyze/Import run without Midi",async()=>{
  const f=setup("missing"),once=new Map(),listeners=new Map(),registered=[];
  f.env.game.modules.set(ID,{});
  f.env.game.settings={
    get:()=>({}),register:(...args)=>registered.push(args),registerMenu:(...args)=>registered.push(args)
  };
  f.env.game.keybindings={register:()=>{}};
  class ApplicationV2{
    async render(){return this;}async _prepareContext(){return {};} _onRender(){}async close(){return this;}
  }
  const globals={game:f.env.game,foundry:{applications:{api:{ApplicationV2,HandlebarsApplicationMixin:base=>base}}},
    Hooks:{once:(name,callback)=>once.set(name,callback),on:(name,callback)=>listeners.set(name,callback)},
    ui:{notifications:{warn:message=>assert.fail(message)}}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const midi=Object.getOwnPropertyDescriptor(globalThis,"MidiQOL");
  try{
    delete globalThis.MidiQOL;
    Object.assign(globalThis,globals);
    await import(`../scripts/main.mjs?optional-midi-regression`);
    once.get("init")();once.get("ready")();
    assert.ok(registered.some(args=>args[1]==="importer"));
    const api=f.env.game.modules.get(ID).api;
    assert.deepEqual(api.checkEnvironment(),[]);
    assert.match(api.checkAutomation().join(" "),/not installed/);
    const app=await api.open();
    app.service=f.service;app.input=source;app.kind="creature";
    await app.constructor.actionAnalyze.call(app);
    assert.equal(app.error,"");assert.equal(app.view,"review");
    const context=await app._prepareContext({});
    assert.equal(context.canImport,true);
    assert.match(context.automationIssues.join(" "),/not installed/);
    assert.deepEqual(context.environmentErrors,[]);
    await app.constructor.actionImport.call(app);
    assert.equal(app.error,"");assert.equal(app.view,"history");
    assert.equal(app.result.created.length,1);
    assert.ok(app.result.warnings.some(x=>x.includes("Midi automation unavailable")));
    await app.service.undo(app.result.id);
    assert.equal(f.store.Actor.size,0);
  }finally{
    for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    if(midi)Object.defineProperty(globalThis,"MidiQOL",midi);else delete globalThis.MidiQOL;
  }
});
