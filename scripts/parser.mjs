import {ABILITIES, DAMAGE_TYPES, SCHOOLS, SKILLS, MAX_TEXT} from "./constants.mjs";
import {abilityKey, inferMechanics, parseDuration} from "./mechanics.mjs";
import {normalizeBundle} from "./schema.mjs";
import {cleanText, number, parseJSONResponse, slug, unique} from "./utils.mjs";

const words={one:1,two:2,three:3,four:4,five:5,six:6};
const metadata=/^(?:Armor Class|AC\b|Hit Points|HP\b|Speed\b|STR\b|DEX\b|CON\b|INT\b|WIS\b|CHA\b|Saving Throws|Skills\b|Damage (?:Vulnerabilities|Resistances|Immunities)|Condition Immunities|Senses\b|Languages\b|Challenge\b|CR\b|Proficiency Bonus|Initiative\b)/i;
const sections=/^(Actions|Bonus Actions|Reactions|Legendary Actions|Mythic Actions|Lair Actions|Traits)\s*:?$/i;
const sectionCanonical=s=>s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
function lineValue(text,label){return text.match(new RegExp(`^${label}\\s*:?\\s*(.+)$`,"im"))?.[1]?.trim()??"";}
function stripMarkdown(text){return text.replace(/^\s*>\s?/gm,"").replace(/^\s*#{1,6}\s+/gm,"").replace(/\*\*\*|\*\*|__/g,"").replace(/<br\s*\/?>/gi,"\n");}
function basic(raw,kind){const text=stripMarkdown(cleanText(raw));const lines=text.split("\n").map(x=>x.trim()).filter(Boolean);return {name:lines[0]?.replace(/^\[[^\]]+\]\s*/,"").trim()??"Untitled",kind,text,features:[],warnings:[]};}

export function guessKind(text) {
  if(/^(?:Armor Class|AC)\s*:?\s*\d+/im.test(text)&&/^(?:Hit Points|HP)\s*:?\s*\d+/im.test(text))return "creature";
  if(/\b(?:\d(?:st|nd|rd|th)?[- ]level\s+(?:abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)|(?:abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)\s+cantrip)\b/i.test(text))return "spell";
  if(/Hit Dice\s*:\s*1?d(?:6|8|10|12)/i.test(text))return "class";
  const marker=text.match(/^\[(class|subclass|race|species|background|feat|spell|weapon|equipment|consumable|tool|loot|container|facility|journal|table)\]/i)?.[1]?.toLowerCase();
  if(marker)return marker==="species"?"race":marker;
  if(/^(?:Weapon|Armor|Wondrous item|Potion|Ring|Rod|Staff|Wand|Scroll)\b[^\n]*\b(?:common|uncommon|rare|legendary|artifact)\b/im.test(text)) {
    if(/^Weapon\b/im.test(text))return "weapon";
    if(/^(?:Potion|Scroll)\b/im.test(text))return "consumable";
    return "equipment";
  }
  if(/^Prerequisites?\s*:/im.test(text))return "feat";
  return "";
}

export function splitFeatures(text,{startSection="Traits",classFeatures=false}={}) {
  const out=[];let section=startSection,current=null,level=null;
  for(const sourceLine of text.split("\n")) {
    const line=sourceLine.trim().replace(/^[-*]\s+/,"");if(!line){if(current)current.text+="\n";continue;}
    const sectionMatch=line.match(sections);if(sectionMatch){section=sectionCanonical(sectionMatch[1]);current=null;continue;}
    if(metadata.test(line) || /^(?:STR\s+DEX|\d+\s*\([+-]?\d+\)(?:\s+\d+\s*\([+-]?\d+\)){2,})/.test(line)){current=null;continue;}
    let title,body="",featureLevel=level;
    const lv=line.match(/^(?:Level\s+(\d+)\s*[:.-]\s*(.+)|(.+?)\s*\((?:Level\s*)?(\d+)(?:st|nd|rd|th)?[- ]level\))$/i)
      ?? line.match(/^(.+?)\s*\(Level\s+(\d+)\)$/i);
    if(classFeatures&&lv){
      if(lv.length>=5){featureLevel=number(lv[1]??lv[4]);title=lv[2]??lv[3];}
      else{title=lv[1];featureLevel=number(lv[2]);}
      level=featureLevel;
    }else{
      const h=line.match(/^([A-Z][A-Za-z0-9'’+,: /-]*(?:\([^\n)]*\))?)\.\s+(.+)$/);
      const isTitle=s=>s.replace(/\([^)]*\)/g,"").trim().split(/\s+/).every(w=>/^[A-Z0-9]/.test(w)||/^(?:of|the|and|or|with|a|an|in|to|at|as|on|per|for|from)$/.test(w));
      if(h&&h[1].length<=100&&isTitle(h[1])){title=h[1];body=h[2];}
      else if(classFeatures&&/^[A-Z][A-Za-z'’ +()-]{2,75}$/.test(line)&&isTitle(line)&&!/^Hit Points|Proficiencies|Equipment|Class Features|Spellcasting Ability|Cantrips|Spells Known/i.test(line)){title=line;}
    }
    if(title){current={name:title.trim(),kind:"feat",section,text:body,level:featureLevel};out.push(current);}
    else if(current)current.text+=(current.text?"\n":"")+line;
  }
  return out.filter(f=>f.text.trim()).map(f=>({...f,text:f.text.trim(),...inferMechanics(f.text,{name:f.name,section:f.section})}));
}

function parseCreature(raw) {
  const entry=basic(raw,"creature"),text=entry.text;
  const header=text.match(/^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([a-zA-Z -]+?)(?:\s*\(([^)]+)\))?\s*,\s*(.+)$/im);
  const hp=text.match(/^(?:Hit Points|HP)\s*:?\s*([\d,]+)(?:\s*\(([^)]+)\))?/im);
  const ac=text.match(/^(?:Armor Class|AC)\s*:?\s*(\d+)/im);
  const stats={ac:ac?number(ac[1]):null,hp:hp?number(hp[1]):null,hpFormula:hp?.[2]?.replace(/\s+/g,"")??"",size:header?.[1]?.toLowerCase()??"medium",creatureType:header?.[2]?.toLowerCase()??"humanoid",subtype:header?.[3]??"",alignment:header?.[4]??"",abilities:{},saves:{},skills:{},movement:{},senses:{},languages:[],spellSlots:{}};
  for(const [name,key] of Object.entries(ABILITIES)) {
    const m=text.match(new RegExp(`\\b(?:${key.toUpperCase()}|${name})\\s*:?\\s*(\\d+)\\s*\\(`,"i"));if(m)stats.abilities[key]=number(m[1]);
  }
  if(Object.keys(stats.abilities).length<6){
    const after=text.match(/STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA\s*\n([\s\S]{0,250})/i)?.[1];
    if(after){const scores=Array.from(after.matchAll(/(\d+)\s*\(\s*[+-]?\d+\s*\)/g)).slice(0,6);if(scores.length===6)Object.values(ABILITIES).forEach((key,i)=>stats.abilities[key]=number(scores[i][1]));}
  }
  const speed=lineValue(text,"Speed");
  const walk=speed.match(/^(\d+)\s*(?:ft|feet)/i);if(walk)stats.movement.walk=number(walk[1]);
  for(const mode of ["fly","swim","climb","burrow"]){const s=speed.match(new RegExp(`\\b${mode}\\s+(\\d+)`,"i"));if(s)stats.movement[mode]=number(s[1]);}
  stats.movement.hover=/hover/i.test(speed);
  const saves=lineValue(text,"Saving Throws");for(const s of saves.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\s*([+-]\s*\d+)/gi))stats.saves[s[1].toLowerCase()]=number(s[2].replace(/\s/g,""));
  const skills=lineValue(text,"Skills");for(const name of Object.keys(SKILLS)){const m=skills.match(new RegExp(`\\b${name}\\s*([+-]\\s*\\d+)`,"i"));if(m)stats.skills[name]=number(m[1].replace(/\s/g,""));}
  for(const [label,key]of [["Damage Resistances","resistances"],["Damage Immunities","immunities"],["Damage Vulnerabilities","vulnerabilities"],["Condition Immunities","conditionImmunities"]]) {
    const val=lineValue(text,label);stats[key]=val?val.split(/;\s*/).map(s=>s.trim()):[];
  }
  const senses=lineValue(text,"Senses");for(const sense of ["darkvision","blindsight","tremorsense","truesight"]){const m=senses.match(new RegExp(`${sense}\\s+(\\d+)`,"i"));if(m)stats.senses[sense]=number(m[1]);}
  if(/blind beyond|deaf|can't see|cannot see/i.test(senses))stats.senses.special=senses;
  stats.languages=lineValue(text,"Languages").split(/,\s*/).filter(x=>x&&!/^[-—]$/.test(x));
  const cr=lineValue(text,"(?:Challenge|CR)").match(/^(\d+(?:\/\d+)?)/)?.[1];stats.cr=cr??0;
  stats.legendaryActions=number(text.match(/can take\s+(\d+)\s+legendary actions/i)?.[1],0);
  stats.legendaryResistances=number(text.match(/Legendary Resistance\s*\((\d+)\s*\/\s*Day\)/i)?.[1],0);
  stats.lair=/^Lair Actions\s*$/im.test(text);
  const casting=text.match(/spellcasting ability is (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i);stats.spellcasting=abilityKey(casting?.[1]);
  stats.spellDC=text.match(/spell save DC\s*(\d+)/i)?.[1]??null;
  stats.spellAttack=text.match(/([+-]\d+)\s+to hit with spell attacks/i)?.[1]??null;
  stats.casterLevel=text.match(/(\d+)(?:st|nd|rd|th)[- ]level spellcaster/i)?.[1]??null;
  const metaEnd=[...text.matchAll(/^(?:Challenge|CR|Proficiency Bonus)\b[^\n]*/gim)].at(-1);
  const featuresText=metaEnd?text.slice(metaEnd.index+metaEnd[0].length):text;
  entry.features=splitFeatures(featuresText);
  entry.spells=[];
  for(const line of text.split("\n")) {
    const spellLine=line.trim().replace(/^[-*]\s*/,"").match(/^(Cantrips?\s*\(at will\)|At will|\d+\s*\/\s*day(?: each)?|\d+(?:st|nd|rd|th)\s+level\s*\(\d+ slots?\))\s*:\s*(.+)/i);
    if(!spellLine)continue;
    const head=spellLine[1],level=head.match(/^(\d+)(?:st|nd|rd|th)/)?.[1];
    const slots=head.match(/\((\d+) slots?\)/)?.[1];if(level&&slots)stats.spellSlots[level]=number(slots);
    const uses=head.match(/^(\d+)\s*\/\s*day/)?.[1];
    for(const n of spellLine[2].split(/,\s*/)){const name=n.replace(/\([^)]*\)/g,"").replace(/[*.]/g,"").trim();if(name)entry.spells.push({name,mode:uses?"innate":/at will|cantrip/i.test(head)?"atwill":"prepared",uses:uses?number(uses):null,level:/cantrip/i.test(head)?0:level?number(level):null});}
    if(/\([^)]*\)/.test(spellLine[2]))entry.warnings.push("Spell-specific restrictions are preserved in Spellcasting; check those spell activities after import.");
  }
  if(!header)entry.warnings.push("Creature type/size line was not recognized; check the default humanoid/medium values.");
  if(!entry.features.length)entry.warnings.push("No named actions or traits were found. Check line breaks in the source.");
  if(/\b(?:feet|ft\.?)/i.test(speed)===false&&speed)entry.warnings.push("Non-foot movement units require review.");
  entry.stats=stats;return entry;
}

function parseSpell(raw) {
  const entry=basic(raw,"spell"),text=entry.text;
  const school=Object.keys(SCHOOLS).find(s=>new RegExp(`\\b${s}\\b`,"i").test(text.split("\n").slice(1,4).join(" ")));
  const level=/\bcantrip\b/i.test(text.split("\n").slice(1,4).join(" "))?0:number(text.match(/(\d)(?:st|nd|rd|th)?[- ]level/i)?.[1],NaN);
  const components=lineValue(text,"Components"),duration=lineValue(text,"Duration"),range=lineValue(text,"Range"),activation=lineValue(text,"Casting Time");
  entry.item={level:Number.isNaN(level)?null:level,school:SCHOOLS[school]??"",components:[],materials:components.match(/\((.+)\)/)?.[1]??"",materialCost:number(components.match(/(?:worth|at least)\s+(\d[\d,]*)\s*gp/i)?.[1],0),materialConsumed:/consum/i.test(components)};
  for(const [re,property]of [[/\bV\b/,"vocal"],[/\bS\b/,"somatic"],[/\bM\b/,"material"]])if(re.test(components))entry.item.components.push(property);
  if(/ritual/i.test(text.split("\n").slice(1,4).join(" ")))entry.item.components.push("ritual");
  const inferred=inferMechanics(text,{kind:"spell",name:entry.name,spell:true});
  entry.mechanics={...inferred.mechanics,duration:parseDuration(duration),activation:{type:/bonus action/i.test(activation)?"bonus":/reaction/i.test(activation)?"reaction":/minute/i.test(activation)?"minute":/hour/i.test(activation)?"hour":"action",value:number(activation.match(/^\d+/)?.[0],1),condition:activation.replace(/^\d+\s+(?:bonus action|action|reaction|minutes?|hours?)\s*,?\s*/i,"")}};
  if(/concentration/i.test(duration))entry.item.components.push("concentration");
  if(/^Self\b/i.test(range))entry.mechanics.range={units:"self"};
  else if(/^Touch\b/i.test(range))entry.mechanics.range={units:"touch"};
  else {const r=range.match(/(\d+)\s*(feet|foot|ft|miles?|meters?)/i);if(r)entry.mechanics.range={value:number(r[1]),units:/mile/i.test(r[2])?"mi":/meter/i.test(r[2])?"m":"ft"};}
  const area=range.match(/(\d+)[ -]foot\s+(cone|line|cube|sphere|radius)/i);if(area)entry.mechanics.target={area:area[2]==="radius"?"sphere":area[2],size:number(area[1]),type:"creature",units:"ft"};
  // Only uniform per-slot increases can be compiled without a table or special recipe.
  const scaling=text.match(/(?:damage|healing|hit points)[^.]{0,100}(?:increases? by|additional)\s+(\d+)d(\d+)[^.]{0,100}for each slot level/i);
  if(scaling){for(const part of [...entry.mechanics.damage,...(entry.mechanics.healing?[entry.mechanics.healing]:[])])if(part.formula.includes(`d${scaling[2]}`))part.scaling={mode:"whole",number:number(scaling[1])};}
  if(level===0&&/5th level|level 5/i.test(text))entry.warnings.push("Cantrip level scaling needs a dedicated scaling formula or an installed spell match.");
  entry.warnings.push(...inferred.warnings);return entry;
}

function parseClass(raw,kind) {
  const entry=basic(raw,kind),text=entry.text;
  entry.item={hitDie:text.match(/Hit Dice\s*:\s*1?(d(?:6|8|10|12))/i)?.[1]??"",classIdentifier:lineValue(text,"(?:Parent Class|Class Identifier)"),spellcastingAbility:abilityKey(text.match(/(?:spellcasting ability is|Spellcasting Ability\s*:)\s*(\w+)/i)?.[1]),spellcastingProgression:lineValue(text,"Spellcasting Progression").toLowerCase()||"none"};
  const marker=text.match(/^Class Features\s*$/im);
  const firstLevel=text.match(/^Level\s+\d+\s*[:.-]/im);
  const featureText=marker?text.slice(marker.index+marker[0].length):firstLevel?text.slice(firstLevel.index):text.split("\n").slice(1).join("\n");
  entry.features=splitFeatures(featureText,{classFeatures:true});
  entry.progression={traits:[],asiLevels:[]};
  const saves=lineValue(text,"Saving Throws").split(/,| and /i).map(x=>abilityKey(x.trim())).filter(Boolean);
  if(saves.length)entry.progression.traits.push({title:"Saving throw proficiencies",level:1,classRestriction:"primary",grants:saves.map(k=>`saves:${k}`)});
  const armor=lineValue(text,"Armor"),weapons=lineValue(text,"Weapons");
  const grants=[];
  for(const [re,key]of [[/light/i,"lgt"],[/medium/i,"med"],[/heavy/i,"hvy"],[/shields?/i,"shl"]])if(re.test(armor))grants.push(`armor:${key}`);
  if(/simple/i.test(weapons))grants.push("weapon:sim");if(/martial/i.test(weapons))grants.push("weapon:mar");
  if(grants.length)entry.progression.traits.push({title:"Armor and weapon proficiencies",level:1,classRestriction:"primary",grants});
  const skillLine=lineValue(text,"Skills"),count=skillLine.match(/choose\s+(one|two|three|four|five|six|\d+)/i)?.[1];
  const skillPool=Object.entries(SKILLS).filter(([label])=>new RegExp(`\\b${label}\\b`,"i").test(skillLine)).map(([,v])=>`skills:${v[0]}`);
  if(count&&skillPool.length)entry.progression.traits.push({title:"Skill proficiencies",level:1,classRestriction:"primary",choices:[{count:words[count.toLowerCase()]??number(count),pool:skillPool}]});
  entry.progression.asiLevels=entry.features.filter(f=>/ability score improvement/i.test(f.name)&&f.level!=null).map(f=>f.level);
  if(entry.features.some(f=>f.level==null))entry.warnings.push("Some class features lack an explicit level; assign their levels in the review JSON to create advancement grants.");
  if(/spellcasting/i.test(text)&&entry.item.spellcastingProgression==="none"&&!/^Spellcasting Progression\s*:\s*none/im.test(text))entry.warnings.push("Spellcasting progression is unspecified; set full, half, third, pact, or artificer in the review JSON.");
  if(/\|/.test(text))entry.warnings.push("Verify class table values. Custom scaling tables should be supplied through progression.scales.");
  return entry;
}

function parseItem(raw,kind) {
  const entry=basic(raw,kind),text=entry.text;
  const header=text.split("\n").slice(1,4).join(" ");
  const rarity=header.match(/\b(very rare|uncommon|common|rare|legendary|artifact)\b/i)?.[1]?.toLowerCase();
  const base=header.match(/(?:Weapon|Armor)\s*\(([^)]+)\)/i)?.[1];
  entry.item={rarity:rarity==="very rare"?"veryRare":rarity??"",attunement:/requires attunement/i.test(header),baseItem:base??lineValue(text,"Base Item"),subtype:/^Potion\b/im.test(text)?"potion":/^Scroll\b/im.test(text)?"scroll":"",armor:nullableLine(text,"Armor Class"),weight:nullableLine(text,"Weight"),requirements:lineValue(text,"Prerequisites?"),magicalBonus:null};
  const bonus=text.match(/\+(\d)\s+bonus to (?:attack and damage|damage and attack) rolls/i)?.[1]??entry.name.match(/\+(\d)\b/)?.[1];if(kind==="weapon"&&bonus)entry.item.magicalBonus=number(bonus);
  const price=lineValue(text,"(?:Cost|Price)").match(/([\d,]+)\s*(cp|sp|ep|gp|pp)/i);if(price){entry.item.price=number(price[1]);entry.item.denomination=price[2].toLowerCase();}
  const inferred=inferMechanics(text,{name:entry.name,kind});entry.mechanics=inferred.mechanics;entry.warnings.push(...inferred.warnings);
  if(kind==="equipment") {
    const acBonus=text.match(/\+(\d)\s+bonus to (?:AC|Armor Class)/i);
    if(acBonus)entry.mechanics.effects.push({name:`${entry.name}: AC bonus`,transfer:true,statuses:[],changes:[{key:"system.attributes.ac.bonus",mode:2,value:acBonus[1]}]});
  }
  if(["race","background"].includes(kind)){
    entry.features=splitFeatures(text.split("\n").slice(1).join("\n"),{classFeatures:true});
    entry.progression={traits:[],abilityScores:[]};
    const skillNames=lineValue(text,"Skill Proficiencies");
    const grants=Object.entries(SKILLS).filter(([label])=>new RegExp(`\\b${label}\\b`,"i").test(skillNames)).map(([,v])=>`skills:${v[0]}`);
    if(grants.length)entry.progression.traits.push({title:"Skill proficiencies",level:0,grants});
    if(kind==="race"){
      entry.heritage={movement:{},senses:{},size:text.match(/your size is (Tiny|Small|Medium|Large|Huge|Gargantuan)/i)?.[1]?.toLowerCase()??""};
      const speed=text.match(/base walking speed is\s+(\d+)\s+feet/i);if(speed)entry.heritage.movement.walk=number(speed[1]);
      const dark=text.match(/Darkvision[\s\S]{0,200}?within\s+(\d+)\s+feet/i);if(dark)entry.heritage.senses.darkvision=number(dark[1]);
      const asi=entry.features.find(f=>/ability score increase/i.test(f.name));
      if(asi&&!/\bor\b/i.test(asi.text)){const fixed={};for(const a of asi.text.matchAll(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?: score)?\s+(?:increases by|is increased by)\s+(\d+)/gi))fixed[abilityKey(a[1])]=number(a[2]);if(Object.keys(fixed).length)entry.progression.abilityScores.push({level:0,points:0,cap:20,fixed});}
    }
  }
  if(kind==="table") {
    entry.rows=[];
    for(const line of text.split("\n").slice(1)) {
      const r=line.replace(/^\||\|$/g,"").trim().match(/^(\d+)(?:\s*-\s*(\d+))?\s*(?:\||[.)]|\s{2,})\s*(.+)$/);
      if(r)entry.rows.push({min:number(r[1]),max:number(r[2]??r[1]),text:r[3].trim()});
    }
    entry.formula=text.match(/^Roll\s*:\s*(\d+d\d+)/im)?.[1]??`1d${entry.rows.at(-1)?.max??1}`;
  }
  return entry;
}
function nullableLine(text,label){const m=lineValue(text,label).match(/^[\d,]+/);return m?number(m[0]):null;}

