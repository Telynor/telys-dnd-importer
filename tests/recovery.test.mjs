import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ImportService} from "../scripts/importer.mjs";
import {parseText} from "../scripts/parser.mjs";
import {compileBundle} from "../scripts/compiler.mjs";
import {normalizeBundle} from "../scripts/schema.mjs";
import {ContentResolver} from "../scripts/resolver.mjs";
import {ID} from "../scripts/constants.mjs";
import {classEntry,feat,testEnvironment} from "./fixtures.mjs";

test("Character text selection parses the complete statblock",async()=>{
  const text=await readFile(new URL("../examples/training-creature.txt",import.meta.url),"utf8");
  const bundle=parseText(text,{kind:"character"}),entry=bundle.entries[0];
  assert.equal(entry.kind,"character");assert.equal(entry.stats.hp,45);
  assert.deepEqual(entry.errors,[]);assert.ok(entry.features.some(f=>f.name==="Claw"));
  const node=compileBundle(bundle).nodes[0];
  assert.equal(node.data.type,"character");assert.equal(node.data.prototypeToken.actorLink,true);
});

test("same-named class features remain scoped to their parent and level",async()=>{
  const f=testEnvironment(),service=new ImportService({env:f.env,adapter:f.adapter});
  const first={...classEntry(),name:"Copper Warden",features:[{...feat("Spellcasting"),level:1},{...feat("Spellcasting"),level:6}]};
  const second={...classEntry(),name:"Silver Warden",features:[{...feat("Spellcasting"),level:1}]};
  const result=await service.commit(await service.prepare({entries:[first,second]}));
  assert.equal(result.created.length,5);assert.equal(result.reused.length,0);
  const features=[...f.store.Item.values()].filter(d=>d.type==="feat");
  assert.equal(new Set(features.map(d=>d.flags[ID].featureContext)).size,3);
  const repeat=await service.commit(await service.prepare({entries:[first,second]}));
  assert.equal(repeat.created.length,0);assert.equal(repeat.reused.length,2);
});

test("older imported class features can be reused by exact requirements",async()=>{
  const f=testEnvironment(),service=new ImportService({env:f.env,adapter:f.adapter});
  const old=f.makeDoc("Item",{name:"First Spark",type:"feat",system:{type:{value:"class"},requirements:"Test Warden 1",source:{rules:"2014"}}});
  const result=await service.commit(await service.prepare({entries:[classEntry()]}));
  assert.equal(result.reused[0].uuid,old.uuid);assert.equal(result.created.length,2);
});

test("race traits with shared names do not become grants from another race",async()=>{
  const f=testEnvironment(),service=new ImportService({env:f.env,adapter:f.adapter});
  const entries=["Ashborn","Frostborn"].map(name=>({kind:"race",name,features:[{...feat("Darkvision"),text:`${name} sees in darkness.`}]}));
  const result=await service.commit(await service.prepare({entries}));
  assert.equal(result.created.length,4);assert.equal(result.reused.length,0);
});

test("two importer instances share the same browser-world write lock",async()=>{
  const f=testEnvironment(),first=new ImportService({env:f.env,adapter:f.adapter}),second=new ImportService({env:f.env,adapter:f.adapter});
  const plan=await first.prepare({entries:[feat()]});
  let release,entered;
  const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const save=f.adapter.saveHistory.bind(f.adapter);
  f.adapter.saveHistory=async value=>{entered();await waiting;return save(value);};
  const pending=first.commit(plan);await started;
  assert.equal(second.busy,true);
  await assert.rejects(second.commit(plan),/already running/);
  await assert.rejects(second.undo("anything"),/already running/);
  release();await pending;assert.equal(second.busy,false);
});

test("changes to the dependency graph or rules invalidate the preview",async()=>{
  const f=testEnvironment(),service=new ImportService({env:f.env,adapter:f.adapter});
  for(const mutate of [p=>p.nodes.at(-1).dependsOn.pop(),p=>p.nodes[0].entry.rules="2024",p=>p.roots.push(p.nodes[0].key)]){
    const plan=await service.prepare({entries:[classEntry()]});mutate(plan);
    await assert.rejects(service.commit(plan),/plan changed/);
  }
  assert.equal(f.store.Item.size,0);
});

test("invalid embedded creature actions block their parent actor",async()=>{
  const text=await readFile(new URL("../examples/training-creature.txt",import.meta.url),"utf8");
  const bundle=parseText(text);
  bundle.entries[0].features.push({kind:"feat",name:"Broken Save",mechanics:{save:{ability:"dex",dc:null,scaling:"flat"}}});
  const f=testEnvironment(),service=new ImportService({env:f.env,adapter:f.adapter});
  const plan=await service.prepare(bundle);
  assert.ok(plan.nodes[0].errors.some(e=>e.includes("Broken Save")));
  await assert.rejects(service.commit(plan),/printed DC/);assert.equal(f.store.Actor.size,0);
});

test("daily charges use day recovery rather than a long rest",()=>{
  const bundle=normalizeBundle({entries:[{kind:"feat",name:"Emergency Spark (2/Day)",text:"As an action, one creature takes 2d6 lightning damage."}]});
  assert.equal(compileBundle(bundle).nodes[0].data.system.uses.recovery[0].period,"day");
});

test("same-named effects retain their individual successful-save behavior",()=>{
  const bundle=normalizeBundle({entries:[{kind:"feat",name:"Two effects",mechanics:{save:{ability:"con",dc:12,scaling:"flat"},effects:[{name:"Mark",statuses:["blinded"],onSave:false},{name:"Mark",statuses:["prone"],onSave:true}]}}]});
  const activity=Object.values(compileBundle(bundle).nodes[0].data.system.activities)[0];
  assert.deepEqual(activity.effects.map(e=>e.onSave),[false,true]);
});

test("compendium indexes include importer edition and feature-context flags",async()=>{
  const f=testEnvironment();let fields=[];
  f.env.game.packs.set("test.journal",{collection:"test.journal",documentName:"JournalEntry",async getIndex(options){fields=options.fields;return {contents:[{_id:"journal",name:"Recovered Notes",flags:{[ID]:{rules:"2014"}}}]};}});
  const resolver=await new ContentResolver(f.env).load();
  assert.ok(fields.includes(`flags.${ID}.rules`));assert.ok(fields.includes(`flags.${ID}.featureContext`));
  assert.ok(resolver.pick({documentName:"JournalEntry",name:"Recovered Notes",rules:"2014"}).match);
});
test("undo keeps features reused as dependencies by a later batch",async()=>{
  const f=testEnvironment(),service=new ImportService({env:f.env,adapter:f.adapter});
  const first=await service.commit(await service.prepare({entries:[classEntry()]}));
  const originalClass=[...f.store.Item.values()].find(d=>d.type==="class");
  await originalClass.delete();
  const second=await service.commit(await service.prepare({entries:[classEntry()]}));
  assert.equal(second.created.length,1);assert.equal(second.reused.length,2);
  const result=await service.undo(first.id);
  assert.ok(result.skipped.every(item=>item.reason.includes("another import batch")));
  assert.equal(f.store.Item.size,3);
  await service.undo(second.id);await service.undo(first.id);
  assert.equal(f.store.Item.size,0);
});
