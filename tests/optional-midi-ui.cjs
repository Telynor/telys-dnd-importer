// Actual module entrypoint, templates and UI actions with mocked Foundry persistence.
// Does not substitute for testing against a licensed Foundry runtime.
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const http=require("node:http");
const path=require("node:path");
const {chromium}=require("playwright");

const root=path.resolve(__dirname,".."),prefix="/modules/telys-dnd-importer/";
const output=process.env.BROWSER_ARTIFACTS??path.join(root,"artifacts");
const boot=String.raw`
import {testEnvironment} from "/modules/telys-dnd-importer/tests/fixtures.mjs";
import {ImportService} from "/modules/telys-dnd-importer/scripts/importer.mjs";
const ID="telys-dnd-importer",f=testEnvironment(),once=new Map(),listeners=new Map();
const template=Handlebars.compile(await (await fetch("/modules/telys-dnd-importer/templates/importer.hbs")).text());
globalThis.game=f.env.game;game.system.version="6.0.6";game.modules.delete("midi-qol");game.modules.set(ID,{});
globalThis.fixture=f;globalThis.messages=[];
// D&D5e's real default Item index includes system.source. Exercise its
// parent/child projection boundary during both Analyze and Import.
game.packs.set("test.reference",{
  collection:"test.reference",documentName:"Item",visible:true,locked:true,metadata:{label:"Reference projection"},
  indexFields:new Set(["_id","name","type","system.source"]),
  async getIndex({fields=[]}={}){
    const projection={};
    for(const path of [...this.indexFields,...fields]){
      const parts=path.split(".");let target=projection;
      for(const key of parts.slice(0,-1)){if(!(key in target))target[key]={};target=target[key];}
      const key=parts.at(-1);if(!(key in target))target[key]=1;
    }
    return {contents:[{_id:"referenceSpell",name:"Index Projection Reference",type:"spell",system:{source:{rules:"2014"}}}]};
  },
  async getDocument(){throw Error("An unrelated reference document must not be loaded");}
});
game.settings={get:(_,key)=>key==="history"?[]:{},register(){},registerMenu(){}};
game.keybindings={register(){}};
globalThis.Hooks={once:(name,cb)=>once.set(name,cb),on:(name,cb)=>listeners.set(name,cb)};
globalThis.ui={notifications:{warn:message=>messages.push(message),error:message=>messages.push(message)}};
class ApplicationV2{
  constructor(){
    this.element=document.createElement("section");this.element.className="tely-dnd-importer";
    this.element.addEventListener("click",event=>{
      const target=event.target.closest("[data-action]");if(!target||target.disabled)return;
      const action=this.constructor.DEFAULT_OPTIONS.actions[target.dataset.action];
      Promise.resolve(action?.call(this,event,target)).catch(error=>messages.push(error.message));
    });
  }
  async _prepareContext(){return {};}
  _onRender(){}
  async render(){
    this.element.innerHTML=template(await this._prepareContext({}));
    if(!this.element.isConnected)document.body.append(this.element);
    this._onRender({},{});return this;
  }
  async close(){this.element.remove();return this;}
}
globalThis.foundry={applications:{api:{ApplicationV2,HandlebarsApplicationMixin:base=>base,DialogV2:{confirm:async()=>true}}}};
await import("/modules/telys-dnd-importer/scripts/main.mjs");
once.get("init")();once.get("ready")();
globalThis.app=await game.modules.get(ID).api.open();
app.service=new ImportService({env:globalThis,adapter:f.adapter});
globalThis.setMidiState=async state=>{
  game.modules.delete("midi-qol");delete globalThis.MidiQOL;
  if(state!=="missing")game.modules.set("midi-qol",{active:state!=="disabled",version:state==="incompatible"?"14.0.15":"14.6.0"});
  if(state!=="failed startup")globalThis.MidiQOL={completeItemUse:async()=>({aborted:false})};
  await app.render();
};
globalThis.booted=true;
`;

