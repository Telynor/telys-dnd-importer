import {readFile,readdir,stat} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {createHash} from "node:crypto";
import {ID,TITLE,VERSION} from "../scripts/constants.mjs";
const root=new URL("../",import.meta.url).pathname;
async function walk(dir){const files=[];for(const name of await readdir(dir)){const p=path.join(dir,name);if((await stat(p)).isDirectory()){if(!["dist","__pycache__"].includes(name))files.push(...await walk(p));}else files.push(p);}return files;}
let failed=false;const files=await walk(root);
for(const file of files.filter(f=>f.endsWith(".mjs"))){const r=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});if(r.status){process.stderr.write(r.stderr);failed=true;}}
const manifest=JSON.parse(await readFile(path.join(root,"module.json"),"utf8"));
for(const file of [...manifest.esmodules,...manifest.styles]){try{await stat(path.join(root,file));}catch{console.error("Missing manifest asset:",file);failed=true;}}
if(manifest.id!==ID||manifest.title!==TITLE)throw new Error("Module identity mismatch.");
const metadata=JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
if(manifest.version!==VERSION||metadata.version!==VERSION)throw new Error("Module version mismatch.");
const assets=JSON.parse(await readFile(path.join(root,"vendor/ocr/assets.json"),"utf8"));
for(const asset of assets){
  const bytes=await readFile(path.join(root,"vendor/ocr",asset.path));
  if(bytes.length!==asset.bytes||createHash("sha256").update(bytes).digest("hex")!==asset.sha256)throw new Error(`Invalid image-reader asset: ${asset.path}`);
}
const p=spawnSync("python3",["-m","py_compile",path.join(root,"companion/bridge.py"),path.join(root,"tools/package.py")],{encoding:"utf8"});if(p.status){process.stderr.write(p.stderr);failed=true;}
if(failed)process.exit(1);console.log(`Syntax and manifest checks passed (${files.length} files).`);
