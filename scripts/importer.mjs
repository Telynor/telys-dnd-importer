import {ID, TITLE, VERSION} from "./constants.mjs";
import {compileBundle, documentNameFor, replaceReferences} from "./compiler.mjs";
import {ContentResolver} from "./resolver.mjs";
import {normalizeBundle} from "./schema.mjs";
import {clone, digest, featureContext, randomID, unique} from "./utils.mjs";
import {supportedSystem,versionParts} from "./compatibility.mjs";

// The directory window, settings window and API must share the same write lock.
const activeWrites=new WeakSet();
const duplicateQuery=node=>({documentName:node.documentName,type:node.type,name:node.entry.name,rules:node.entry.rules,context:featureContext(node.data)});
const fingerprint=plan=>digest({roots:plan.roots,includePacks:plan.includePacks,nodes:plan.nodes.map(n=>({key:n.key,parentKey:n.parentKey,entry:n.entry,documentName:n.documentName,type:n.type,dependsOn:n.dependsOn,data:n.data,errors:n.errors}))});

export function checkEnvironment(env=globalThis) {
  const errors=[],game=env.game;
  if(!game?.user?.isGM)errors.push("Only a GM can use the importer.");
  if(game?.system?.id!=="dnd5e")errors.push("This importer requires the D&D5e system.");
  const major=Number(String(game?.version??game?.release?.version??"").split(".")[0]);
  if(major!==14)errors.push("This release targets Foundry v14.");
  if(!supportedSystem(game?.system?.version))errors.push("This release supports D&D5e 5.3.3–5.x and 6.x (schema reviewed against 6.0.6).");
  return errors;
}

