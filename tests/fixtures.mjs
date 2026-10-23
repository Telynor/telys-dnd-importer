import {clone,randomID}from"../scripts/utils.mjs";

export function testEnvironment(){
  const store={Actor:new Map(),Item:new Map(),JournalEntry:new Map(),RollTable:new Map(),Folder:new Map()},history=[];
  const collection=name=>({get contents(){return [...store[name].values()];}});
  const env={game:{version:"14.368",user:{id:"gm1",isGM:true},system:{id:"dnd5e",version:"5.3.3"},modules:new Map([["midi-qol",{active:true,version:"14.0.16"}]]),actors:collection("Actor"),items:collection("Item"),journal:collection("JournalEntry"),tables:collection("RollTable"),folders:collection("Folder"),packs:new Map()},CONFIG:{}};
  let createdCount=0;
  const adapter={
    failAt:0,historyError:false,
    async history(){return clone(history);},
    async saveHistory(value){if(this.historyError)throw new Error("History unavailable");history.splice(0,history.length,...clone(value));},
    async resolve(uuid){for(const map of Object.values(store))if(map.has(uuid))return map.get(uuid);return null;},
    async validate(node){return clone(node.data);},
    async folder(documentName,name){const existing=[...store.Folder.values()].find(x=>x.name===name&&x.type===documentName);if(existing)return {doc:existing,created:false};const doc=makeDoc("Folder",{_id:randomID(),name,type:documentName});Object.defineProperty(doc,"contents",{get:()=>[...store[documentName].values()].filter(d=>d.data.folder===doc.id)});doc.children=[];return {doc,created:true};},
    async create(node,data,options){createdCount++;if(this.failAt&&createdCount===this.failAt)throw new Error("Simulated creation failure");return makeDoc(node.documentName,{...clone(data),...(options.folder?{folder:options.folder}:{})},options.pack);}
  };
  function makeDoc(documentName,data,pack=""){
    const id=data._id??randomID(),uuid=pack?`Compendium.${pack}.${documentName}.${id}`:`${documentName}.${id}`;
    const doc={id,uuid,documentName,name:data.name,type:data.type,system:clone(data.system??{}),flags:clone(data.flags??{}),data:clone({...data,_id:id}),folder:data.folder,toObject(){return clone(this.data);},async delete(){store[documentName].delete(uuid);}};
    store[documentName].set(uuid,doc);return doc;
  }
  return {env,adapter,store,history,makeDoc};
}
export function feat(name="Arc Spark") {return {kind:"feat",name,rules:"2014",text:"As an action, a target takes 2d6 lightning damage.",mechanics:{activation:{type:"action",value:1},damage:[{formula:"2d6",type:"lightning"}]}};}
export function classEntry(){return {kind:"class",name:"Test Warden",rules:"2014",text:"An original class for testing.",item:{hitDie:"d8"},features:[{...feat("First Spark"),level:1},{...feat("Second Spark"),level:2}]};}
