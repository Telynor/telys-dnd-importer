import {ABILITIES, DAMAGE_TYPES, ICONS, ID, SKILLS, VERSION} from "./constants.mjs";
import {clone, digest, normalizeName, number, paragraphHTML, randomID, slug, unique} from "./utils.mjs";
import {inferMultiattack} from "./mechanics.mjs";

const seconds={round:6,minute:60,hour:3600,day:86400};
export const documentNameFor = kind => ["creature","character"].includes(kind)?"Actor":kind==="journal"?"JournalEntry":kind==="table"?"RollTable":"Item";
export const documentTypeFor = kind => kind==="creature"?"npc":kind==="character"?"character":["journal","table"].includes(kind)?undefined:kind;
export function damagePart(part) {
  const basic=part.formula.match(/^(\d+)d(\d+)([+-].+)?$/i);
  return {number:basic?number(basic[1]):null,denomination:basic?number(basic[2]):null,bonus:basic?.[3]?.replace(/^\+/,"")??"",types:part.type?[part.type]:[],custom:{enabled:!basic,formula:basic?"":part.formula},scaling:part.scaling?{mode:part.scaling.mode,number:part.scaling.number,formula:part.scaling.formula??""}:{mode:"",number:1,formula:""}};
}
function usesData(uses) {
  return {spent:0,max:String(uses?.max??""),recovery:uses?.period?[{period:uses.period==="day"?"day":uses.period,type:"recoverAll",formula:uses.period==="recharge"?String(uses.recharge??6):""}]:[]};
}
function activityBase(entry,type,id=randomID()) {
  const m=entry.mechanics;
  const target={affects:{type:m.target?.type??(m.healing?"creature":""),count:m.target?.count!=null?String(m.target.count):"",choice:false,special:""},template:{type:m.target?.area??"",size:m.target?.size!=null?String(m.target.size):"",width:m.target?.width!=null?String(m.target.width):"",height:m.target?.height!=null?String(m.target.height):"",units:m.target?.units??"ft",count:m.target?.area?"1":"",contiguous:false,stationary:false}};
  const duration={value:m.duration?.value!=null?String(m.duration.value):"",units:m.duration?.units??"",concentration:m.duration?.concentration??false,override:entry.kind!=="spell"};
  const rangeValue=m.attack?.kind==="melee"?m.range?.reach??m.range?.value:m.range?.value;
  return {_id:id,type,name:entry.name,activation:{type:m.activation?.type??"action",value:m.activation?.value??1,condition:m.activation?.condition??"",override:entry.kind!=="spell"},consumption:{spellSlot:entry.kind==="spell"&&entry.item.level>0,targets:m.uses?.max?[{type:"itemUses",target:"",value:"1",scaling:{mode:"",formula:""}}]:[],scaling:{allowed:!!m.damage.find(d=>d.scaling)||!!m.healing?.scaling,max:""}},duration,range:{value:rangeValue!=null?String(rangeValue):"",units:m.range?.units??(m.attack?.kind==="melee"?"touch":"ft"),special:m.range?.special??"",override:entry.kind!=="spell"},target:{...target,override:entry.kind!=="spell",prompt:true},uses:{spent:0,max:"",recovery:[]},effects:[],flags:{[ID]:{generated:true}},otherActivityId:"none",midiProperties:{confirmTargets:"default",automationOnly:false,otherActivityCompatible:true,autoTargetType:"any",autoTargetAction:"default",magicDamage:entry.kind==="spell"||entry.item.magicalBonus>0,targetMustBeSeen:/\byou can see\b/i.test(entry.text)}};
}
export function compileEffect(effect,entry,warnings) {
  const changes=effect.changes.map(c=>({key:c.key,value:c.value,type:["custom","multiply","add","downgrade","upgrade","override"][c.mode]??"add",priority:c.priority}));
  const repeat=effect.repeat;
  if(repeat) {
    if(repeat.saveAbility&&repeat.saveDC===null)warnings.push(`${effect.name}: repeat-save automation omitted until a fixed source DC is supplied.`);
    else {
      const terms=[`turn=${repeat.turn}`,`label="${effect.name.replace(/[,#="\n]/g," ")}"`];
      if(repeat.damageRoll)terms.push(`damageRoll=${repeat.damageRoll}`,`damageType=${repeat.damageType||"none"}`);
      if(repeat.saveAbility){terms.push(`saveDC=${repeat.saveDC}`,`saveAbility=${repeat.saveAbility}`,`saveDamage=${{none:"nodamage",half:"halfdamage",full:"fulldamage"}[repeat.onSave]??"nodamage"}`);if(repeat.saveRemove)terms.push("saveCount=1-");else terms.push("saveRemove=false");}
      if(repeat.damageRoll||repeat.saveAbility)changes.push({key:"flags.midi-qol.OverTime",type:"custom",value:terms.join(","),priority:20});
    }
  }
  const duration=effect.duration?.value!=null?effect.duration:entry.mechanics.duration;
  const units={round:"rounds",minute:"minutes",hour:"hours",day:"days"};
  return {_id:randomID(),name:effect.name,img:entry.img||ICONS[entry.kind]||"icons/svg/aura.svg",description:paragraphHTML(entry.text),disabled:false,transfer:effect.transfer,statuses:clone(effect.statuses),system:{changes},duration:{value:duration?.value??null,units:units[duration?.units]??"seconds",expiry:null},flags:{[ID]:{generated:true,recipe:"effect"}}};
}