// Optional automation must never prevent loading, extraction, or native imports.
// Check the live API as well as the package: a checked module can fail at startup.
export function checkAutomation(env=globalThis) {
  const game=env.game,system=versionParts(game?.system?.version);
  const midi=game?.modules?.get("midi-qol");
  if(!midi)return ["Midi-QOL is not installed."];
  if(!midi.active)return ["Midi-QOL is installed but is not enabled in this world."];
  const midiVersion=versionParts(midi?.version);
  if(midiVersion?.[0]!==14)return ["Midi automation needs a compatible Midi-QOL 14 version and its dependencies."];
  if(system?.[0]===6&&midiVersion[1]<6)return ["D&D5e 6 requires Midi-QOL 14.6 or later in the v14 line for automation, with its compatible dependencies. The README links the matching Midi-QOL and DAE manifests."];
  if(system?.[0]===5&&midiVersion[1]>=6)return ["D&D5e 5 requires the Midi-QOL 14.0 line for automation; Midi-QOL 14.6 targets D&D5e 6."];
  if(typeof env.MidiQOL?.completeItemUse!=="function")return ["Midi-QOL is enabled but its item-use API is unavailable. Check its startup errors and required modules."];
  return [];
}
const automationWarnings=env=>checkAutomation(env).map(issue=>`Midi automation unavailable: ${issue} Native content can still be imported. Linked attack/save automation, repeat-save effects, and automatic Multiattack need compatible Midi-QOL; enable it and analyze again before importing if you want those features.`);
export class FoundryAdapter {
  constructor(env=globalThis){this.env=env;}
  async history(){return clone(this.env.game.settings.get(ID,"history")??[]);}
  async saveHistory(list){await this.env.game.settings.set(ID,"history",list.slice(0,25));}
  async resolve(uuid){return this.env.fromUuid?this.env.fromUuid(uuid):this.env.foundry.utils.fromUuid(uuid);}
  async validate(node) {
    const cls=this.env.CONFIG[node.documentName]?.documentClass;
    if(!cls)throw new Error(`${node.documentName} is not registered.`);
    const model=new cls(clone(node.data),{strict:true});
    if(model.validate({strict:true,fields:true,joint:true})===false||model.invalid)throw new Error("Foundry rejected the generated document.");
    // Detect stripped activities/effects, since cleaning can otherwise hide adapter mistakes.
    const cleaned=model.toObject();
    function verifyContents(expected,actual){
      if(expected.system?.activities&&Object.keys(actual.system?.activities??{}).length!==Object.keys(expected.system.activities).length)throw new Error("An activity was removed during schema validation.");
      if(expected.effects?.length!==undefined&&actual.effects?.length!==expected.effects.length)throw new Error("An effect was removed during schema validation.");
      for(const effect of actual.effects??[])if(expected.effects.some(e=>e._id===effect._id&&e.system?.changes?.length)&&!effect.system?.changes?.length)throw new Error("An Active Effect lost its v14 changes during validation.");
      const advancements=Object.values(expected.system?.advancement??{}),validated=Object.values(actual.system?.advancement??{});
      if(advancements.length!==validated.length||advancements.some(a=>!validated.some(b=>a._id===b._id&&a.type===b.type)))throw new Error("An advancement was removed during schema validation.");
      for(const a of advancements){
        const b=validated.find(b=>b._id===a._id);
        if(a.type==="ItemGrant"&&JSON.stringify(a.configuration.items.map(i=>i.uuid))!==JSON.stringify(b.configuration?.items?.map(i=>i.uuid)))throw new Error("Class feature references changed during schema validation.");
      }
      const check=(label,before,after)=>{if(before!==undefined&&String(before)!==String(after))throw new Error(`${label} changed during schema validation.`);};
      check("Fixed armor class",expected.system?.attributes?.ac?.override,actual.system?.attributes?.ac?.override);
      for(const [key,value]of Object.entries(expected.system?.attributes?.movement?.speeds??{}))check(`Movement ${key}`,value,actual.system?.attributes?.movement?.speeds?.[key]);
      for(const [key,value]of Object.entries(expected.system?.abilities??{}))check(`Saving throw bonus ${key}`,value.save?.roll?.bonus,actual.system?.abilities?.[key]?.save?.roll?.bonus);
      for(const [key,value]of Object.entries(expected.system?.skills??{}))check(`Skill bonus ${key}`,value.roll?.bonus,actual.system?.skills?.[key]?.roll?.bonus);
      for(const item of expected.items??[]){const child=actual.items?.find(x=>x._id===item._id);if(!child)throw new Error(`Embedded item was removed: ${item.name}`);verifyContents(item,child);}
      for(const result of expected.results??[]){const child=actual.results?.find(x=>x._id===result._id);if(!child||child.description!==result.description)throw new Error("Roll table result text was removed during schema validation.");}
    }
    verifyContents(node.data,cleaned);
    return cleaned;
  }
  async folder(documentName,name) {
    if(!name)return null;
    const existing=this.env.game.folders.contents.find(f=>f.type===documentName&&f.name===name&&!f.folder);
    if(existing)return {doc:existing,created:false};
    const doc=await this.env.CONFIG.Folder.documentClass.create({name,type:documentName,sorting:"a",color:"#688aaf"});
    if(!doc)throw new Error("Folder creation was cancelled.");return {doc,created:true};
  }
  async create(node,data,{pack="",folder=""}={}) {
    const cls=this.env.CONFIG[node.documentName].documentClass;
    if(pack){const p=this.env.game.packs.get(pack);if(!p||p.locked||p.documentName!==node.documentName)throw new Error(`Choose an unlocked ${node.documentName} compendium.`);delete data.folder;}
    else if(folder)data.folder=folder;
    const doc=await cls.create(data,{keepId:true,renderSheet:false,...(pack?{pack}:{})});
    if(!doc)throw new Error(`${node.entry.name}: creation was cancelled.`);return doc;
  }
}

