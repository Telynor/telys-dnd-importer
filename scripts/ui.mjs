import {ID, KINDS, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TEXT, TITLE, VERSION} from "./constants.mjs";
import {ImportService, checkEnvironment, checkAutomation} from "./importer.mjs";
import {parseText} from "./parser.mjs";
import {extractWithModel,testModelConnection,chatEndpoint,bridgeEndpoint} from "./providers.mjs";
import {recognizeImages} from "./ocr.mjs";
import {fetchSource} from "./sources.mjs";
import {normalizeBundle} from "./schema.mjs";
import {parseJSONResponse} from "./utils.mjs";

const labels={auto:"Detect content type",creature:"Creature / NPC",character:"Character",spell:"Spell",weapon:"Weapon",equipment:"Equipment / magic item",consumable:"Consumable",tool:"Tool",loot:"Loot",container:"Container",feat:"Feat / feature",background:"Background",race:"Race / species",class:"Class",subclass:"Subclass",facility:"Facility",journal:"Journal",table:"Roll table"};
const optionList=(list,current)=>list.map(v=>({value:typeof v==="string"?v:v.value,label:typeof v==="string"?labels[v]??v:v.label,selected:(typeof v==="string"?v:v.value)===current}));
export const DEFAULT_CONFIG={endpoint:"http://127.0.0.1:11434/v1",model:"",bridge:"",maxTokens:8192,jsonMode:true};
const {ApplicationV2,HandlebarsApplicationMixin}=foundry.applications.api;