async function main(){
  const errors=[];
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,"http://localhost").pathname;
      let content,type;
      if(pathname==="/"){
        content='<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="'+prefix+'styles/importer.css"><style>html,body{margin:0;background:#101620}body{padding:16px;box-sizing:border-box}.tely-dnd-importer{height:calc(100vh - 32px);max-width:1120px;margin:auto}button{cursor:pointer}*{box-sizing:border-box}</style></head><body><script src="/__handlebars.js"></script><script type="module" src="/__boot.mjs"></script></body></html>';
        type="text/html";
      }else if(pathname==="/__boot.mjs"){content=boot;type="text/javascript";}
      else if(pathname==="/__handlebars.js"){content=await fs.readFile(require.resolve("handlebars/dist/handlebars.min.js"));type="text/javascript";}
      else if(pathname.startsWith(prefix)){
        const file=path.resolve(root,decodeURIComponent(pathname.slice(prefix.length)));
        if(!file.startsWith(root+path.sep))throw Error("Invalid path");
        content=await fs.readFile(file);
        type=({".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".json":"application/json",".hbs":"text/plain",".txt":"text/plain"})[path.extname(file)]??"application/octet-stream";
      }else {res.writeHead(404);res.end();return;}
      res.writeHead(200,{"Content-Type":type});res.end(content);
    }catch(error){res.writeHead(500);res.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  let browser;
  try{
    await fs.mkdir(output,{recursive:true});
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:["--no-sandbox"]});
    const page=await browser.newPage({viewport:{width:1200,height:900}});
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto("http://127.0.0.1:"+server.address().port);
    await page.waitForFunction(()=>globalThis.booted===true);
    assert.equal(await page.locator(".tdi-alert.error").count(),0);
    assert.match(await page.locator(".tdi-automation-status").innerText(),/Importing is available/);
    await page.screenshot({path:path.join(output,"importer-optional-midi-source.png")});

    await page.locator('[data-action="loadExample"]').click();
    await page.waitForFunction(()=>app.input.includes("Copperwork Watcher"));
    await page.locator('[data-action="analyze"]').click();
    await page.waitForFunction(()=>app.view==="review"&&!app.busy);
    assert.equal(await page.evaluate(()=>app.error),"");
    assert.deepEqual(await page.evaluate(()=>app.plan.resolver.failures),[]);
    assert.equal(await page.locator('[data-action="importSelected"]').isEnabled(),true);
    assert.equal(await page.evaluate(()=>app.plan.nodes[0].data.system.attributes.hp.max),45);
    await page.screenshot({path:path.join(output,"importer-optional-midi-review.png")});

    await page.locator('[data-action="importSelected"]').click();
    await page.waitForFunction(()=>app.view==="history"&&!app.busy);
    assert.equal(await page.evaluate(()=>app.error),"");
    assert.equal(await page.evaluate(()=>fixture.store.Actor.size),1);
    assert.ok(!(await page.evaluate(()=>app.result.warnings.join(" "))).includes("Compendium unavailable"));
    assert.match(await page.locator(".tdi-history-entry").innerText(),/Midi automation unavailable/);
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(()=>!app.busy&&fixture.store.Actor.size===0);

    for(const [state,expected]of [["disabled",/not enabled/],["incompatible",/requires Midi-QOL 14.6/],["failed startup",/API is unavailable/]]){
      await page.evaluate(state=>setMidiState(state),state);
      assert.match(await page.locator(".tdi-automation-status").innerText(),expected);
      assert.equal(await page.locator(".tdi-alert.error").count(),0);
    }
    await page.evaluate(()=>setMidiState("ready"));
    assert.equal(await page.locator(".tdi-automation-status").innerText(),"Midi-QOL automation available");
    assert.deepEqual(await page.evaluate(()=>messages),[]);
    assert.deepEqual(errors,[]);
    console.log("PASS: actual module boot, Analyze/Import with a D&D5e-shaped index projection, persisted warnings and Undo without Midi; disabled/incompatible/failed-startup/ready status rendering.");
  }finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
