import {ABILITIES, CONDITIONS, DAMAGE_TYPES, KINDS, MAX_ENTRIES, MAX_TEXT} from "./constants.mjs";
import {asArray, cleanText, number, rejectDangerousKeys, safeFormula, safeImagePath, slug, unique} from "./utils.mjs";
import {abilityKey, inferMechanics} from "./mechanics.mjs";

const str=(v,max=1000)=>String(v??"").trim().slice(0,max);
const choice=(v,values,fallback="")=>values.includes(v)?v:fallback;
const nullableNumber=(v,min=0,max=1_000_000)=>v===null||v===undefined||v===""||!Number.isFinite(number(v,NaN))?null:number(v,0,min,max);
export function allowedEffectKey(key) {
  return /^(?:system\.abilities\.(?:str|dex|con|int|wis|cha)\.(?:value|bonuses\.(?:check|save))|system\.attributes\.(?:ac\.bonus|movement\.(?:walk|fly|swim|climb|burrow))|system\.bonuses\.(?:(?:mwak|rwak|msak|rsak)\.(?:attack|damage)|abilities\.(?:check|save|skill)|spell\.dc)|system\.traits\.(?:di|dr|dv|ci)\.value|flags\.midi-qol\.(?:(?:advantage|disadvantage)\.(?:attack\.(?:all|mwak|rwak|msak|rsak)|ability\.(?:save|check)\.(?:all|str|dex|con|int|wis|cha))|(?:magicResistance|magicVulnerability)\.all|(?:critical|fail|success)\.(?:all|attack\.all)|(?:max|grants)\.damage\.all))$/.test(key);
}
function normalizeEffect(raw,index,warnings) {
  const changes=[];
  for(const c of asArray(raw.changes).slice(0,30)) {
    const key=str(c?.key,160);
    if(!allowedEffectKey(key)){warnings.push(`Effect change ${key||"(empty)"} needs a supported recipe; it was not imported.`);continue;}
    let value=str(c.value,200);
    if(/(?:[<>;`{}]|(?:function|constructor|eval)\b)/i.test(value)){warnings.push(`Unsupported value for ${key}; change omitted.`);continue;}
    changes.push({key,value,mode:number(c.mode,2,0,5),priority:number(c.priority,20,0,100)});
  }
  const duration=raw.duration??{};
  const result={name:str(raw.name,200)||`Effect ${index+1}`,statuses:unique(asArray(raw.statuses).filter(x=>CONDITIONS.includes(x))),changes,transfer:raw.transfer===true,onSave:raw.onSave===true,duration:{value:nullableNumber(duration.value,0,100000),units:choice(duration.units,["round","minute","hour","day","inst","perm"]),concentration:duration.concentration===true}};
  if(raw.repeat) {
    const r=raw.repeat;
    result.repeat={turn:choice(r.turn,["start","end"],"end"),saveAbility:abilityKey(r.saveAbility),saveDC:nullableNumber(r.saveDC,0,99),saveRemove:r.saveRemove===true,damageRoll:safeFormula(r.damageRoll),damageType:choice(r.damageType,DAMAGE_TYPES),onSave:choice(r.onSave,["none","half","full"],"none")};
    if(result.repeat.saveAbility&&result.repeat.saveDC===null)warnings.push("Repeat-save effect has no fixed DC and will require manual configuration.");
  }
  return result;
}
export function normalizeMechanics(raw={},warnings=[]) {
  const m={damage:[],effects:[]};
  if(raw.activation)m.activation={type:choice(raw.activation.type,["action","bonus","reaction","legendary","mythic","lair","minute","hour","special","none"],"action"),value:number(raw.activation.value,1,0,100),condition:str(raw.activation.condition)};
  if(raw.range)m.range={value:nullableNumber(raw.range.value),long:nullableNumber(raw.range.long),reach:nullableNumber(raw.range.reach),units:choice(raw.range.units,["ft","mi","m","km","self","touch","spec","any"],"ft"),special:str(raw.range.special)};
  if(raw.target)m.target={type:choice(raw.target.type,["creature","ally","enemy","object","self","willing","any"],"creature"),count:nullableNumber(raw.target.count,0,10000),area:choice(raw.target.area,["cone","line","cube","sphere","cylinder","radius","wall"]),size:nullableNumber(raw.target.size),width:nullableNumber(raw.target.width),height:nullableNumber(raw.target.height),units:choice(raw.target.units,["ft","mi","m","km"],"ft")};
  if(raw.duration)m.duration={value:nullableNumber(raw.duration.value,0,100000),units:choice(raw.duration.units,["round","minute","hour","day","inst","perm","spec"]),concentration:raw.duration.concentration===true};
  if(raw.attack)m.attack={kind:choice(raw.attack.kind,["melee","ranged"],"melee"),classification:choice(raw.attack.classification,["weapon","spell","unarmed"],"weapon"),bonus:nullableNumber(raw.attack.bonus,-99,99),ability:choice(raw.attack.ability,[...Object.values(ABILITIES),"spellcasting","none"],"none"),flat:raw.attack.flat===true,alternate:raw.attack.alternate===true};
  if(raw.save){const a=abilityKey(raw.save.ability);if(!a)warnings.push("Saving throw ability is missing.");m.save={ability:a,dc:nullableNumber(raw.save.dc,0,99),scaling:choice(raw.save.scaling,["flat","spellcasting",...Object.values(ABILITIES)],raw.save.dc!=null?"flat":"spellcasting"),onSave:choice(raw.save.onSave,["none","half","full"],"none")};}
  const part=d=>({formula:safeFormula(d.formula),type:choice(d.type,[...DAMAGE_TYPES,"healing","temphp"]),scaling:d.scaling?{mode:choice(d.scaling.mode,["whole","half"]),number:number(d.scaling.number,1,0,100),formula:safeFormula(d.scaling.formula)}:undefined});
  m.damage=asArray(raw.damage).slice(0,20).map(part).filter(p=>p.formula);
  if(raw.rider)m.rider=asArray(raw.rider).slice(0,20).map(part).filter(p=>p.formula);
  if(raw.healing)m.healing={...part(raw.healing),type:raw.healing.type==="temphp"?"temphp":"healing"};
  if(raw.uses)m.uses={max:safeFormula(raw.uses.max==null?"":String(raw.uses.max)),period:choice(raw.uses.period,["sr","lr","day","dawn","dusk","recharge"]),recharge:nullableNumber(raw.uses.recharge,2,6)};
  m.effects=asArray(raw.effects).slice(0,30).map((e,i)=>normalizeEffect(e??{},i,warnings));
  return m;
}
export function normalizeEntry(raw, {rules="2014",index=0,depth=0}={}) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error(`Entry ${index+1} must be an object.`);
  if(depth>3)throw new Error("Features may be nested at most three levels deep.");
  const aliases={npc:"creature",monster:"creature",item:"equipment",feature:"feat",species:"race",ancestry:"race",magicitem:"equipment",rolltable:"table"};
  const kind=aliases[raw.kind]??raw.kind;
  if(!KINDS.includes(kind))throw new Error(`Unknown content type: ${String(kind)}.`);
  const name=str(raw.name,200);if(!name)throw new Error(`Entry ${index+1} needs a name.`);
  const text=cleanText(raw.text??raw.description).slice(0,MAX_TEXT);
  const isParent=["creature","character","class","subclass","race","background"].includes(kind);
  const inferred=isParent?{mechanics:{},warnings:[],tags:[]}:inferMechanics(text,{kind,name,section:raw.section,spell:kind==="spell"});
  const warnings=asArray(raw.warnings).map(x=>str(x,500)).slice(0,40);
  // Inference is advisory. Explicit structured fields replace matching inferred fields.
  const mechanics=normalizeMechanics({...inferred.mechanics,...(raw.mechanics??{})},warnings);
  warnings.push(...inferred.warnings);
  const entry={id:str(raw.id,100)||`${slug(name)||kind}-${index+1}`,kind,name,rules:choice(raw.rules,["2014","2024"],rules),text,img:safeImagePath(raw.img),source:{label:str(raw.source?.label??raw.source?.book,300),url:str(raw.source?.url,2048),page:str(raw.source?.page,50)},confidence:raw.confidence==null?1:number(raw.confidence,1,0,1),level:nullableNumber(raw.level,0,20),section:str(raw.section,60),mechanics,features:[],spells:[],warnings,errors:[],tags:inferred.tags,stats:{},item:{},progression:{}};
  const stats=raw.stats??{};
  if(["creature","character"].includes(kind)) {
    const abilities={};for(const a of Object.values(ABILITIES)){const score=number(stats.abilities?.[a]?.value??stats.abilities?.[a],NaN);if(Number.isInteger(score)&&score>=1&&score<=30)abilities[a]=score;}
    entry.stats={ac:nullableNumber(stats.ac,0,99),hp:nullableNumber(stats.hp),hpFormula:safeFormula(stats.hpFormula),size:choice(stats.size,["tiny","small","medium","large","huge","gargantuan"],"medium"),creatureType:str(stats.creatureType??"humanoid",100).toLowerCase(),subtype:str(stats.subtype,100),alignment:str(stats.alignment,100),cr:typeof stats.cr==="string"&&/^\d+\/\d+$/.test(stats.cr)?Number(stats.cr.split("/")[0])/Number(stats.cr.split("/")[1]):number(stats.cr,0,0,100),abilities,saves:{},skills:{},movement:{},senses:{},languages:asArray(stats.languages).map(x=>str(x,100)),resistances:asArray(stats.resistances).map(x=>str(x,300)),immunities:asArray(stats.immunities).map(x=>str(x,300)),vulnerabilities:asArray(stats.vulnerabilities).map(x=>str(x,300)),conditionImmunities:asArray(stats.conditionImmunities).map(x=>str(x,100)),spellcasting:abilityKey(stats.spellcasting),spellDC:nullableNumber(stats.spellDC,0,99),spellAttack:nullableNumber(stats.spellAttack,-99,99),casterLevel:nullableNumber(stats.casterLevel,0,30),legendaryActions:number(stats.legendaryActions,0,0,20),legendaryResistances:number(stats.legendaryResistances,0,0,20),lair:stats.lair===true,spellSlots:{}};
    for(const a of Object.values(ABILITIES))if(stats.saves?.[a]!=null)entry.stats.saves[a]=number(stats.saves[a],0,-30,50);
    for(const [k,v]of Object.entries(stats.skills??{}).slice(0,30))entry.stats.skills[k.toLowerCase()]=number(v,0,-30,50);
    for(const k of ["walk","fly","swim","climb","burrow"])if(stats.movement?.[k]!=null)entry.stats.movement[k]=number(stats.movement[k],0,0,10000);
    entry.stats.movement.hover=stats.movement?.hover===true;
    for(const k of ["darkvision","blindsight","tremorsense","truesight"])if(stats.senses?.[k]!=null)entry.stats.senses[k]=number(stats.senses[k],0,0,10000);
    entry.stats.senses.special=str(stats.senses?.special,300);
    for(let l=1;l<=9;l++)if(stats.spellSlots?.[l]!=null)entry.stats.spellSlots[l]=number(stats.spellSlots[l],0,0,100);
    entry.spells=asArray(raw.spells).slice(0,200).map(s=>typeof s==="string"?{name:str(s,200),mode:"",uses:null,level:null}:{name:str(s.name,200),mode:choice(s.mode,["innate","atwill","prepared","pact"],""),uses:nullableNumber(s.uses,0,100),level:nullableNumber(s.level,0,9)}).filter(s=>s.name);
    if(kind==="creature"&&(entry.stats.ac===null||entry.stats.hp===null))entry.errors.push("Creature AC and HP must be supplied.");
    if(Object.keys(abilities).length<6)entry.errors.push("Supply all six ability scores; unknown scores are not replaced with invented values.");
    if(Object.keys(entry.stats.skills).some(k=>k.length>40))entry.errors.push("A skill name exceeds the supported length.");
  }
  const item=raw.item??{};
  entry.item={level:nullableNumber(item.level,0,9),school:str(item.school,30),components:asArray(item.components).filter(x=>["vocal","somatic","material","ritual","concentration"].includes(x)),materials:str(item.materials,1000),materialCost:nullableNumber(item.materialCost),materialConsumed:item.materialConsumed===true,rarity:choice(item.rarity,["common","uncommon","rare","veryRare","legendary","artifact","varies"]),attunement:item.attunement===true,baseItem:str(item.baseItem,100),subtype:str(item.subtype,100),armor:nullableNumber(item.armor,0,50),dexCap:nullableNumber(item.dexCap,0,10),magicalBonus:nullableNumber(item.magicalBonus,0,10),weight:nullableNumber(item.weight),price:nullableNumber(item.price),denomination:choice(item.denomination,["cp","sp","ep","gp","pp"],"gp"),quantity:number(item.quantity,1,0,100000),properties:asArray(item.properties).filter(x=>/^[a-zA-Z0-9]+$/.test(x)).slice(0,30),requirements:str(item.requirements,500),classIdentifier:slug(item.classIdentifier),hitDie:/^d(?:6|8|10|12)$/.test(item.hitDie)?item.hitDie:"",spellcastingAbility:abilityKey(item.spellcastingAbility),spellcastingProgression:choice(item.spellcastingProgression,["none","full","half","third","pact","artificer"],"none")};
  if(kind==="spell"&&entry.item.level===null)entry.errors.push("Spell level is missing (use 0 for a cantrip).");
  if(kind==="spell"&&!/^(abj|con|div|enc|evo|ill|nec|trs)$/.test(entry.item.school))entry.errors.push("Spell school is missing or invalid.");
  if(kind==="class"&&!entry.item.hitDie)entry.errors.push("Class hit die is missing (d6, d8, d10, or d12).");
  if(kind==="subclass"&&!entry.item.classIdentifier)entry.errors.push("Subclass parent class identifier is required.");
  if(mechanics.save?.scaling==="flat"&&mechanics.save.dc===null)entry.errors.push("A fixed saving throw requires its printed DC.");
  if(mechanics.attack?.flat&&mechanics.attack.bonus===null)entry.errors.push("A fixed attack requires its printed to-hit bonus.");
  entry.features=asArray(raw.features).slice(0,MAX_ENTRIES).map((f,i)=>normalizeEntry({...f,kind:f.kind??"feat",rules:f.rules??entry.rules,source:f.source??entry.source},{rules:entry.rules,index:i,depth:depth+1}));
  const p=raw.progression??{};
  entry.progression={traits:asArray(p.traits).slice(0,40).map(t=>({title:str(t.title,200),level:number(t.level,1,0,20),classRestriction:choice(t.classRestriction,["primary","secondary"]),grants:asArray(t.grants).map(x=>str(x,150)).filter(x=>/^(?:armor|weapon|saves|skills|languages|tool|dr|di|dv|ci):[a-zA-Z0-9:*:_-]+$/.test(x)),choices:asArray(t.choices).map(c=>({count:number(c.count,1,1,20),pool:asArray(c.pool).map(x=>str(x,150)).filter(x=>/^(?:armor|weapon|skills|languages|tool):[a-zA-Z0-9:*:_-]+$/.test(x))}))})),scales:asArray(p.scales).slice(0,30).map(s=>({identifier:slug(s.identifier??s.title),title:str(s.title,200),type:choice(s.type,["number","dice","string"],"number"),values:s.values??{}})),asiLevels:asArray(p.asiLevels).map(v=>number(v,0,1,20))};
  entry.progression.abilityScores=asArray(p.abilityScores).slice(0,20).map(a=>({level:number(a.level,0,0,20),points:number(a.points,0,0,6),cap:number(a.cap,20,1,30),fixed:Object.fromEntries(Object.values(ABILITIES).map(k=>[k,number(a.fixed?.[k],0,0,6)]))}));
  const heritage=raw.heritage??{};
  entry.heritage={size:choice(heritage.size,["tiny","small","medium","large","huge","gargantuan"]),creatureType:str(heritage.creatureType,100),movement:{},senses:{}};
  for(const k of ["walk","fly","swim","climb","burrow"])if(heritage.movement?.[k]!=null)entry.heritage.movement[k]=number(heritage.movement[k],0,0,10000);
  for(const k of ["darkvision","blindsight","tremorsense","truesight"])if(heritage.senses?.[k]!=null)entry.heritage.senses[k]=number(heritage.senses[k],0,0,10000);
  entry.rows=asArray(raw.rows).slice(0,1000).map((r,i)=>({text:str(r.text,3000),min:number(r.min,i+1,1,100000),max:number(r.max,r.min??i+1,1,100000),weight:number(r.weight,1,1,100000)}));
  entry.formula=safeFormula(raw.formula,`1d${Math.max(1,entry.rows.at(-1)?.max??entry.rows.length)}`);
  if(kind==="table"&&!entry.rows.length)entry.errors.push("Roll table has no rows.");
  if(entry.confidence<0.8)warnings.push("Extraction confidence is below 80%; compare this entry with the source.");
  const actionable=mechanics.attack||mechanics.save||mechanics.damage.length||mechanics.healing||mechanics.effects.length;
  if(!actionable&&!entry.features.length&&!["journal","table","class","subclass","container","loot","tool","facility"].includes(kind))warnings.push("No supported mechanical rule was recognized; the full description is preserved for review.");
  entry.warnings=unique(warnings);return entry;
}
export function normalizeBundle(raw,{rules="2014"}={}) {
  rejectDangerousKeys(raw);
  const list=Array.isArray(raw)?raw:raw?.entries;
  if(!Array.isArray(list)||!list.length)throw new Error("The import must contain a nonempty entries array.");
  if(list.length>MAX_ENTRIES)throw new Error(`Import at most ${MAX_ENTRIES} entries at a time.`);
  const entries=list.map((e,index)=>normalizeEntry(e,{rules,index}));
  const ids=new Set();let total=0;
  function visit(e){if(++total>1000)throw new Error("Import has more than 1,000 entries including features.");if(ids.has(e.id))e.id=`${e.id}-${total}`;ids.add(e.id);e.features.forEach(visit);}
  entries.forEach(visit);
  return {schemaVersion:1,entries,warnings:asArray(raw.warnings).map(x=>str(x,500))};
}
