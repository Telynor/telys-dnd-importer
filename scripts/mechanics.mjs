import {ABILITIES, DAMAGE_TYPES, CONDITIONS} from "./constants.mjs";
import {cleanText, number, unique} from "./utils.mjs";

export const abilityKey = value => ABILITIES[String(value??"").toLowerCase()] ?? (/^(str|dex|con|int|wis|cha)$/.test(String(value))?String(value):"");
const formulaPattern = "(?:\\d+d\\d+(?:\\s*[+-]\\s*(?:\\d+|your spellcasting ability modifier))?|\\d+)";
export function parseDuration(text) {
  const s=String(text??"");
  const m=s.match(/(?:up to\s+)?(\d+)\s+(round|minute|hour|day)s?/i);
  const units={round:"round",minute:"minute",hour:"hour",day:"day"};
  return {value:m?number(m[1]):null,units:m?units[m[2].toLowerCase()]:/instantaneous/i.test(s)?"inst":/until dispelled|permanent/i.test(s)?"perm":"",concentration:/concentration/i.test(s)};
}
export function inferMechanics(raw, {kind="feat", name="", section="", spell=false}={}) {
  const text=cleanText(raw), warnings=[], tags=[];
  const m={effects:[], damage:[]};
  const attack=text.match(/\b(Melee(?: or Ranged)?|Ranged(?: or Melee)?)\s+(Weapon|Spell)\s+Attack\s*:\s*([+-]?\d+)\s+to hit/i);
  const spellAttack=text.match(/\b(melee|ranged)\s+spell attack/i);
  if(attack || spellAttack) {
    m.attack={kind:(attack?.[1]??spellAttack[1]).toLowerCase().startsWith("ranged")?"ranged":"melee",classification:(attack?.[2]??"spell").toLowerCase(),ability:spell||(!attack&&spellAttack)?"spellcasting":"none",bonus:attack?number(attack[3]):null,flat:!!attack,alternate:!!attack?.[1].includes(" or ")};
    tags.push("attack");
  }
  const save=text.match(/\bDC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i)
    ?? text.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+(?:saving throw|save)\s*\(DC\s*(\d+)\)/i);
  const dynamicSave=text.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i);
  const saveKinds=new Set(Array.from(text.matchAll(/\bDC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/gi),x=>`${x[1]}:${x[2].toLowerCase()}`));
  if(saveKinds.size>1)warnings.push("Multiple different saving throws need separate activities; the local parser extracts the first one.");
  if(save || (spell && dynamicSave)) {
    const reversed=save && !/^\d+$/.test(save[1]);
    m.save={ability:abilityKey(save?(reversed?save[1]:save[2]):dynamicSave[1]),dc:save?number(reversed?save[2]:save[1]):null,scaling:save?"flat":"spellcasting",onSave:/half as much|half the damage|half damage/i.test(text)?"half":/same damage|full damage on a success/i.test(text)?"full":"none"};
    tags.push("save");
  }
  const range=text.match(/\brange\s+(\d+)(?:\s*\/\s*(\d+))?\s*(?:ft\.?|feet)/i);
  const reach=text.match(/\breach\s+(\d+)\s*(?:ft\.?|feet)/i);
  if(range||reach) m.range={value:range?number(range[1]):null,long:range?.[2]?number(range[2]):null,reach:reach?number(reach[1]):null,units:"ft"};
  const area=text.match(/\b(\d+)[ -](?:foot|ft\.?)[ -]*(?:radius[ -]*)?(cone|line|cube|sphere|cylinder|radius)/i);
  if(area){m.target={area:area[2].toLowerCase()==="radius"?"sphere":area[2].toLowerCase(),size:number(area[1]),units:"ft",type:"creature",count:null};tags.push("template");}
  else if(/\b(?:one target|one creature|a creature|the target)\b/i.test(text)) m.target={type:"creature",count:1};
  const damageRE=new RegExp(`(?:\\b\\d+\\s*\\(\\s*)?(${formulaPattern})\\s*\\)?\\s+(${DAMAGE_TYPES.join("|")})\\s+damage`,"gi");
  const allDamage=[];
  for(const d of text.matchAll(damageRE)) {
    const before=text.slice(Math.max(0,d.index-150),d.index);
    const after=text.slice(d.index+d[0].length,d.index+d[0].length+100);
    const dot=/(?:at the (?:start|end)|starts? (?:each of |its )?(?:turn)|ends? (?:each of |its )?(?:turn))[\s\S]{0,120}$/i.test(before)||/^\s+at the (?:start|end) of (?:each|its|their)/i.test(after);
    const alternative=/\bor\s+(?:\d+\s*\(\s*)?$/i.test(before) || /if used with two hands|when used with two hands/i.test(text.slice(d.index,d.index+d[0].length+100));
    const conditional=/(?:on a critical hit|if the target is|if the creature is|when the target is|while|unless|otherwise)[^.]{0,120}$/i.test(before);
    const formula=d[1].replace(/your spellcasting ability modifier/gi,"@mod").replace(/\s+/g,"");
    allDamage.push({formula,type:d[2].toLowerCase(),index:d.index,dot,alternative,conditional});
  }
  const saveIndex=save?.index??dynamicSave?.index??Infinity;
  const seen=new Set();
  for(const d of allDamage.filter(x=>!x.dot&&!x.alternative&&!x.conditional)) {
    const group=m.attack&&m.save&&d.index>saveIndex?"rider":"damage";
    const key=`${group}:${d.formula}:${d.type}`;if(seen.has(key))continue;seen.add(key);
    (m[group]??=[]).push({formula:d.formula,type:d.type});
  }
  if(m.damage.length || m.rider?.length) tags.push("damage");
  if(allDamage.some(x=>x.alternative)) warnings.push("Alternative damage (such as a two-handed attack) needs a separate activity or an existing base weapon.");
  if(allDamage.some(x=>x.conditional))warnings.push("Conditional or critical-hit damage was preserved in the description and was not added to every hit.");
  const heal=text.match(new RegExp(`(?:regains?|restores?|heals?)\\s+(?:hit points equal to\\s+)?(?:\\d+\\s*\\(\\s*)?(${formulaPattern})\\s*\\)?\\s*(?:\\+\\s*your spellcasting ability modifier\\s*)?hit points`,"i"));
  if(heal){m.healing={formula:heal[1].replace(/your spellcasting ability modifier/gi,"@mod").replace(/\s/g,"")+(/\+\s*your spellcasting ability modifier/i.test(heal[0])&&!/modifier/i.test(heal[1])?"+@mod":""),type:"healing"};tags.push("healing");}
  const temp=text.match(/gains?\s+(\d+d\d+(?:\s*[+]\s*\d+)?|\d+)\s+temporary hit points/i);
  if(temp){m.healing={formula:temp[1].replace(/\s/g,""),type:"temphp"};tags.push("temporary HP");}
  if(/\byou (?:gain|regain)\b/i.test(text)&&m.healing)m.target={type:"self",count:1};
  const activationType={"Actions":"action","Bonus Actions":"bonus","Reactions":"reaction","Legendary Actions":"legendary","Mythic Actions":"mythic","Lair Actions":"lair"}[section];
  const activationValue=name.match(/Costs?\s+(\d+)\s+Actions?/i)?.[1];
  if(activationType || /as (?:an?|your) (?:action|bonus action|reaction)/i.test(text)) m.activation={type:activationType??(/bonus action/i.test(text)?"bonus":/reaction/i.test(text)?"reaction":"action"),value:activationValue?number(activationValue):1};
  const uses=name.match(/\((\d+)\s*\/\s*(day|short rest|long rest)\)/i) ?? text.match(/(?:can use this (?:feature|ability)|can do so)\s+(\d+)\s+times[^.]{0,60}?(long rest|day)/i);
  const recharge=name.match(/Recharge\s*(\d)(?:\s*-\s*6)?/i);
  if(recharge)m.uses={max:1,period:"recharge",recharge:number(recharge[1])};
  else if(uses)m.uses={max:number(uses[1]),period:{"short rest":"sr","long rest":"lr",day:"day"}[uses[2]?.toLowerCase()]??"lr"};
  if(m.uses)tags.push("uses/recharge");
  const conditionRE=new RegExp(`(?:\\b(?:target|creature)\\s+(?:is|becomes)|\\b(?:or be|is knocked|knocked|become))\\s+(?:also\\s+)?(${CONDITIONS.join("|")})\\b`,"gi");
  const statuses=unique(Array.from(text.matchAll(conditionRE),x=>x[1].toLowerCase()));
  if(/\bknocked prone\b/i.test(text)&&!statuses.includes("prone"))statuses.push("prone");
  const repeat=text.match(/(?:repeat (?:the|this) saving throw|makes? (?:the|this|another) saving throw)[^.]{0,130}(?:at the )?(start|end) of (?:each of )?(?:its|their|the target's) turns?/i);
  const ongoing=allDamage.find(x=>x.dot);
  if(statuses.length || ongoing || repeat) {
    const effect={name:name||"Imported effect",statuses,changes:[],duration:parseDuration(text.match(/for\s+(\d+\s+(?:round|minute|hour|day)s?)/i)?.[1]??""),onSave:false};
    if(repeat||ongoing){
      const turn=repeat?.[1]?.toLowerCase()??(/end of/i.test(text.slice(Math.max(0,ongoing.index-150),ongoing.index))?"end":"start");
      effect.repeat={turn,saveAbility:repeat?m.save?.ability:"",saveDC:repeat?m.save?.dc:null,saveRemove:!!repeat};
      if(ongoing)Object.assign(effect.repeat,{damageRoll:ongoing.formula,damageType:ongoing.type});
      if(repeat&&!m.save?.dc)warnings.push("Repeat-save DC needs the source spell DC; set it in the review JSON before importing.");
      tags.push("Midi OverTime");
    }
    if(/until the (?:start|end) of/i.test(text))warnings.push("Turn-relative effect expiration requires manual duration configuration.");
    if(/if .*immune|if .*not .*immune|unless|while .*within/i.test(text))warnings.push("Check conditional eligibility for this effect.");
    m.effects.push(effect);if(statuses.length)tags.push("conditions");
  }
  if(/advantage on saving throws against spells(?: and other magical effects)?/i.test(text)&&/^Magic Resistance$/i.test(name)){
    m.effects.push({name,transfer:true,statuses:[],changes:[{key:"flags.midi-qol.magicResistance.all",mode:5,value:"true"}]});tags.push("magic resistance");
  }
  if(m.healing && m.attack)warnings.push("An attack with healing needs separate target/damage handling; review both activities.");
  if(/\b(?:choose|roll a d\d|summon|teleport|transform|polymorph|random|aura|once per turn|once on each|advantage|disadvantage|reduced by|increases? by|bonus to)\b/i.test(text))warnings.push("Choice, positioning, conditional bonuses, or special timing may require a dedicated automation recipe.");
  if(/\bMultiattack\b/i.test(name))warnings.push("Multiattack resolves only fixed, unambiguous named attack sequences.");
  return {mechanics:m,warnings:unique(warnings),tags:unique(tags)};
}

export function inferMultiattack(text, featureNames) {
  const word={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6};
  if(/\bor\b|can replace|in place of|either|different|choice/i.test(text))return null;
  const recipe=[];
  for(const name of featureNames) {
    if(/^multiattack$/i.test(name))continue;
    const simple=name.replace(/\s*\([^)]*\)/g,"").toLowerCase();
    const esc=simple.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const r=new RegExp(`\\b(a|an|one|two|three|four|five|six|[1-6])\\s+(?:attacks?\\s+with\\s+its\\s+)?${esc}(?:s| attacks?)?\\b`,"i");
    const match=text.match(r);if(match)recipe.push({name,count:word[match[1].toLowerCase()]??number(match[1])});
  }
  const total=recipe.reduce((s,x)=>s+x.count,0);
  const announced=text.match(/makes?\s+(one|two|three|four|five|six|[1-6])\s+attacks?/i);
  if(!total || total>10 || (announced&&total!==(word[announced[1].toLowerCase()]??number(announced[1]))))return null;
  return recipe;
}