function countData(data){const items=data.items??[data];return {activities:items.reduce((n,i)=>n+Object.keys(i.system?.activities??{}).length,0),effects:(data.effects?.length??0)+(data.items?items.reduce((n,i)=>n+(i.effects?.length??0),0):0)};}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export class ImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS={id:ID,classes:["tely-dnd-importer"],tag:"section",window:{title:TITLE,resizable:true,icon:"fa-solid fa-wand-magic-sparkles"},position:{width:1000,height:780},actions:{view:this.actionView,analyze:this.actionAnalyze,importSelected:this.actionImport,removeImage:this.actionRemoveImage,chooseFiles:this.actionChooseFiles,cancel:this.actionCancel,saveConnection:this.actionSaveConnection,clearKeys:this.actionClearKeys,applyJSON:this.actionApplyJSON,exportJSON:this.actionExportJSON,exportReport:this.actionExportReport,undo:this.actionUndo,openDocument:this.actionOpenDocument,loadExample:this.actionLoadExample,testConnection:this.actionTestConnection,useImageText:this.actionUseImageText}};
  static PARTS={main:{template:`modules/${ID}/templates/importer.hbs`,scrollable:[".tdi-body"]}};
  constructor(options={}) {
    super(options);this.service=new ImportService();this.view="source";this.input="";this.urls="";this.kind="auto";this.rules="2014";this.engine="native";this.folderName="Tely's DND Imports";this.duplicates="skip";this.includePacks=true;this.packs={};this.config={...DEFAULT_CONFIG,...(game.settings.get(ID,"connection")??{})};this.credentials={};this.images=[];this.ocrText="";this.reviewJSON=null;this.plan=null;this.planStale=true;this.selected=new Set();this.busy=false;this.cancelable=true;this.status="";this.error="";this.result=null;this.abortController=null;
  }
  async _prepareContext(options) {
    const context=await super._prepareContext(options);
    const automationIssues=checkAutomation();
    const nodes=this.plan?.nodes??[];
    const rows=nodes.map(n=>{const counts=countData(n.data);return {key:n.key,name:n.entry.name,kind:labels[n.entry.kind],dependency:!!n.parentKey,selected:this.selected.has(n.key),errors:n.errors,warnings:n.warnings,duplicate:n.duplicate,activities:counts.activities,effects:counts.effects,tags:n.entry.tags,status:n.errors.length?"Needs correction":n.duplicate&&this.duplicates==="skip"?"Existing content":n.warnings.length?"Review":"Ready",statusClass:n.errors.length?"error":n.duplicate&&this.duplicates==="skip"?"existing":n.warnings.length?"review":"ready",source:n.entry.source.label||n.entry.source.url||"Pasted source",description:n.entry.text,details:JSON.stringify(n.data,null,2)};});
    const packGroups=["Actor","Item","JournalEntry","RollTable"].map(type=>({type,label:{Actor:"Actors",Item:"Items / character options",JournalEntry:"Journals",RollTable:"Roll tables"}[type],options:optionList([{value:"",label:"World directory"},...[...game.packs.values()].filter(p=>p.documentName===type&&!p.locked).map(p=>({value:p.collection,label:p.metadata.label}))],this.packs[type]??"")}));
    return {...context,title:TITLE,version:VERSION,view:this.view,tabs:[{id:"source",label:"Source",icon:"fa-solid fa-file-import"},{id:"review",label:"Review",icon:"fa-solid fa-list-check"},{id:"connection",label:"Model & connection",icon:"fa-solid fa-plug"},{id:"history",label:"History",icon:"fa-solid fa-clock-rotate-left"}].map(t=>({...t,active:t.id===this.view})),isSource:this.view==="source",isReview:this.view==="review",isConnection:this.view==="connection",isHistory:this.view==="history",input:this.input,urls:this.urls,kindOptions:optionList(["auto",...KINDS],this.kind),rulesOptions:optionList([{value:"2014",label:"2014 rules"},{value:"2024",label:"2024 rules"}],this.rules),engineOptions:optionList([{value:"native",label:"Built-in text & image reader"},{value:"model",label:"Model extraction (Ollama / compatible provider)"}],this.engine),folderName:this.folderName,duplicateOptions:optionList([{value:"skip",label:"Reuse existing content"},{value:"copy",label:"Create new copies"}],this.duplicates),includePacks:this.includePacks,images:this.images.map((im,index)=>({name:im.file.name,url:im.url,index})),ocrText:this.ocrText,hasOCRText:!!this.ocrText,hasImages:this.images.length>0,imageCount:this.images.length,config:this.config,hasAPIKey:!!this.credentials.apiKey,hasBridgeToken:!!this.credentials.bridgeToken,busy:this.busy,cancelable:this.cancelable,status:this.status,error:this.error,environmentErrors:checkEnvironment(),automationIssues,rows,hasPlan:!!this.plan,stale:this.planStale,canImport:!!this.plan&&!this.planStale&&!this.busy&&this.selected.size>0,rootCount:this.plan?.roots.length??0,selectedCount:this.selected.size,planWarnings:this.plan?.warnings??[],bundleJSON:this.reviewJSON??(this.plan?JSON.stringify(this.plan.bundle,null,2):""),result:this.result,packGroups,history:(await this.service.adapter.history()).map(h=>({...h,count:h.created.length,reusedCount:h.reused.length,canUndo:h.created.length>0,dateLabel:new Date(h.date).toLocaleString()}))};
  }
  _onRender(context,options) {
    super._onRender(context,options);
    this.element.querySelectorAll("input,select,textarea").forEach(field=>{if(this.busy)field.disabled=true;field.addEventListener("input",()=>{
      if(field.name==="apiKey"){if(field.value)this.credentials.apiKey=field.value;return;}
      if(field.name==="bridgeToken"){if(field.value)this.credentials.bridgeToken=field.value;return;}
      this.capture();
      if(["input","urls","kind","rules","engine","includePacks","bundleJSON"].includes(field.name)){this.planStale=true;const button=this.element.querySelector('[data-action="importSelected"]');if(button)button.disabled=true;}
      if(field.name==="duplicates")void this.render();
    });});
    this.element.querySelectorAll('[data-entry-select]').forEach(field=>field.addEventListener("change",()=>{field.checked?this.selected.add(field.dataset.entrySelect):this.selected.delete(field.dataset.entrySelect);const button=this.element.querySelector('[data-action="importSelected"]');if(button)button.disabled=this.busy||this.planStale||!this.selected.size;}));
    const input=this.element.querySelector('input[name="sourceFiles"]');input?.addEventListener("change",()=>void this.addFiles([...input.files]).catch(e=>this.showError(e)));
    const drop=this.element.querySelector(".tdi-drop");
    drop?.addEventListener("dragover",event=>{event.preventDefault();drop.classList.add("dragover");});
    drop?.addEventListener("dragleave",()=>drop.classList.remove("dragover"));
    drop?.addEventListener("drop",event=>{event.preventDefault();drop.classList.remove("dragover");void this.addFiles([...event.dataTransfer.files]).catch(e=>this.showError(e));});
    if(this._pasteListener)this.element.removeEventListener("paste",this._pasteListener);
    this._pasteListener=event=>{const files=[...event.clipboardData.items].filter(i=>i.kind==="file").map(i=>i.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();void this.addFiles(files).catch(e=>this.showError(e));}};
    this.element.addEventListener("paste",this._pasteListener);
  }
  capture() {
    const root=this.element;if(!root)return;
    const editor=root.querySelector('[name="bundleJSON"]');if(editor)this.reviewJSON=editor.value;
    for(const key of ["input","urls","kind","rules","engine","folderName","duplicates"]){const input=root.querySelector(`[name="${key}"]`);if(input)this[key]=input.value;}
    const check=root.querySelector('[name="includePacks"]');if(check)this.includePacks=check.checked;
    for(const key of ["endpoint","model","bridge","maxTokens"]){const field=root.querySelector(`[name="${key}"]`);if(field)this.config[key]=field.value;}
    const jsonMode=root.querySelector('[name="jsonMode"]');if(jsonMode)this.config.jsonMode=jsonMode.checked;
    for(const type of ["Actor","Item","JournalEntry","RollTable"]){const field=root.querySelector(`[name="pack-${type}"]`);if(field)this.packs[type]=field.value;}
  }
  async addFiles(files) {
    if(this.busy)return;this.capture();
    if(this.loadingFiles)throw new Error("Wait for the attached files to finish loading.");
    this.loadingFiles=true;
    const added=[],texts=[];
    let total=this.images.reduce((n,f)=>n+f.file.size,0),length=this.input.length;
    try{for(const file of files){
      if(["image/png","image/jpeg","image/webp"].includes(file.type)){
        if(this.images.length+added.length>=MAX_IMAGES||total+file.size>MAX_IMAGE_BYTES)throw new Error("Use up to eight images, totaling no more than 20 MB.");
        added.push(file);total+=file.size;
      }else if(/\.(txt|json|md)$/i.test(file.name)){
        if(file.size>1_000_000)throw new Error("Text file is too large; split it first.");
        const value=await file.text();length+=value.length+(length?7:0);if(length>MAX_TEXT)throw new Error("Too much source text; use a smaller batch.");texts.push(value);
      }else throw new Error("Attach PNG, JPEG, WebP, TXT, Markdown, or import JSON files.");
    }}finally{this.loadingFiles=false;}
    this.images.push(...added.map(file=>({file,url:URL.createObjectURL(file)})));
    for(const text of texts)this.input+=(this.input?"\n\n---\n\n":"")+text;
    this.ocrText="";this.planStale=true;this.error="";await this.render();
  }
  showError(error){this.error=error.message??String(error);this.status="";return this.render();}
  progress(text){this.status=text;const status=this.element?.querySelector(".tdi-status");if(status)status.textContent=text;}
  async run(work,{cancelable=true}={}) {
    if(this.busy)return;this.capture();this.busy=true;this.cancelable=cancelable;this.error="";this.abortController=new AbortController();await this.render();
    try{await work(this.abortController.signal);}catch(error){if(error?.name==="AbortError")this.status="Cancelled. No import was started.";else{this.error=error?.message??String(error);this.status="";}}
    finally{this.busy=false;this.abortController=null;await this.render();}
  }
  static async actionView(event,target){if(this.busy)return;this.capture();this.view=target.dataset.view;await this.render();}
  static async actionAnalyze(){await this.run(async signal=>{
    this.planStale=true;
    const errors=checkEnvironment();if(errors.length)throw new Error(errors.join(" "));
    const sources=[];if(this.input.trim())sources.push({text:this.input,url:""});
    const urls=this.urls.split(/\n/).map(x=>x.trim()).filter(Boolean);if(urls.length>10)throw new Error("Import up to ten web pages per batch.");
    for(const url of urls){this.progress(`Reading ${url}…`);sources.push(await fetchSource(url,{bridge:this.config.bridge,bridgeToken:this.credentials.bridgeToken,signal}));}
    if(!sources.length&&!this.images.length)throw new Error("Paste content, attach images, or enter web links first.");
    let bundle;
    if(this.engine==="model"){this.progress("Extracting content with the configured model…");const text=sources.map(s=>s.url?`SOURCE URL: ${s.url}\n${s.text}`:s.text).join("\n\n---\n\n");bundle=await extractWithModel({text,images:this.images.map(i=>i.file),kind:this.kind,rules:this.rules,config:this.config,credentials:this.credentials,signal});if(sources.length===1&&sources[0].url)for(const entry of bundle.entries)entry.source.url||=sources[0].url;}
    else{
      let warnings=[];
      if(this.images.length){
        const result=await recognizeImages(this.images.map(i=>i.file),{signal,onProgress:text=>this.progress(text)});
        this.ocrText=result.pages.map(page=>page.text).join("\n\n---\n\n");
        sources.push(...result.pages.map(page=>({text:page.text,label:page.name,url:""})));warnings=result.warnings;
      }
      bundle=normalizeBundle({entries:sources.flatMap(s=>parseText(s.text,{kind:this.kind,rules:this.rules,source:{url:s.url,label:s.label??""}}).entries),warnings},{rules:this.rules});
    }
    this.plan=await this.service.prepare(bundle,{includePacks:this.includePacks,signal,onProgress:text=>this.progress(text)});this.reviewJSON=JSON.stringify(this.plan.bundle,null,2);this.selected=new Set(this.plan.roots);this.planStale=false;this.view="review";this.result=null;this.status=`${this.plan.roots.length} entries analyzed. Review the generated activities and any warnings.`;
  });}
  static async actionImport(){if(!this.plan||this.planStale)return this.showError(new Error("Analyze or rebuild the edited JSON before importing."));await this.run(async()=>{this.progress("Starting import…");this.result=await this.service.commit(this.plan,{selected:[...this.selected],duplicates:this.duplicates,folderName:this.folderName,packs:this.packs,onProgress:t=>this.progress(t)});this.status=`Created ${this.result.created.length} documents; reused ${this.result.reused.length}.`;this.planStale=true;this.view="history";},{cancelable:false});}
  static async actionRemoveImage(event,target){if(this.busy)return;this.capture();const index=Number(target.dataset.index),item=this.images[index];if(item){URL.revokeObjectURL(item.url);this.images.splice(index,1);this.ocrText="";this.planStale=true;await this.render();}}
  static actionChooseFiles(){this.element.querySelector('input[name="sourceFiles"]')?.click();}
  static actionCancel(){this.abortController?.abort();}
  static async actionSaveConnection(){try{this.capture();if(this.config.endpoint)chatEndpoint(this.config.endpoint);if(this.config.bridge)bridgeEndpoint(this.config.bridge,"/health");const value={endpoint:this.config.endpoint,model:this.config.model,bridge:this.config.bridge,maxTokens:this.config.maxTokens,jsonMode:this.config.jsonMode};await game.settings.set(ID,"connection",value);this.status="Connection settings saved. Keys stay only in this window's memory.";await this.render();}catch(error){await this.showError(error);}}
  static async actionClearKeys(){this.credentials={};this.status="Session keys cleared.";await this.render();}
  static async actionTestConnection(){await this.run(async signal=>{this.progress("Connecting to the selected model…");await testModelConnection({config:this.config,credentials:this.credentials,signal});this.status="Model connection works. Image extraction also requires a vision-capable model.";});}
  static async actionUseImageText(){if(this.busy||!this.ocrText)return;this.capture();const text=(this.input?`${this.input}\n\n---\n\n`:"")+this.ocrText;if(text.length>MAX_TEXT)return this.showError(new Error("Too much source text; use a smaller batch."));this.input=text;for(const image of this.images)URL.revokeObjectURL(image.url);this.images=[];this.ocrText="";this.engine="native";this.planStale=true;this.view="source";await this.render();}
  static async actionApplyJSON(){const value=this.element.querySelector('[name="bundleJSON"]')?.value;await this.run(async signal=>{this.planStale=true;const bundle=normalizeBundle(parseJSONResponse(value),{rules:this.rules});this.plan=await this.service.prepare(bundle,{includePacks:this.includePacks,signal,onProgress:t=>this.progress(t)});this.reviewJSON=JSON.stringify(this.plan.bundle,null,2);this.selected=new Set(this.plan.roots);this.planStale=false;this.status="Edited JSON validated and rebuilt.";});}
  static actionExportJSON(){if(this.plan)download(this.plan.bundle,"telys-dnd-import.json");}
  static actionExportReport(){if(this.plan)download({version:VERSION,warnings:this.plan.warnings,entries:this.plan.nodes.map(n=>({name:n.entry.name,kind:n.entry.kind,duplicate:n.duplicate,errors:n.errors,warnings:n.warnings,...countData(n.data)}))},"telys-dnd-import-report.json");}
  static async actionUndo(event,target){const id=target.dataset.id;const yes=await foundry.applications.api.DialogV2.confirm({window:{title:"Undo import"},content:"<p>Remove documents created by this batch? Edited documents and their dependencies will be kept.</p>"});if(!yes)return;await this.run(async()=>{const result=await this.service.undo(id);this.status=`Removed ${result.removed.length} documents; retained ${result.skipped.length}.`;},{cancelable:false});}
  static async actionOpenDocument(event,target){try{const doc=await fromUuid(target.dataset.uuid);if(doc?.sheet)await doc.sheet.render({force:true});}catch(error){await this.showError(error);}}
  static async actionLoadExample(){if(this.busy)return;this.capture();const response=await fetch(`modules/${ID}/examples/training-creature.txt`);if(!response.ok)return this.showError(new Error("Example file was not found."));this.input=await response.text();this.kind="creature";this.engine="native";this.planStale=true;await this.render();}
  async close(options={}){if(this.service.busy){ui.notifications.warn("Wait for the current import or undo to finish.");return this;}this.abortController?.abort();this.credentials={};for(const image of this.images)URL.revokeObjectURL(image.url);this.images=[];return super.close(options);}
}