export function compileActivities(entry, data, warnings) {
  const m=entry.mechanics,activities={};
  const effects=m.effects.map(e=>compileEffect(e,entry,warnings));data.effects=effects;
  const applied=effects.flatMap((e,index)=>e.transfer?[]:[{_id:e._id,onSave:m.effects[index].onSave,level:{min:null,max:null}}]);
  const hasSave=!!m.save?.ability;
  let primary;
  if(m.attack) {
    primary=activityBase(entry,"attack");
    primary.attack={ability:m.attack.ability,bonus:m.attack.bonus!=null?String(m.attack.bonus):"",flat:m.attack.flat&&m.attack.bonus!=null,type:{value:m.attack.kind,classification:m.attack.classification},critical:{threshold:null}};
    primary.damage={includeBase:entry.kind==="weapon",critical:{bonus:""},parts:(entry.kind==="weapon"?m.damage.slice(1):m.damage).map(damagePart)};
    if(!hasSave)primary.effects=applied;
    activities[primary._id]=primary;
    if(m.attack.alternate){const alternate=clone(primary);alternate._id=randomID();alternate.name=`${entry.name} (${m.attack.kind==="melee"?"ranged":"melee"})`;alternate.attack.type.value=m.attack.kind==="melee"?"ranged":"melee";alternate.range.value=String(alternate.attack.type.value==="melee"?m.range?.reach??5:m.range?.value??0);activities[alternate._id]=alternate;}
  }
  if(hasSave) {
    const a=activityBase(entry,"save");
    a.save={ability:[m.save.ability],dc:{calculation:m.save.scaling==="flat"?"":m.save.scaling,formula:m.save.dc!=null?String(m.save.dc):""}};
    a.damage={onSave:m.save.onSave,parts:(m.attack?m.rider??[]:m.damage).map(damagePart)};a.effects=applied;
    if(primary) {
      a.name=`${entry.name}: saving throw`;a.midiProperties.automationOnly=true;
      a.activation={...a.activation,type:"none",value:null};a.consumption={...a.consumption,spellSlot:false,targets:[]};
      for(const activity of Object.values(activities))activity.otherActivityId=a._id;
    }else primary=a;
    activities[a._id]=a;
  }
  if(!primary&&m.damage.length){primary=activityBase(entry,"damage");primary.damage={critical:{allow:false,bonus:""},parts:m.damage.map(damagePart)};primary.effects=applied;activities[primary._id]=primary;}
  if(m.healing?.formula){const a=activityBase(entry,"heal");a.healing=damagePart(m.healing);a.effects=primary?[]:applied;activities[a._id]=a;primary??=a;}
  if(!primary&&(applied.length||m.activation?.type&&m.activation.type!=="none"||m.uses?.max)) {
    const a=activityBase(entry,"utility");a.effects=applied;a.roll={formula:"",name:"",prompt:false,visible:false};activities[a._id]=a;primary=a;
  }
  data.system.activities=activities;
  if(m.uses?.max)data.system.uses=usesData(m.uses);
  return {activities,effects};
}

