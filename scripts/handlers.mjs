import {ID} from "./constants.mjs";
import {escapeHTML, normalizeName} from "./utils.mjs";

const inFlight=new Set();
export function registerHandlers(env=globalThis) {
  env.Hooks.on("midi-qol.RollComplete",workflow=>{
    // Hooks do not await async listeners. Contain rejections explicitly.
    void runMultiattack(workflow,env).catch(error=>env.ui.notifications.error(`Tely's DND Importer: ${error.message}`));
  });
}
export async function runMultiattack(workflow,env=globalThis) {
  const item=workflow?.item,recipe=item?.flags?.[ID]?.multiattack,actor=item?.actor;
  if(!recipe?.length||!actor||workflow.aborted||workflow.options?.[ID]?.child||workflow.midiOptions?.workflowOptions?.[ID]?.child)return;
  if(workflow.userId&&workflow.userId!==env.game.user.id)return;
  if(!actor.isOwner)return;
  const workflowId=workflow.id??workflow.uuid??item.uuid;
  if(inFlight.has(workflowId))return;inFlight.add(workflowId);
  try{
    const attacks=[];
    for(const part of recipe){
      const candidates=actor.items.filter(i=>normalizeName(i.name)===normalizeName(part.name)&&!i.flags?.[ID]?.multiattack);
      if(candidates.length!==1)throw new Error(`Multiattack could not uniquely find ${part.name}.`);
      for(let n=0;n<part.count;n++)attacks.push(candidates[0]);
    }
    if(attacks.length>10)throw new Error("Multiattack sequence exceeds 10 attacks.");
    const confirmed=await env.foundry.applications.api.DialogV2.confirm({window:{title:"Use Multiattack"},content:`<p>Roll ${attacks.map(a=>escapeHTML(a.name)).join(", ")} against the current targets?</p>`});
    if(!confirmed)return;
    const targetUuids=[...(workflow.targets??env.game.user.targets??[])].map(t=>t.document?.uuid??t.uuid);
    if(!env.MidiQOL?.completeItemUse)throw new Error("Midi-QOL's item-use handler is unavailable.");
    for(const attack of attacks){const result=await env.MidiQOL.completeItemUse(attack,{midiOptions:{targetUuids,workflowOptions:{[ID]:{child:true}}}},{configure:true},{systemCard:false});if(!result||result.aborted)break;}
  }finally{inFlight.delete(workflowId);}
}
