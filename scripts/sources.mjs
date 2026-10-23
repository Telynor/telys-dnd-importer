import {MAX_TEXT} from "./constants.mjs";
import {bridgeEndpoint, postJSON} from "./providers.mjs";
import {cleanText, safeURL} from "./utils.mjs";

export function htmlToText(html) {
  const doc=new DOMParser().parseFromString(html,"text/html");
  for(const node of doc.querySelectorAll("script,style,noscript,iframe,svg,nav,footer,aside,form,button,[hidden],[aria-hidden='true']"))node.remove();
  for(const node of doc.querySelectorAll("header"))if(!node.closest("article,main,[role='main']"))node.remove();
  const root=doc.querySelector("article,main,[role='main']")??doc.body;
  for(const node of root.querySelectorAll("br"))node.replaceWith(doc.createTextNode("\n"));
  for(const node of root.querySelectorAll("p,div,section,article,h1,h2,h3,h4,h5,h6,li,tr,blockquote")){node.prepend(doc.createTextNode("\n"));node.append(doc.createTextNode("\n"));}
  for(const cell of root.querySelectorAll("th,td"))cell.append(doc.createTextNode(" | "));
  return cleanText(root.textContent??"");
}
export async function fetchSource(url,{bridge="",bridgeToken="",signal,fetcher=fetch}={}) {
  const safe=safeURL(url);let text,finalURL=safe;
  if(bridge){const result=await postJSON(bridgeEndpoint(bridge,"/fetch"),{url:safe},{bridgeToken,signal,timeout:45000,fetcher});text=String(result.text??"");finalURL=result.url??safe;}
  else{
    let response;
    try{response=await fetcher(safe,{signal,credentials:"omit",referrerPolicy:"no-referrer",redirect:"error"});}
    catch(error){if(signal?.aborted||error.name==="AbortError")throw new DOMException("Cancelled","AbortError");throw new Error("This page could not be fetched directly. Use the companion bridge, or paste the visible page text.");}
    if(!response.ok)throw new Error(`The page returned ${response.status}. Paste its visible content or use another source.`);
    if(Number(response.headers.get("Content-Length"))>5_000_000)throw new Error("The page is too large; paste the relevant section.");
    const type=response.headers.get("Content-Type")??"";
    if(!/text\/(?:html|plain)|application\/xhtml\+xml/i.test(type))throw new Error("Web links must contain HTML or plain text. Attach an image separately.");
    const body=await response.text();if(body.length>5_000_000)throw new Error("The page is too large; paste the relevant section.");
    text=/html/i.test(type)?htmlToText(body):cleanText(body);
  }
  if(!text.trim())throw new Error("No readable page text was found. Paste the content or attach screenshots.");
  if(text.length>MAX_TEXT)throw new Error("The page has too much text; paste only the relevant content.");
  if(text.length<1500&&/captcha|enable javascript|access denied|verify you are human|just a moment|sign in to continue/i.test(text))throw new Error("This site requires a browser or sign-in. Paste the content you can access, or attach screenshots.");
  return {text,url:finalURL};
}