function sourceData(entry){return {custom:entry.source.label||entry.source.url,book:entry.source.label,page:entry.source.page,rules:entry.rules};}
function provenance(entry){return {version:VERSION,source:clone(entry.source),sourceHash:digest(entry.text),sourceText:entry.text,kind:entry.kind,rules:entry.rules,generated:true};}
function baseData(entry,id){return {_id:id??randomID(),name:entry.name,img:entry.img||ICONS[entry.kind]||"icons/svg/item-bag.svg",flags:{[ID]:provenance(entry)}};}
function advancement(entry,childKeys) {
  const out=[],make=(type,configuration,level,title)=>({_id:randomID(),type,configuration,value:{},level,title});
  if(entry.kind==="class")out.push(make("HitPoints",{},0,"Hit Points"));
  if(entry.kind==="race"&&entry.heritage?.size){const sizes={tiny:"tiny",small:"sm",medium:"med",large:"lg",huge:"huge",gargantuan:"grg"};out.push(make("Size",{sizes:[sizes[entry.heritage.size]]},0,"Size"));}
  for(const t of entry.progression.traits){const a=make("Trait",{mode:"default",allowReplacements:false,grants:t.grants,choices:t.choices},t.level,t.title);if(t.classRestriction)a.classRestriction=t.classRestriction;out.push(a);}
  for(const s of entry.progression.scales) {
    const scale={};
    for(const [level,value]of Object.entries(s.values)){if(!/^\d+$/.test(level)||number(level)<1||number(level)>20)continue;
      if(s.type==="dice"){const d=String(value).match(/^(\d+)d(\d+)$/);if(d)scale[level]={number:number(d[1]),faces:number(d[2])};}
      else scale[level]={value:s.type==="number"?number(value):String(value).slice(0,200)};
    }
    out.push(make("ScaleValue",{identifier:s.identifier,type:s.type,distance:{units:""},scale},0,s.title));
  }
  for(const level of unique(entry.progression.asiLevels))out.push(make("AbilityScoreImprovement",{points:2,fixed:{str:0,dex:0,con:0,int:0,wis:0,cha:0},cap:20},level,"Ability Score Improvement"));
  for(const a of entry.progression.abilityScores??[])out.push(make("AbilityScoreImprovement",{points:a.points,fixed:clone(a.fixed),cap:a.cap},a.level,"Ability Score Increase"));
  const levels=new Map();
  for(const [i,feature]of entry.features.entries()) {
    if(feature.level==null&&["class","subclass"].includes(entry.kind))continue;
    if(/ability score improvement/i.test(feature.name)&&entry.progression.asiLevels.includes(feature.level))continue;
    const level=feature.level??0;if(!levels.has(level))levels.set(level,[]);levels.get(level).push({uuid:`@entry:${childKeys[i]}`,optional:false});
  }
  for(const [level,items]of levels)out.push(make("ItemGrant",{items,optional:false,spell:null},level,"Features"));
  return out;
}

