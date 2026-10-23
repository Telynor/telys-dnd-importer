export const clone = value => structuredClone(value);
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const paragraphHTML = value => String(value ?? "").split(/\n\s*\n/).filter(Boolean).map(p => `<p>${escapeHTML(p).replaceAll("\n", "<br>")}</p>`).join("");
export const normalizeName = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9+]+/g," ").trim().replace(/\s+/g," ");
export const slug = value => normalizeName(value).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
// Class features with the same name can have different rules at different levels.
// The requirements fallback also recognizes class features from the first alpha.
export function featureContext(doc) {
  const explicit=doc.flags?.["telys-dnd-importer"]?.featureContext;
  if(explicit)return String(explicit);
  return doc.type==="feat"&&doc.system?.type?.value==="class"&&doc.system.requirements
    ?`class-feature:${normalizeName(doc.system.requirements)}`:"";
}
export const cleanText = value => String(value ?? "").replace(/\r\n?/g,"\n").replace(/\u00ad/g,"").replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[\u2018\u2019]/g,"'").replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{4,}/g,"\n\n\n").trim();
export function randomID() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const data = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(data);
  else for (let i=0;i<data.length;i++) data[i]=Math.floor(Math.random()*256);
  return Array.from(data, n=>chars[n%chars.length]).join("");
}
export function number(value, fallback=0, min=-Infinity, max=Infinity) {
  if(value===undefined||value===null||value==="")return fallback;
  const n = typeof value === "number" ? value : Number(String(value ?? "").replaceAll(",",""));
  return Number.isFinite(n) ? Math.min(max, Math.max(min,n)) : fallback;
}
export function safeFormula(value, fallback="") {
  const s=String(value??"").trim();
  if (!s) return fallback;
  if (s.length>200 || !/^[\d\s@a-zA-Z_.$+*/%(),\-]+$/.test(s) || /(?:constructor|prototype|__proto__|eval|function|import|window|global|process|fetch)/i.test(s)) throw new Error(`Unsupported roll formula: ${s.slice(0,80)}`);
  return s;
}
export function rejectDangerousKeys(value, depth=0) {
  if(depth>35) throw new Error("Import nesting exceeds 35 levels.");
  if (!value || typeof value!=="object") return;
  for(const key of Object.keys(value)) {
    if (["__proto__","prototype","constructor"].includes(key)) throw new Error(`Disallowed field: ${key}`);
    rejectDangerousKeys(value[key],depth+1);
  }
}
export function stableStringify(value) {
  if(Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if(value && typeof value === "object") return `{${Object.keys(value).filter(k=>k!=="_stats").sort().map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function digest(value) {
  const s=typeof value==="string"?value:stableStringify(value);
  let a=2166136261,b=0x9e3779b9;
  for(let i=0;i<s.length;i++) {a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),2246822519);}
  return `${(a>>>0).toString(16).padStart(8,"0")}${(b>>>0).toString(16).padStart(8,"0")}`;
}
export function unique(values) {return [...new Set(values)];}
export function asArray(value) {return value==null?[]:Array.isArray(value)?value:[value];}
export function assertGM() {if (!globalThis.game?.user?.isGM) throw new Error("Only a GM can import content.");}
export function safeURL(value, {local=false}={}) {
  let u;
  try {u=new URL(String(value));} catch {throw new Error("Enter a complete http:// or https:// URL.");}
  if(!["https:","http:"].includes(u.protocol)||u.username||u.password) throw new Error("Use an HTTP(S) URL without embedded credentials.");
  const h=u.hostname.toLowerCase();
  if(!local && (h==="localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.includes(":") || h==="0.0.0.0" || h.startsWith("169.254."))) throw new Error("Web source links must point to public websites.");
  u.hash="";
  return u.href;
}
export function safeImagePath(value) {
  const s=String(value??"").trim();
  if(!s) return "";
  if(s.length>2048 || /[<>"'\u0000-\u001f]/.test(s) || /^(?:data|javascript|file|vbscript):/i.test(s) || s.startsWith("//")) return "";
  if(/^https?:/i.test(s)) {try{return safeURL(s);}catch{return "";}}
  return /^(?:icons|modules|systems|worlds|assets|uploads|tokens|portraits|images)\//.test(s)?s:"";
}
export async function mapLimit(values, concurrency, fn) {
  const out=new Array(values.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,values.length)},async()=>{while(next<values.length){const i=next++;out[i]=await fn(values[i],i);}}));
  return out;
}
export function parseJSONResponse(raw) {
  let s=String(raw??"").trim();
  if(s.length>2_000_000) throw new Error("Model response exceeds the import limit.");
  s=s.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
  try {const data=JSON.parse(s);rejectDangerousKeys(data);return data;}
  catch(error) {throw new Error(`The extraction did not return valid import JSON: ${error.message}`);}
}