export class ImportService {
  constructor({env=globalThis,adapter=new FoundryAdapter(env)}={}) {this.env=env;this.adapter=adapter;}
  get lockKey(){return this.env.game??this.env;}
  get busy(){return activeWrites.has(this.lockKey);}
  async prepare(raw,{includePacks=true,signal,onProgress=()=>{}}={}) {
    const bundle=normalizeBundle(raw);
    onProgress("Indexing installed content…");
    const resolver=await new ContentResolver(this.env).load({includePacks,signal});
    const bases=new Map();
    async function baseWalk(entry,parent="") {const key=parent?`${parent}/${entry.id}`:entry.id;const base=await resolver.baseFor(entry);if(base)bases.set(key,base);for(const child of entry.features)await baseWalk(child,key);}
    for(const entry of bundle.entries)await baseWalk(entry);
    const plan=compileBundle(bundle,{bases,systemVersion:this.env.game.system.version});plan.bundle=bundle;plan.id=randomID();plan.resolver=resolver;plan.includePacks=includePacks;plan.warnings=[...bundle.warnings,...automationWarnings(this.env),...resolver.failures.map(x=>`Compendium unavailable: ${x}`)];
    // D&D5e 6 ItemGrant uses DocumentUUIDField. Validate prospective UUIDs,
    // then resolve the original placeholders to actual destinations at commit.
    const previewUUIDs=new Map(plan.nodes.map(n=>[n.key,`${n.documentName}.${n.data._id}`]));
    for(const node of plan.nodes){
      if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
      if(node.documentName==="Actor")await resolver.embedSpells(node,{signal});
      const picked=resolver.pick(duplicateQuery(node));
      node.duplicate=picked.match?{uuid:picked.match.uuid,name:picked.match.name,world:picked.match.world}:null;
      if(picked.ambiguous)node.warnings.push("Several matching documents exist; choose Create copies or resolve the duplicates before importing.");
      if(picked.ambiguous)node.ambiguousDuplicate=true;
      if(node.entry.item.baseItem&&!bases.has(node.key))node.warnings.push(`No unique ${node.entry.rules} base item found: ${node.entry.item.baseItem}. Review missing weapon/armor fields.`);
      try{await this.adapter.validate({...node,data:replaceReferences(node.data,previewUUIDs)});}catch(error){node.errors.push(`Foundry validation: ${error.message}`);}
      node.warnings=unique(node.warnings);
    }
    plan.fingerprint=fingerprint(plan);
    return plan;
  }
  selectedNodes(plan,selected) {
    const keys=new Set(),map=new Map(plan.nodes.map(n=>[n.key,n]));
    function walk(key){if(keys.has(key))return;const n=map.get(key);if(!n)throw new Error(`Unknown selected entry: ${key}`);n.dependsOn.forEach(walk);keys.add(key);}
    for(const key of selected??plan.roots)walk(key);
    return plan.nodes.filter(n=>keys.has(n.key));
  }
  async commit(plan,{selected,duplicates="skip",folderName="Tely's DND Imports",packs={},onProgress=()=>{}}={}) {
    if(this.busy)throw new Error("An import or undo is already running.");
    const envErrors=checkEnvironment(this.env);if(envErrors.length)throw new Error(envErrors.join(" "));
    if(fingerprint(plan)!==plan.fingerprint)throw new Error("The import plan changed. Analyze it again before importing.");
    let nodes=this.selectedNodes(plan,selected);if(!nodes.length)throw new Error("Select at least one entry.");
    activeWrites.add(this.lockKey);
    const record={id:randomID(),version:VERSION,date:new Date().toISOString(),userId:this.env.game.user.id,status:"pending",created:[],folders:[],reused:[],warnings:automationWarnings(this.env)};
    let history,historySaved=false;
    const persist=async()=>{const old=await this.adapter.history();history=[record,...old.filter(x=>x.id!==record.id)];await this.adapter.saveHistory(history);historySaved=true;};
    try {
      await persist();const uuids=new Map(),folders=new Map();
      // Refresh duplicate indexes at write time, so a stale preview does not duplicate a recent import.
      const resolver=await new ContentResolver(this.env).load({includePacks:plan.includePacks!==false});
      if(duplicates==="skip"){
        const wanted=new Set(),nodeMap=new Map(plan.nodes.map(n=>[n.key,n]));
        const visit=key=>{if(wanted.has(key))return;const node=nodeMap.get(key);if(!node)throw new Error(`Unknown entry: ${key}`);const picked=resolver.pick(duplicateQuery(node));if(picked.ambiguous)throw new Error(`Ambiguous duplicate: ${node.entry.name}`);if(!picked.match)node.dependsOn.forEach(visit);wanted.add(key);};
        for(const key of selected??plan.roots)visit(key);
        nodes=nodes.filter(n=>wanted.has(n.key));
      }
      const errors=nodes.flatMap(n=>duplicates==="skip"&&resolver.pick(duplicateQuery(n)).match?[]:n.errors.map(e=>`${n.entry.name}: ${e}`));
      if(errors.length)throw new Error(errors.join("\n"));
      for(const [i,node]of nodes.entries()) {
        onProgress(`Importing ${i+1}/${nodes.length}: ${node.entry.name}`);
        const picked=duplicates==="skip"?resolver.pick(duplicateQuery(node)):{};
        if(picked.ambiguous)throw new Error(`Ambiguous duplicate: ${node.entry.name}`);
        if(picked.match){const doc=await resolver.document(picked.match);if(!doc)throw new Error(`Duplicate vanished: ${node.entry.name}`);uuids.set(node.key,doc.uuid);record.reused.push({key:node.key,uuid:doc.uuid,name:node.entry.name});continue;}
        const data=replaceReferences(clone(node.data),uuids);data.flags??={};data.flags[ID]={...(data.flags[ID]??{}),sessionId:record.id};
        let folder="";const pack=packs[node.documentName]??"";
        if(!pack&&folderName){if(!folders.has(node.documentName)){const result=await this.adapter.folder(node.documentName,folderName);folders.set(node.documentName,result?.doc?.id??"");if(result?.created){record.folders.push(result.doc.uuid);await persist();}}folder=folders.get(node.documentName);}
        // Validate resolved advancement UUIDs as well as the preview data.
        await this.adapter.validate({...node,data});
        const doc=await this.adapter.create(node,data,{pack,folder});
        uuids.set(node.key,doc.uuid);
        record.created.push({uuid:doc.uuid,name:doc.name,hash:digest(doc.toObject()),dependsOn:node.dependsOn.map(k=>uuids.get(k)).filter(Boolean)});
        resolver.add({...duplicateQuery(node),uuid:doc.uuid,document:doc,world:!pack});
        await persist();
      }
      record.status="complete";await persist();return clone(record);
    }catch(error){
      record.status="failed";record.error=error.message;
      const rollback=await this.removeRecord(record,{history:history??[]});record.warnings.push(...rollback.skipped.map(x=>`Rollback retained ${x.name}: ${x.reason}`));
      record.created=record.created.filter(x=>!rollback.removed.includes(x.uuid));
      if(historySaved){try{await persist();}catch(saveError){record.warnings.push(`History could not be updated: ${saveError.message}`);}}
      const details=record.created.length?` ${record.created.length} documents remain; inspect Import History.`:" Created documents were rolled back.";
      throw new Error(`${error.message}${details}`);
    }finally{activeWrites.delete(this.lockKey);}
  }
  async removeRecord(record,{history=[]}={}) {
    const removed=[],skipped=[],protectedIds=new Set(),docs=new Map();
    for(const item of record.created){
      try{const doc=await this.adapter.resolve(item.uuid);docs.set(item.uuid,doc);if(doc&&digest(doc.toObject())!==item.hash){protectedIds.add(item.uuid);skipped.push({...item,reason:"edited since import"});}}
      catch(error){protectedIds.add(item.uuid);skipped.push({...item,reason:error.message});}
    }
    const owned=new Map(record.created.map(item=>[item.uuid,item]));
    for(const batch of history){
      if(batch.id===record.id)continue;
      for(const parent of batch.created??[]){
        const dependencies=(parent.dependsOn??[]).filter(uuid=>owned.has(uuid)&&!protectedIds.has(uuid));
        if(!dependencies.length)continue;
        let exists=true;
        try{exists=!!(await this.adapter.resolve(parent.uuid));}catch{/* Keep dependencies when the parent cannot be verified. */}
        if(exists)for(const uuid of dependencies){protectedIds.add(uuid);skipped.push({...owned.get(uuid),reason:"required by a document from another import batch"});}
      }
    }
    const propagate=()=>{let changed=true;while(changed){changed=false;for(const item of record.created)if(protectedIds.has(item.uuid))for(const dep of item.dependsOn??[])if(!protectedIds.has(dep)){protectedIds.add(dep);changed=true;const child=record.created.find(x=>x.uuid===dep);if(child)skipped.push({...child,reason:"required by a retained document"});}}};propagate();
    for(const item of [...record.created].reverse()) {
      if(protectedIds.has(item.uuid))continue;const doc=docs.get(item.uuid);
      if(!doc){removed.push(item.uuid);continue;}
      try{await doc.delete();if(await this.adapter.resolve(item.uuid))throw new Error("Deletion was cancelled.");removed.push(item.uuid);}
      catch(error){protectedIds.add(item.uuid);skipped.push({...item,reason:error.message});propagate();}
    }
    for(const uuid of [...record.folders].reverse()){
      try{const folder=await this.adapter.resolve(uuid);if(folder&&folder.contents?.length===0&&!(folder.children?.length))await folder.delete();}catch{/* Empty folder cleanup does not hide document results. */}
    }
    return {removed,skipped};
  }
  async undo(id) {
    const errors=checkEnvironment(this.env);if(errors.length)throw new Error(errors.join(" "));
    if(this.busy)throw new Error("An import or undo is already running.");activeWrites.add(this.lockKey);
    try{const history=await this.adapter.history(),record=history.find(x=>x.id===id);if(!record)throw new Error("Import history entry was not found.");const result=await this.removeRecord(record,{history});record.created=record.created.filter(x=>!result.removed.includes(x.uuid));record.status=record.created.length?"partly undone":"undone";record.warnings=result.skipped.map(x=>`${x.name}: ${x.reason}`);await this.adapter.saveHistory(history);return result;}
    finally{activeWrites.delete(this.lockKey);}
  }
}
