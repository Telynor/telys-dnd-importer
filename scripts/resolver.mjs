import {ID} from "./constants.mjs";
import {clone, featureContext, mapLimit, normalizeName, randomID} from "./utils.mjs";

const rulesOf = doc => doc.system?.source?.rules??doc.system?.details?.source?.rules??doc.flags?.[ID]?.rules;
const keyOf=(documentName,type,name,rules,context="")=>JSON.stringify([documentName,["Actor","Item"].includes(documentName)?type??"":"",normalizeName(name),rules??"",context]);
function additionalIndexFields(pack,env){
  const fields=[`flags.${ID}.rules`,`flags.${ID}.featureContext`];
  if(["Actor","Item"].includes(pack.documentName))fields.push("type","system.source.rules");
  if(pack.documentName==="Actor")fields.push("system.details.source.rules");
  if(pack.documentName==="Item")fields.push("system.identifier","system.type.value","system.requirements");
  const indexed=new Set([
    ...(pack.indexFields??[]),
    ...(env.CONFIG?.[pack.documentName]?.compendiumIndexFields??[]),
    ...(pack.documentClass?.metadata?.compendiumIndexFields??[])
  ]);
  // D&D5e already indexes the whole system.source object. Asking Foundry to
  // select source AND source.rules collides in its numeric field projection.
  // Parent fields already supply their descendants; leave that selection alone.
  return fields.filter(field=>![...indexed].some(parent=>field===parent||field.startsWith(`${parent}.`)));
}
export class ContentResolver {
  constructor(env=globalThis){this.env=env;this.index=new Map();this.failures=[];this.loaded=false;}
  add(record) {const key=keyOf(record.documentName,record.type,record.name,record.rules,record.context);if(!this.index.has(key))this.index.set(key,[]);this.index.get(key).push(record);}
  async load({includePacks=true,signal}={}) {
    this.index.clear();this.failures=[];
    const game=this.env.game;
    for(const [documentName,collection]of [["Actor",game.actors],["Item",game.items],["JournalEntry",game.journal],["RollTable",game.tables]]) {
      for(const doc of collection?.contents??[])this.add({name:doc.name,type:doc.type,documentName,rules:rulesOf(doc),context:featureContext(doc),uuid:doc.uuid,document:doc,world:true});
    }
    if(includePacks){
      const packs=[...(game.packs?.values?.()??[])].filter(p=>["Actor","Item","JournalEntry","RollTable"].includes(p.documentName)&&p.visible!==false);
      await mapLimit(packs,3,async pack=>{
        if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
        try {const index=await pack.getIndex({fields:additionalIndexFields(pack,this.env)});
          for(const item of index.contents??index)this.add({name:item.name,type:item.type,documentName:pack.documentName,rules:rulesOf(item),context:featureContext(item),uuid:item.uuid??`Compendium.${pack.collection}.${pack.documentName}.${item._id}`,pack,id:item._id,world:false});
        }catch(error){this.failures.push(`${pack.metadata?.label??pack.collection}: ${error.message}`);}
      });
    }
    this.loaded=true;return this;
  }
  matches({documentName="Item",type,name,rules="2014",context=""}) {return this.index.get(keyOf(documentName,type,name,rules,context))??[];}
  pick(query) {
    const matches=this.matches(query),world=matches.filter(x=>x.world);
    if(world.length===1)return {match:world[0],ambiguous:false};
    if(world.length>1)return {match:null,ambiguous:true,matches:world};
    return matches.length===1?{match:matches[0],ambiguous:false}:{match:null,ambiguous:matches.length>1,matches};
  }
  async document(record) {return record.document??await record.pack.getDocument(record.id);}
  async baseFor(entry) {
    if(!entry.item.baseItem||!["weapon","equipment","tool","consumable"].includes(entry.kind))return null;
    const {match}=this.pick({type:entry.kind,name:entry.item.baseItem,rules:entry.rules});
    return match?(await this.document(match))?.toObject():null;
  }
  async embedSpells(node,{signal}={}) {
    for(const spell of node.entry.spells) {
      if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
      const {match,ambiguous}=this.pick({type:"spell",name:spell.name,rules:node.entry.rules});
      if(!match){node.warnings.push(`${ambiguous?"Ambiguous":"Missing"} ${node.entry.rules} spell: ${spell.name}. Supply the spell text or select an installed version separately.`);continue;}
      const doc=await this.document(match);if(!doc){node.warnings.push(`Spell could not be read: ${spell.name}`);continue;}
      const data=clone(doc.toObject());data._id=randomID();delete data._stats;delete data.folder;delete data.ownership;
      data.flags??={};data.flags[ID]={generated:true,resolvedFrom:match.uuid,rules:node.entry.rules};
      data.system.method=spell.mode==="prepared"?"spell":spell.mode||"spell";data.system.prepared=2;
      for(const a of Object.values(data.system.activities??{})) {
        if(a.type==="save"&&node.entry.stats.spellDC!=null)a.save.dc={calculation:"",formula:String(node.entry.stats.spellDC)};
        if(a.type==="attack"&&node.entry.stats.spellAttack!=null)Object.assign(a.attack,{bonus:String(node.entry.stats.spellAttack),flat:true});
        if(spell.mode==="atwill"||spell.mode==="innate")a.consumption={...(a.consumption??{}),spellSlot:false,targets:spell.uses?[{type:"itemUses",target:"",value:"1",scaling:{mode:"",formula:""}}]:[]};
      }
      if(spell.uses)data.system.uses={spent:0,max:String(spell.uses),recovery:[{period:"lr",type:"recoverAll",formula:""}]};
      node.data.items.push(data);
    }
  }
}
