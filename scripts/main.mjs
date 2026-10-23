import {ID,TITLE,VERSION} from "./constants.mjs";
import {ImporterApp,DEFAULT_CONFIG} from "./ui.mjs";
import {ImportService,checkEnvironment} from "./importer.mjs";
import {parseText} from "./parser.mjs";
import {normalizeBundle} from "./schema.mjs";
import {compileBundle} from "./compiler.mjs";
import {registerHandlers} from "./handlers.mjs";

let app;
export function openImporter() {
  if(!game.user.isGM){ui.notifications.warn("Only a GM can import content.");return;}
  app??=new ImporterApp();return app.render({force:true});
}
Hooks.once("init",()=>{
  game.settings.register(ID,"connection",{scope:"client",config:false,type:Object,default:DEFAULT_CONFIG});
  game.settings.register(ID,"history",{scope:"world",config:false,type:Array,default:[]});
  game.settings.registerMenu(ID,"importer",{name:TITLE,label:"Open DND Importer",hint:"Import text, images, and web pages with Midi-QOL automation.",icon:"fa-solid fa-file-import",type:ImporterApp,restricted:true});
  game.keybindings.register(ID,"open",{name:`Open ${TITLE}`,restricted:true,editable:[],onDown:()=>{openImporter();return true;}});
});
Hooks.once("ready",()=>{
  const service=new ImportService();
  game.modules.get(ID).api=Object.freeze({version:VERSION,open:openImporter,parseText,normalizeBundle,compileBundle,checkEnvironment,prepare:(bundle,options)=>service.prepare(bundle,options),import:(plan,options)=>service.commit(plan,options),undo:id=>service.undo(id)});
  registerHandlers();
});
function addDirectoryButton(application,html) {
  if(!game.user?.isGM)return;
  const root=html instanceof HTMLElement?html:html?.[0]??application.element;
  if(!root||root.querySelector(".tdi-directory-button"))return;
  const container=root.querySelector(".directory-header .header-actions")??root.querySelector(".directory-header")??root.querySelector(".settings")??root;
  const button=document.createElement("button");button.type="button";button.className="tdi-directory-button";button.innerHTML='<i class="fa-solid fa-file-import"></i> DND Importer';button.title=TITLE;button.addEventListener("click",()=>openImporter());container.append(button);
}
for(const hook of ["renderActorDirectory","renderItemDirectory","renderCompendiumDirectory"])Hooks.on(hook,addDirectoryButton);