export function compileItem(entry,{id,childKeys=[],base=null}={}) {
  const warnings=[...entry.warnings],data=baseData(entry,id),type=entry.kind;
  data.type=type;data.system={description:{value:paragraphHTML(entry.text),chat:""},source:sourceData(entry),identifier:slug(entry.name)};
  if(base&&["weapon","equipment","tool","consumable"].includes(type)) {
    // Base templates originate only from installed, rules-matched compendiums.
    data.system={...clone(base.system),...data.system};data.effects=clone(base.effects??[]);
    data.flags={...clone(base.flags??{}),...data.flags};if(!entry.img)data.img=base.img;
    delete data.system.container;delete data.system.sourceId;
  }
  const item=entry.item;
  if(["class","subclass","background","race","feat"].includes(type))data.system.advancement=advancement(entry,childKeys);
  if(type==="class")Object.assign(data.system,{hd:{denomination:item.hitDie||"d6",additional:"",spent:0},levels:1,spellcasting:{progression:item.spellcastingProgression,ability:item.spellcastingAbility,preparation:{formula:""}}});
  if(type==="subclass")Object.assign(data.system,{classIdentifier:item.classIdentifier,spellcasting:{progression:item.spellcastingProgression,ability:item.spellcastingAbility,preparation:{formula:""}}});
  if(type==="race")Object.assign(data.system,{movement:{...entry.heritage.movement,units:"ft"},senses:{ranges:clone(entry.heritage.senses),units:"ft"},type:{value:entry.heritage.creatureType||"humanoid"}});
  if(type==="spell")Object.assign(data.system,{level:item.level??0,school:item.school,properties:item.components,materials:{value:item.materials,cost:item.materialCost??0,consumed:item.materialConsumed,supply:0},method:"spell",prepared:0,activation:{type:entry.mechanics.activation?.type??"action",value:entry.mechanics.activation?.value??1,condition:entry.mechanics.activation?.condition??""},duration:{value:entry.mechanics.duration?.value!=null?String(entry.mechanics.duration.value):"",units:entry.mechanics.duration?.units??"inst"},range:{value:entry.mechanics.range?.value!=null?String(entry.mechanics.range.value):"",units:entry.mechanics.range?.units??"ft",special:entry.mechanics.range?.special??""},target:{template:{type:entry.mechanics.target?.area??"",size:entry.mechanics.target?.size!=null?String(entry.mechanics.target.size):"",units:entry.mechanics.target?.units??"ft"},affects:{type:entry.mechanics.target?.type??"creature",count:entry.mechanics.target?.count!=null?String(entry.mechanics.target.count):"",choice:false,special:""}}});
  if(type==="feat")Object.assign(data.system,{type:{value:entry.section?"monster":item.classIdentifier?"class":"feat",subtype:""},requirements:item.requirements,properties:[]});
  if(["weapon","equipment","consumable","tool","loot","container"].includes(type)) {
    Object.assign(data.system,{quantity:item.quantity,weight:{value:item.weight??base?.system?.weight?.value??0,units:"lb"},price:{value:item.price??base?.system?.price?.value??0,denomination:item.denomination},rarity:item.rarity||base?.system?.rarity||""});
    if(["weapon","equipment","consumable","tool"].includes(type))Object.assign(data.system,{attunement:item.attunement?"required":"",equipped:false,identified:true,properties:unique([...(base?.system?.properties??[]),...item.properties])});
  }
  if(type==="weapon") {
    data.system.type={value:item.subtype||base?.system?.type?.value||"simpleM",baseItem:slug(item.baseItem)};
    data.system.magicalBonus=item.magicalBonus!=null?String(item.magicalBonus):base?.system?.magicalBonus??"";
    if(item.magicalBonus>0)data.system.properties=unique([...data.system.properties,"mgc"]);
    data.system.range={value:entry.mechanics.range?.value??base?.system?.range?.value??null,long:entry.mechanics.range?.long??base?.system?.range?.long??null,reach:entry.mechanics.range?.reach??base?.system?.range?.reach??null,units:entry.mechanics.range?.units??"ft"};
    if(entry.mechanics.damage.length)data.system.damage={base:damagePart(entry.mechanics.damage[0]),versatile:base?.system?.damage?.versatile??damagePart({formula:""})};
    if(!data.system.damage?.base)warnings.push("Weapon base damage is missing. Supply a base item or a damage formula.");
  }
  if(type==="equipment") {data.system.type={value:item.subtype||base?.system?.type?.value||"wondrous",baseItem:slug(item.baseItem)};if(item.armor!=null)data.system.armor={value:item.armor,dex:item.dexCap,magicalBonus:""};}
  if(type==="consumable")data.system.type={value:item.subtype||base?.system?.type?.value||"potion",subtype:""};
  if(type==="tool"&&!data.system.type)data.system.type={value:item.subtype||"art",baseItem:slug(item.baseItem)};
  const activityTypes=["spell","weapon","equipment","consumable","tool","feat"];
  if(activityTypes.includes(type)) {
    const existingActivities=clone(base?.system?.activities??{}),existingEffects=clone(data.effects??[]);
    compileActivities(entry,data,warnings);
    if(!Object.keys(data.system.activities).length&&Object.keys(existingActivities).length){data.system.activities=existingActivities;data.effects=existingEffects;}
    else if(existingEffects.length)data.effects=[...existingEffects,...data.effects];
    if(type==="weapon"&&!Object.keys(data.system.activities).length&&data.system.damage?.base) {
      const a=activityBase(entry,"attack");a.attack={ability:"",bonus:"",flat:false,type:{value:data.system.type.value.endsWith("R")?"ranged":"melee",classification:"weapon"}};a.damage={includeBase:true,parts:[],critical:{bonus:""}};data.system.activities[a._id]=a;
    }
  } else if(entry.mechanics.effects.length)warnings.push("This item type uses advancement; its effects must be attached to granted feature items.");
  return {data,warnings:unique(warnings)};
}

