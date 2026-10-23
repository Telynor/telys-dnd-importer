// Software versions and the content's 2014/2024 rules edition are independent.
// D&D5e 6 field names follow the official release-6.0.6 data models.
export function versionParts(version) {
  const match=String(version??"").match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][\w.-]+)?$/);
  return match?match.slice(1,4).map(v=>Number(v??0)):null;
}
export function supportedSystem(version) {
  const v=versionParts(version);
  return !!v&&(v[0]===6||v[0]===5&&(v[1]>3||v[1]===3&&v[2]>=3));
}

function effectKey6(key) {
  return key
    .replace(/^(system\.abilities\.[^.]+)\.bonuses\.(check|save)$/, "$1.$2.roll.bonus")
    .replace(/^system\.bonuses\.(mwak|rwak|msak|rsak)\.(attack|damage)$/, "system.rolls.$2.$1.bonus")
    .replace(/^system\.bonuses\.abilities\.(check|save|skill)$/, "system.rolls.ability.$1.bonus")
    .replace(/^(system\.attributes\.movement)\.(walk|burrow|climb|fly|swim|jump)$/, "$1.speeds.$2");
}
function movement6(movement) {
  if(!movement)return;
  movement.speeds??={};
  for(const key of ["walk","burrow","climb","fly","swim","jump"]){
    if(key in movement){movement.speeds[key]=String(movement[key]);delete movement[key];}
  }
}

// Work on the newly compiled document, never on an installed source document.
export function adaptDocumentForSystem(data,systemVersion) {
  if(versionParts(systemVersion)?.[0]!==6)return data;
  const s=data.system;
  if(s){
    if(s.attributes?.ac?.calc==="flat"){
      // In 6.x `calc` is prepared data; fixed source AC is stored as `override`.
      s.attributes.ac.override=s.attributes.ac.flat;
      delete s.attributes.ac.calc;
    }
    movement6(s.attributes?.movement);
    movement6(s.movement);
    for(const ability of Object.values(s.abilities??{})){
      for(const kind of ["check","save"]){
        if(ability.bonuses?.[kind]!==undefined){
          ability[kind]??={};ability[kind].roll??={};
          ability[kind].roll.bonus=ability.bonuses[kind];
        }
      }
      delete ability.bonuses;
    }
    for(const skill of Object.values(s.skills??{})){
      if(skill.bonuses?.check!==undefined){skill.roll??={};skill.roll.bonus=skill.bonuses.check;delete skill.bonuses.check;}
    }
    if("rarity" in s){
      if(s.rarity)s.rarities=[s.rarity];else s.rarities??=[];
      delete s.rarity;
    }
    if(s.advancement){
      const advancements=Object.values(s.advancement);
      for(const a of advancements){
        if(a.title!==undefined){a.name=a.title;delete a.title;}
        if(a.icon!==undefined){a.img=a.icon;delete a.icon;}
      }
      s.advancement=Object.fromEntries(advancements.map(a=>[a._id,a]));
    }
  }
  for(const effect of data.effects??[]){
    for(const change of effect.system?.changes??[])change.key=effectKey6(change.key);
  }
  for(const item of data.items??[])adaptDocumentForSystem(item,systemVersion);
  return data;
}
