import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {compileBundle} from "../scripts/compiler.mjs";
import {adaptDocumentForSystem,supportedSystem} from "../scripts/compatibility.mjs";
import {FoundryAdapter,ImportService,checkEnvironment} from "../scripts/importer.mjs";
import {parseText} from "../scripts/parser.mjs";
import {normalizeBundle} from "../scripts/schema.mjs";
import {testEnvironment,classEntry} from "./fixtures.mjs";
const creature=parseText(await readFile(new URL("../examples/training-creature.txt",import.meta.url),"utf8"));
const compile6=bundle=>compileBundle(bundle,{systemVersion:"6.0.6"});
function environment6(){const f=testEnvironment();f.env.game.system.version="6.0.6";f.env.game.modules.get("midi-qol").version="14.6.0";return f;}

test("the released manifest allows the user's D&D5e 6.0.6 and Midi-QOL 14.6.0",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../module.json",import.meta.url),"utf8"));
  assert.equal(manifest.relationships.systems[0].compatibility.maximum,"6.999");
  assert.equal(manifest.relationships.requires[0].compatibility.maximum,"14.999");
  assert.deepEqual(checkEnvironment(environment6().env),[]);
});
test("version checks reject missing, malformed, too-old, and next-major systems",()=>{
  for(const v of [undefined,"","5","5.x.y","5.2.9","5.3.2","4.4.4","7.0.0"])assert.equal(supportedSystem(v),false,String(v));
  for(const v of ["5.3.3","5.4.0","6.0.0","6.0.6"])assert.equal(supportedSystem(v),true,v);
});
test("D&D5e 6 rejects Midi-QOL 14.0 instead of silently offering broken automation",()=>{
  const {env}=environment6();env.game.modules.get("midi-qol").version="14.0.15";
  assert.ok(checkEnvironment(env).some(x=>x.includes("requires Midi-QOL 14.6")));
});
test("D&D5e 5 retains its previous Midi-QOL release line",()=>{
  const {env}=testEnvironment();assert.deepEqual(checkEnvironment(env),[]);
  env.game.modules.get("midi-qol").version="14.6.0";
  assert.ok(checkEnvironment(env).some(x=>x.includes("requires the Midi-QOL 14.0 line")));
});
test("D&D5e 6 fixed AC and movement use persisted fields",()=>{
  const actor=compile6(creature).nodes[0].data;
  assert.equal(actor.system.attributes.ac.override,16);
  assert.equal(actor.system.attributes.ac.calc,undefined);
  assert.equal(actor.system.attributes.movement.speeds.climb,"20");
  assert.equal(actor.system.attributes.movement.walk,undefined);
  assert.equal(actor.system.source.rules,"2014");
});
test("D&D5e 6 keeps non-proficiency saving throw and skill bonuses",()=>{
  const b=structuredClone(creature);b.entries[0].stats.saves.con=7;b.entries[0].stats.skills.perception=6;
  const actor=compile6(b).nodes[0].data;
  assert.equal(actor.system.abilities.con.proficient,1);
  assert.equal(actor.system.abilities.con.save.roll.bonus,"2");
  assert.equal(actor.system.abilities.con.bonuses,undefined);
  assert.equal(actor.system.skills.prc.value,2);
  assert.equal(actor.system.skills.prc.roll.bonus,"0");
  assert.equal(actor.system.skills.prc.bonuses.check,undefined);
});
test("D&D5e 6 class advancements retain names, levels, and feature dependencies",()=>{
  const plan=compile6(normalizeBundle({entries:[classEntry()]})),s=plan.nodes.at(-1).data.system;
  assert.equal(Array.isArray(s.advancement),false);
  const all=Object.values(s.advancement),grants=all.filter(x=>x.type==="ItemGrant");
  assert.equal(all[0].name,"Hit Points");assert.equal(all[0].title,undefined);
  assert.deepEqual(grants.map(x=>x.level),[1,2]);
  assert.ok(grants.every(x=>x.configuration.items[0].uuid.startsWith("@entry:")));
});
test("D&D5e 6 race movement and ASI advancement retain supplied values",()=>{
  const s=compile6(normalizeBundle({entries:[{kind:"race",name:"Ashborn",heritage:{size:"medium",movement:{walk:30}},progression:{abilityScores:[{level:0,fixed:{str:2,con:1},points:0,cap:20}]}}]})).nodes[0].data.system;
  assert.equal(s.movement.speeds.walk,"30");
  assert.equal(Object.values(s.advancement).find(a=>a.type==="AbilityScoreImprovement").configuration.fixed.str,2);
});
test("D&D5e 6 equipment rarity preserves existing templates and explicit overrides",()=>{
  const b=normalizeBundle({entries:[{kind:"equipment",name:"Moon Ring",item:{rarity:"rare"}}]});
  assert.deepEqual(compile6(b).nodes[0].data.system.rarities,["rare"]);
  const data={system:{rarity:"",rarities:["rare","veryRare"]}};adaptDocumentForSystem(data,"6.0.6");
  assert.deepEqual(data.system.rarities,["rare","veryRare"]);assert.equal(data.system.rarity,undefined);
});
test("D&D5e 6 converts supported passive effect keys without altering Midi-QOL flags",()=>{
  const keys=["system.abilities.dex.bonuses.save","system.bonuses.mwak.attack","system.bonuses.rsak.damage","system.bonuses.abilities.check","system.attributes.movement.fly","flags.midi-qol.OverTime"];
  const data={effects:[{system:{changes:keys.map(key=>({key,value:"2"}))}}]};adaptDocumentForSystem(data,"6.0.6");
  assert.deepEqual(data.effects[0].system.changes.map(c=>c.key),["system.abilities.dex.save.roll.bonus","system.rolls.attack.mwak.bonus","system.rolls.damage.rsak.bonus","system.rolls.ability.check.bonus","system.attributes.movement.speeds.fly","flags.midi-qol.OverTime"]);
});
test("D&D5e 6 linked attack/save activities retain effect references and consumption",()=>{
  const item=compile6(creature).nodes[0].data.items.find(i=>i.name==="Spark Bolt");
  const activities=Object.values(item.system.activities),attack=activities.find(a=>a.type==="attack"),save=activities.find(a=>a.type==="save");
  assert.equal(attack.otherActivityId,save._id);assert.equal(save.effects[0]._id,item.effects[0]._id);
  assert.equal(save.consumption.spellSlot,false);assert.equal(save.save.dc.formula,"12");
  assert.ok(activities.every(a=>a.duration.units));
});
test("D&D5e 5 document fields remain in their existing format",()=>{
  const actor=compileBundle(creature,{systemVersion:"5.3.3"}).nodes[0].data;
  assert.equal(actor.system.attributes.ac.calc,"flat");assert.equal(actor.system.attributes.ac.override,undefined);
  assert.equal(actor.system.attributes.movement.climb,20);assert.ok(actor.system.abilities.con.bonuses);
});
test("D&D5e 6 preflight validates real-shaped UUIDs, then commits destination UUIDs and supports undo",async()=>{
  const f=environment6();let validations=0;
  f.adapter.validate=async node=>{
    for(const a of Object.values(node.data.system?.advancement??{}))for(const item of a.configuration.items??[]){assert.match(item.uuid,/^Item\.[A-Za-z0-9]{16}$/);validations++;}
    return structuredClone(node.data);
  };
  const service=new ImportService({env:f.env,adapter:f.adapter}),plan=await service.prepare({entries:[classEntry()]});
  assert.ok(plan.nodes.every(n=>!n.errors.length));assert.equal(validations,2);
  const result=await service.commit(plan),classDoc=[...f.store.Item.values()].find(d=>d.type==="class");
  const grants=Object.values(classDoc.system.advancement).filter(a=>a.type==="ItemGrant");
  for(const a of grants)assert.ok(await f.adapter.resolve(a.configuration.items[0].uuid));
  assert.equal(classDoc.system.source.rules,"2014");
  await service.undo(result.id);assert.equal(f.store.Item.size,0);
});
function cleaningAdapter(clean){return new FoundryAdapter({CONFIG:{Item:{documentClass:class{
  constructor(data){this.data=structuredClone(data);clean(this.data);}validate(){return true;}toObject(){return this.data;}
}}}});}
test("preflight blocks advancement removal even if the document claims to validate",async()=>{
  const node=compile6(normalizeBundle({entries:[classEntry()]})).nodes.at(-1);
  await assert.rejects(cleaningAdapter(d=>{d.system.advancement={};}).validate(node),/advancement was removed/);
});
test("preflight blocks loss of a printed AC or saving throw bonus",async()=>{
  const node=compile6(creature).nodes[0];
  const make=clean=>new FoundryAdapter({CONFIG:{Actor:{documentClass:class{constructor(data){this.data=structuredClone(data);clean(this.data);}validate(){return true;}toObject(){return this.data;}}}}});
  await assert.rejects(make(d=>{delete d.system.attributes.ac.override;}).validate(node),/Fixed armor class/);
  await assert.rejects(make(d=>{delete d.system.abilities.con.save.roll.bonus;}).validate(node),/Saving throw bonus con/);
});