function splitTrait(values,valid,warnings,label) {
  const result={value:[],custom:"",bypasses:[]},custom=[];
  for(const group of values) {
    if(/from|while|except|that (?:are|is)|nonmagical|silver|adamantine/i.test(group)){custom.push(group);warnings.push(`Conditional ${label} preserved as text: ${group}`);continue;}
    const parts=group.toLowerCase().split(/,|;|\band\b/).map(x=>x.trim()).filter(Boolean);
    for(const p of parts)valid.includes(p)?result.value.push(p):custom.push(p);
  }
  result.value=unique(result.value);result.custom=custom.join("; ");return result;
}
export function compileActor(entry,{id}={}) {
  const data=baseData(entry,id),s=entry.stats,warnings=[...entry.warnings];
  const size={tiny:"tiny",small:"sm",medium:"med",large:"lg",huge:"huge",gargantuan:"grg"}[s.size];
  data.type=entry.kind==="character"?"character":"npc";data.items=[];data.effects=[];
  data.system={abilities:{},attributes:{ac:{calc:"flat",flat:s.ac??10},hp:{value:s.hp,max:s.hp,temp:0,tempmax:0,formula:s.hpFormula},movement:{...s.movement,units:"ft"},senses:{ranges:Object.fromEntries(Object.entries(s.senses).filter(([k])=>k!=="special")),special:s.senses.special??"",units:"ft"},spellcasting:s.spellcasting},details:{biography:{value:paragraphHTML(entry.text),public:""},alignment:s.alignment,cr:s.cr,type:{value:s.creatureType,subtype:s.subtype,custom:""},source:sourceData(entry)},traits:{size,di:splitTrait(s.immunities,DAMAGE_TYPES,warnings,"damage immunity"),dr:splitTrait(s.resistances,DAMAGE_TYPES,warnings,"damage resistance"),dv:splitTrait(s.vulnerabilities,DAMAGE_TYPES,warnings,"damage vulnerability"),ci:splitTrait(s.conditionImmunities,["blinded","charmed","deafened","frightened","grappled","incapacitated","invisible","paralyzed","petrified","poisoned","prone","restrained","stunned","unconscious"],warnings,"condition immunity"),languages:{value:[],custom:s.languages.join(", ")}},skills:{},spells:{},resources:{legact:{max:s.legendaryActions,spent:0},legres:{max:s.legendaryResistances,spent:0},lair:{value:s.lair,inside:false,initiative:20}},source:sourceData(entry)};
  if(s.casterLevel!=null)data.system.attributes.spell={level:s.casterLevel};
  const proficiency=s.cr<5?2:s.cr<9?3:s.cr<13?4:s.cr<17?5:s.cr<21?6:s.cr<25?7:s.cr<29?8:9;
  for(const a of Object.values(ABILITIES)) {
    const value=s.abilities[a]??10,mod=Math.floor((value-10)/2),total=s.saves[a];
    const proficient=total==null?0:total-mod>=proficiency?1:0;
    data.system.abilities[a]={value,proficient,bonuses:{check:"",save:total==null?"":String(total-mod-proficient*proficiency)}};
  }
  for(const [label,total]of Object.entries(s.skills)) {
    const skill=SKILLS[label]??Object.values(SKILLS).find(v=>v[0]===label);if(!skill){warnings.push(`Unknown skill: ${label}`);continue;}
    const [key,ability]=skill,mod=Math.floor(((s.abilities[ability]??10)-10)/2);
    const value=total-mod>=2*proficiency?2:total-mod>=proficiency?1:0;
    data.system.skills[key]={value,ability,bonuses:{check:String(total-mod-value*proficiency),passive:""}};
  }
  for(const [level,slots]of Object.entries(s.spellSlots))data.system.spells[`spell${level}`]={value:slots,override:slots};
  const featureNames=entry.features.map(f=>f.name);
  for(const feature of entry.features) {
    const {data:item,warnings:w}=compileItem(feature);warnings.push(...w.map(x=>`${feature.name}: ${x}`));
    if(/^multiattack$/i.test(feature.name)) {
      const recipe=inferMultiattack(feature.text,featureNames);
      if(recipe){item.flags[ID].multiattack=recipe;warnings.push("Multiattack is programmed as a fixed sequence and prompts before rolling its child attacks.");}
      else warnings.push("Multiattack contains choices or an unrecognized sequence; use its attacks individually.");
      if(!Object.keys(item.system.activities).length){const a=activityBase(feature,"utility");a.roll={formula:"",name:"",prompt:false,visible:false};item.system.activities[a._id]=a;}
    }
    data.items.push(item);
  }
  const tokenSize={tiny:0.5,small:1,medium:1,large:2,huge:3,gargantuan:4}[s.size]??1;
  data.prototypeToken={name:entry.name,texture:{src:data.img},width:tokenSize,height:tokenSize,actorLink:entry.kind==="character",disposition:entry.kind==="character"?1:-1,bar1:{attribute:"attributes.hp"}};
  if(entry.kind==="character")warnings.push("Character class levels and player choices must be supplied through class advancement; NPC-style stat values alone do not create a leveled character.");
  return {data,warnings:unique(warnings)};
}

