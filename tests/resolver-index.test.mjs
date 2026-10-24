import test from "node:test";
import assert from "node:assert/strict";
import {ContentResolver} from "../scripts/resolver.mjs";
import {ImportService} from "../scripts/importer.mjs";
import {ID} from "../scripts/constants.mjs";
import {testEnvironment,feat} from "./fixtures.mjs";

// Model the index projection boundary, not the complete Foundry database.
// Selecting both a parent and its child reproduces the reported "rules in 1".
function projectionFor(fields){
  const projection={};
  for(const path of fields){
    const parts=path.split(".");let target=projection;
    for(const part of parts.slice(0,-1)){if(!(part in target))target[part]={};target=target[part];}
    const last=parts.at(-1);if(!(last in target))target[last]=1;
  }
  return projection;
}
function getPath(object,path){return path.split(".").reduce((value,key)=>value?.[key],object);}
function setPath(object,path,value){
  const parts=path.split(".");let target=object;
  for(const key of parts.slice(0,-1))target=target[key]??={};
  target[parts.at(-1)]=structuredClone(value);
}
function projectedPack({documentName="Item",defaults=["_id","name","type","system.source"],records=[],exposeFields=true}={}){
  const pack={collection:"test.projected",documentName,visible:true,metadata:{label:"Projected reference content"},requests:[],reads:0,
    async getIndex({fields=[]}={}){
      this.requests.push(fields);
      const selected=[...new Set([...defaults,...fields])];
      projectionFor(selected);
      return {contents:records.map(record=>{
        const row={};
        for(const path of selected){const value=getPath(record,path);if(value!==undefined)setPath(row,path,value);}
        return row;
      })};
    },
    async getDocument(id){
      this.reads++;const data=records.find(r=>r._id===id);
      return data?{...structuredClone(data),uuid:`Compendium.${this.collection}.${documentName}.${id}`,toObject:()=>structuredClone(data)}:null;
    }
  };
  if(exposeFields)pack.indexFields=new Set(defaults);
  return pack;
}
const spell=(id,rules)=>({_id:id,name:"Reference Spell",type:"spell",system:{source:{rules}},flags:{}});

test("the projection fixture reproduces the exact reported overlapping-field error",()=>{
  assert.throws(()=>projectionFor(["system.source","system.source.rules"]),/Cannot use 'in' operator to search for 'rules' in 1/);
});

for(const version of ["5.3.3","6.0.6"]){
  test(`D&D5e ${version} item indexes preserve edition matching without overlapping source fields`,async()=>{
    const {env}=testEnvironment();env.game.system.version=version;
    const pack=projectedPack({records:[spell("old","2014"),spell("new","2024")]});env.game.packs.set(pack.collection,pack);
    const resolver=await new ContentResolver(env).load();
    assert.deepEqual(resolver.failures,[]);
    const old=resolver.pick({type:"spell",name:"Reference Spell",rules:"2014"});
    const modern=resolver.pick({type:"spell",name:"Reference Spell",rules:"2024"});
    assert.equal(old.match?.id,"old");assert.equal(modern.match?.id,"new");
    assert.equal(pack.reads,0);
    await resolver.document(old.match);assert.equal(pack.reads,1);
  });
}

for(const sourcePath of ["system.source","system.details.source"]){
  test(`actor indexes can already cover the whole ${sourcePath} field`,async()=>{
    const {env}=testEnvironment(),record={_id:"npc",name:"Reference Guard",type:"npc"};
    setPath(record,sourcePath,{rules:"2014"});
    const pack=projectedPack({documentName:"Actor",defaults:["_id","name","type",sourcePath],records:[record]});
    env.game.packs.set(pack.collection,pack);
    const resolver=await new ContentResolver(env).load();
    assert.deepEqual(resolver.failures,[]);
    assert.equal(resolver.pick({documentName:"Actor",type:"npc",name:record.name,rules:"2014"}).match?.id,"npc");
  });
}

