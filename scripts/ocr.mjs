import {ID, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TEXT} from "./constants.mjs";
import {cleanText} from "./utils.mjs";

const cancelled=()=>new DOMException("Cancelled","AbortError");
let runtime;
const loadRuntime=()=>runtime??=import("../vendor/ocr/tesseract.esm.min.js").then(module=>module.default??module).catch(error=>{
  runtime=null;
  throw new Error(`The built-in image reader could not load. Reinstall the complete module ZIP. ${error.message}`);
});

async function prepareImage(file,env) {
  if(!env.createImageBitmap||!env.document)return file;
  const bitmap=await env.createImageBitmap(file);
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40_000_000)
      throw new Error(`${file.name}: crop the image to the relevant content before importing.`);
    const scale=Math.min(Math.max(1,1600/bitmap.width),Math.sqrt(10_000_000/(bitmap.width*bitmap.height)));
    const canvas=env.document.createElement("canvas");
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const context=canvas.getContext("2d");
    context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas;
  }finally{bitmap.close();}
}

// All OCR code, WASM and English language data are bundled with the module.
// A worker is shared within one batch, then terminated on success, error or cancel.
export async function recognizeImages(images,{signal,onProgress=()=>{},env=globalThis,workerFactory}={}) {
  if(signal?.aborted)throw cancelled();
  if(!images.length)throw new Error("Attach an image first.");
  if(images.length>MAX_IMAGES||images.reduce((total,file)=>total+file.size,0)>MAX_IMAGE_BYTES)
    throw new Error("Use up to eight images, totaling no more than 20 MB.");
  if(images.some(file=>!["image/png","image/jpeg","image/webp"].includes(file.type)))
    throw new Error("The image reader accepts PNG, JPEG and WebP files.");
  let worker,index=0,finished=false;
  let rejectAbort;
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{rejectAbort(cancelled());if(worker)void worker.terminate().catch(()=>{});};
  signal?.addEventListener("abort",onAbort,{once:true});
  const task=(async()=>{
    const factory=workerFactory??(await loadRuntime()).createWorker;
    if(signal?.aborted)throw cancelled();
    const base=new URL(`modules/${ID}/vendor/ocr/`,env.document?.baseURI??"http://localhost/").href;
    onProgress("Starting the built-in image reader…");
    worker=await factory("eng",1,{
      workerPath:`${base}worker.min.js`,corePath:`${base}core/`,langPath:`${base}lang/`,
      workerBlobURL:false,cacheMethod:"none",gzip:true,
      logger:message=>{
        if(!finished&&!signal?.aborted&&message.status==="recognizing text")
          onProgress(`Reading image ${index+1}/${images.length}: ${Math.round((message.progress??0)*100)}%`);
      }
    });
    if(finished||signal?.aborted){await worker.terminate();throw cancelled();}
    await worker.setParameters({preserve_interword_spaces:"1",user_defined_dpi:"300"});
    const pages=[],warnings=[];
    for(index=0;index<images.length;index++){
      if(signal?.aborted)throw cancelled();
      const file=images[index],image=await prepareImage(file,env);
      const {data}=await worker.recognize(image,{}, {text:true});
      const text=cleanText(data.text);
      if(!text)throw new Error(`${file.name}: no readable text was found. Use a clearer image or a vision model.`);
      if(pages.reduce((n,page)=>n+page.text.length,0)+text.length>MAX_TEXT)
        throw new Error("The images contain too much text. Import a smaller batch.");
      const confidence=Number.isFinite(data.confidence)?data.confidence:0;
      pages.push({name:file.name,text,confidence});
      if(confidence<80)warnings.push(`${file.name}: image-reading confidence is ${Math.round(confidence)}%; check numbers and feature names against the screenshot.`);
    }
    warnings.push("Content was read from images. Compare ability scores, attack bonuses, dice and saving throw DCs with the original before importing.");
    return {pages,warnings};
  })();
  try{return await Promise.race([task,aborted]);}
  catch(error){if(signal?.aborted)throw cancelled();throw error;}
  finally{
    finished=true;signal?.removeEventListener("abort",onAbort);
    if(worker)await worker.terminate().catch(()=>{});
  }
}