export function compileBundle(bundle,{bases=new Map()}={}) {
  const nodes=[],roots=[];
  function add(entry,parentKey="",parentEntry=null) {
    const key=parentKey?`${parentKey}/${entry.id}`:entry.id;
    const childKeys=!["creature","character"].includes(entry.kind)?entry.features.map(f=>add(f,key,entry)):[];
    const documentName=documentNameFor(entry.kind);let result;
    if(documentName==="Actor")result=compileActor(entry);
    else if(entry.kind==="journal")result={data:{...baseData(entry),pages:[{_id:randomID(),name:entry.name,type:"text",text:{format:1,content:paragraphHTML(entry.text)}}]},warnings:entry.warnings};
    else if(entry.kind==="table")result={data:{...baseData(entry),description:paragraphHTML(entry.text),formula:entry.formula,replacement:true,displayRoll:true,results:entry.rows.map(r=>({_id:randomID(),type:"text",name:r.text.slice(0,100),description:paragraphHTML(r.text),documentUuid:null,range:[r.min,r.max],weight:r.weight,drawn:false}))},warnings:entry.warnings};
    else result=compileItem(entry,{childKeys,base:bases.get(key)});
    if(parentEntry&&["class","subclass"].includes(parentEntry.kind)&&entry.kind==="feat"){
      result.data.system.type={value:"class",subtype:""};
      result.data.system.requirements=`${parentEntry.name}${entry.level!=null?` ${entry.level}`:""}`;
      result.data.flags[ID].featureContext=`class-feature:${normalizeName(result.data.system.requirements)}`;
    }else if(parentEntry&&entry.kind==="feat"){
      result.data.flags[ID].featureContext=`${parentEntry.kind}:${slug(parentEntry.name)}:${entry.level??0}`;
    }
    const errors=[...entry.errors];
    if(documentName==="Actor"){
      const check=feature=>{errors.push(...feature.errors.map(error=>`${feature.name}: ${error}`));feature.features.forEach(check);};
      entry.features.forEach(check);
    }
    nodes.push({key,parentKey,entry,documentName,type:documentTypeFor(entry.kind),data:result.data,dependsOn:childKeys,warnings:unique(result.warnings),errors,selected:true});
    return key;
  }
  for(const entry of bundle.entries)roots.push(add(entry));
  return {nodes,roots};
}
export function replaceReferences(value,uuids) {
  if(typeof value==="string"&&value.startsWith("@entry:")){const key=value.slice(7);if(!uuids.has(key))throw new Error(`Missing feature dependency: ${key}`);return uuids.get(key);}
  if(Array.isArray(value))return value.map(v=>replaceReferences(v,uuids));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replaceReferences(v,uuids)]));
  return value;
}