export function parseText(raw,{kind="auto",rules="2014",source={}}={}) {
  const text=cleanText(raw);
  if(!text)throw new Error("Paste some content, attach images, or enter web links first.");
  if(text.length>MAX_TEXT)throw new Error(`Source text exceeds ${MAX_TEXT.toLocaleString()} characters; split the import into smaller batches.`);
  if(/^[\[{]/.test(text)&&!/^\[(?:class|subclass|race|species|background|feat|spell|weapon|equipment|consumable|tool|loot|container|facility|journal|table)\]/i.test(text))return normalizeBundle(parseJSONResponse(text),{rules});
  const chunks=text.split(/\n\s*(?:-{3,}|={3,}|\[NEXT\])\s*\n/).filter(x=>x.trim());
  const entries=chunks.map((chunk,index)=>{
    const detected=kind==="auto"?guessKind(chunk):kind;
    if(!detected)throw new Error(`Could not determine content type for entry ${index+1}. Choose its type or use model extraction. Separate entries with a line containing ---.`);
    const e=["creature","character"].includes(detected)?parseCreature(chunk):detected==="spell"?parseSpell(chunk):["class","subclass"].includes(detected)?parseClass(chunk,detected):parseItem(chunk,detected);
    e.kind=detected;
    e.id=`${slug(e.name)}-${index+1}`;e.rules=rules;e.source=source;return e;
  });
  return normalizeBundle({schemaVersion:1,entries},{rules});
}