for(const source of ["configuration","document metadata"]){
  test(`index coverage also reads ${source} when a pack does not expose indexFields`,async()=>{
    const {env}=testEnvironment();
    const pack=projectedPack({records:[spell("old","2014")],exposeFields:false});
    if(source==="configuration")env.CONFIG.Item={compendiumIndexFields:["system.source"]};
    else pack.documentClass={metadata:{compendiumIndexFields:["system.source"]}};
    env.game.packs.set(pack.collection,pack);
    const resolver=await new ContentResolver(env).load();
    assert.deepEqual(resolver.failures,[]);
    assert.equal(resolver.pick({type:"spell",name:"Reference Spell",rules:"2014"}).match?.id,"old");
  });
}

test("broad system and flags indexes retain importer rules and feature identity",async()=>{
  const {env}=testEnvironment();
  const record={_id:"feature",name:"Spellcasting",type:"feat",system:{type:{value:"class"},requirements:"Warden 1"},flags:{[ID]:{rules:"2014",featureContext:"class-feature:warden 1"}}};
  const pack=projectedPack({defaults:["_id","name","type","system","flags"],records:[record]});
  env.game.packs.set(pack.collection,pack);
  const resolver=await new ContentResolver(env).load();
  assert.deepEqual(resolver.failures,[]);
  assert.equal(resolver.pick({type:"feat",name:"Spellcasting",rules:"2014",context:"class-feature:warden 1"}).match?.id,"feature");
  assert.equal(resolver.pick({type:"feat",name:"Spellcasting",rules:"2014",context:"class-feature:other 1"}).match,null);
});

for(const documentName of ["JournalEntry","RollTable"]){
  test(`${documentName} packs request importer metadata without D&D system paths`,async()=>{
    const {env}=testEnvironment();
    const record={_id:"notes",name:"Imported Reference",flags:{[ID]:{rules:"2014"}}};
    const pack=projectedPack({documentName,defaults:["_id","name"],records:[record]});
    const getIndex=pack.getIndex;
    pack.getIndex=function(options){assert.ok(options.fields.every(path=>!path.startsWith("system.")&&path!=="type"));return getIndex.call(this,options);};
    env.game.packs.set(pack.collection,pack);
    const resolver=await new ContentResolver(env).load();
    assert.deepEqual(resolver.failures,[]);
    assert.equal(resolver.pick({documentName,name:record.name,rules:"2014"}).match?.id,"notes");
  });
}

test("an unreadable pack is reported while other compendiums remain matchable",async()=>{
  const {env}=testEnvironment();
  const good=projectedPack({records:[spell("old","2014")]});
  env.game.packs.set("test.unreadable",{collection:"test.unreadable",documentName:"Item",async getIndex(){throw Error("Unavailable reference pack");}});
  env.game.packs.set(good.collection,good);
  const resolver=await new ContentResolver(env).load();
  assert.equal(resolver.failures.length,1);assert.match(resolver.failures[0],/Unavailable reference pack/);
  assert.equal(resolver.pick({type:"spell",name:"Reference Spell",rules:"2014"}).match?.id,"old");
});

test("Analyze and Import reuse a projected 2014 compendium entry without creating a duplicate",async()=>{
  const f=testEnvironment(),record={_id:"referenceFeature",name:"Arc Spark",type:"feat",system:{source:{rules:"2014"}}};
  const pack=projectedPack({records:[record]});f.env.game.packs.set(pack.collection,pack);
  const service=new ImportService({env:f.env,adapter:f.adapter}),plan=await service.prepare({entries:[feat()]});
  assert.deepEqual(plan.resolver.failures,[]);
  assert.ok(plan.nodes[0].duplicate);
  const batch=await service.commit(plan);
  assert.equal(batch.created.length,0);assert.equal(batch.reused.length,1);
  assert.equal(f.store.Item.size,0);assert.equal(pack.reads,1);
});
