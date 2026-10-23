import {MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TEXT} from "./constants.mjs";
import {extractionPrompt} from "./prompt.mjs";
import {normalizeBundle} from "./schema.mjs";
import {parseJSONResponse, safeURL} from "./utils.mjs";

export function chatEndpoint(value) {
  const u=new URL(safeURL(value,{local:true}));
  if(u.search)throw new Error("Model endpoint URLs must not contain query parameters; use the separate key field.");
  u.pathname=u.pathname.replace(/\/$/,"");
  if(!u.pathname.endsWith("/chat/completions"))u.pathname+="/chat/completions";
  return u.href;
}
export function bridgeEndpoint(value,path) {
  const u=new URL(safeURL(value,{local:true}));
  if(!["localhost","127.0.0.1","[::1]"].includes(u.hostname))throw new Error("The companion bridge must be on this computer (localhost).");
  if(u.search)throw new Error("Do not put the bridge token in its URL.");
  u.pathname=u.pathname.replace(/\/$/,"")+path;return u.href;
}
function redact(message,secrets){
  let text=String(message??"");
  for(const secret of secrets)if(secret)text=text.replaceAll(secret,"[redacted]");
  return text.replace(/[\u0000-\u001f]/g," ").slice(0,300);
}
export async function postJSON(url,body,{key="",bridgeToken="",signal,timeout=180000,fetcher=fetch}={}) {
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
  signal?.addEventListener("abort",abort,{once:true});const timer=setTimeout(()=>controller.abort(new Error("Request timed out.")),timeout);
  try{
    const response=await fetcher(url,{method:"POST",headers:{"Content-Type":"application/json",...(key?{Authorization:`Bearer ${key}`}:{}) ,...(bridgeToken?{"X-Tely-Token":bridgeToken}:{})},body:JSON.stringify(body),signal:controller.signal,credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"});
    if(!response.ok){
      let detail="";
      if(Number(response.headers.get("Content-Length")??0)<100_000){
        try{const data=await response.json();detail=redact(data.error?.message??data.error??"",[key,bridgeToken,body.apiKey]);}catch{/* Non-JSON error pages are not shown. */}
      }
      throw new Error(`Request failed (${response.status}). ${detail||"Check the endpoint, model, credentials, and companion origin settings."}`);
    }
    const contentLength=Number(response.headers.get("Content-Length")??0);if(contentLength>4_000_000)throw new Error("Response exceeded the extraction limit.");
    const text=await response.text();if(text.length>4_000_000)throw new Error("Response exceeded the extraction limit.");
    const result=JSON.parse(text);if(result.error)throw new Error(redact(result.error.message??result.error,[key,bridgeToken,body.apiKey]));return result;
  }catch(error){if(signal?.aborted)throw new DOMException("Cancelled","AbortError");if(controller.signal.aborted)throw new Error("The extraction timed out. Try fewer pages or a smaller source.");if(error instanceof TypeError)throw new Error("The endpoint could not be reached. Check its address/CORS settings, or use the companion bridge.");throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
export async function testModelConnection({config,credentials={},signal,fetcher=fetch}){
  if(!config?.model?.trim())throw new Error("Enter the exact installed model name first.");
  if(!config.endpoint)throw new Error("Enter the model endpoint first.");
  const request={model:config.model.trim(),messages:[{role:"user",content:'Reply with the JSON object {"ready":true}.'}],max_tokens:64,stream:false};
  if(config.jsonMode!==false)request.response_format={type:"json_object"};
  const endpoint=chatEndpoint(config.endpoint);
  const response=config.bridge
    ?await postJSON(bridgeEndpoint(config.bridge,"/extract"),{endpoint,apiKey:credentials.apiKey??"",request},{bridgeToken:credentials.bridgeToken,signal,fetcher})
    :await postJSON(endpoint,request,{key:credentials.apiKey,signal,fetcher});
  if(typeof response.choices?.[0]?.message?.content!=="string")throw new Error("The server did not return a chat-completions response. Check its endpoint and model.");
  return {ok:true,model:config.model.trim()};
}
async function fileDataURL(file) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error(`Could not read ${file.name}`));reader.readAsDataURL(file);});
}
export async function extractWithModel({text="",images=[],kind="auto",rules="2014",config,credentials={},signal,fetcher=fetch}) {
  if(!config?.model?.trim())throw new Error("Set an extraction model in Model & connection first.");
  if(!config.endpoint)throw new Error("Set a chat-completions endpoint in Model & connection first.");
  if(text.length>MAX_TEXT)throw new Error("Too much source text; split the import into smaller batches.");
  if(images.length>MAX_IMAGES||images.reduce((n,f)=>n+f.size,0)>MAX_IMAGE_BYTES)throw new Error(`Use at most ${MAX_IMAGES} images and 20 MB per batch.`);
  const content=[{type:"text",text:text||"Transcribe and import all complete D&D content shown in the attached images."}];
  for(const file of images){if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("Vision inputs must be PNG, JPEG, or WebP.");content.push({type:"image_url",image_url:{url:await fileDataURL(file)}});}
  const request={model:config.model.trim(),temperature:0,max_tokens:Math.max(1024,Math.min(32768,Number(config.maxTokens)||8192)),messages:[{role:"system",content:extractionPrompt({rules,kind})},{role:"user",content:images.length?content:text}],stream:false};
  if(config.jsonMode!==false)request.response_format={type:"json_object"};
  const endpoint=chatEndpoint(config.endpoint);
  const response=config.bridge?await postJSON(bridgeEndpoint(config.bridge,"/extract"),{endpoint,apiKey:credentials.apiKey??"",request},{bridgeToken:credentials.bridgeToken,signal,fetcher}):await postJSON(endpoint,request,{key:credentials.apiKey,signal,fetcher});
  const result=response.choices?.[0];
  if(result?.finish_reason==="length")throw new Error("The model response was cut off. Increase the output limit or import fewer entries.");
  const answer=result?.message?.content;
  if(typeof answer!=="string")throw new Error("The model returned no JSON content. Check that it supports chat completions and vision when images are attached.");
  return normalizeBundle(parseJSONResponse(answer),{rules});
}
