// Stage E3.2.1 real-phone fix: `crypto.randomUUID()` is part of the Web
// Crypto API's secure-context-gated surface -- browsers only expose it on
// https, `localhost`, and `file://` origins. A phone reaching this dev
// server over plain LAN HTTP (`http://172.22.x.x:8000`, NOT `localhost`)
// is not a secure context, so `crypto.randomUUID` is simply undefined
// there, throwing "crypto.randomUUID is not a function" the moment any of
// this app's several existing draft-id call sites (character image
// upload, location media upload, location history events, local-to-cloud
// migration attempt id) ran. Desktop testing never caught this because
// `http://localhost:8000` IS special-cased as a secure context by every
// major browser even without TLS.
//
// `crypto.getRandomValues()`, by contrast, is the OLDER, broader-support
// half of the Web Crypto API and is NOT secure-context-gated -- it is
// available on the same insecure LAN-HTTP origin where `randomUUID` is
// missing. This is the standard, well-known polyfill technique: build an
// RFC 4122 version-4 UUID by hand from 16 cryptographically random bytes
// with `getRandomValues`, rather than falling back to something weaker.
// Only if EVEN `crypto`/`getRandomValues` is entirely absent (no known
// case in this app's supported browsers, but a defensive last resort) does
// this fall back further, and even then to a properly UUID-v4-SHAPED
// (versioned/varianted) string built from `Math.random()`, never a bare
// timestamp or raw random number -- these existing call sites use the id
// as an actual storage path segment / database key (see js/locations.js's
// own comment on `createDraftMediaItem`), so collision-resistance matters
// even in this last-resort tier.
function generateUuid(){
  if(typeof crypto!=="undefined"&&typeof crypto.randomUUID==="function")return crypto.randomUUID();
  if(typeof crypto!=="undefined"&&typeof crypto.getRandomValues==="function"){
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=bytes[6]&0x0f|0x40;// version 4
    bytes[8]=bytes[8]&0x3f|0x80;// variant 10xx
    const hex=[...bytes].map(b=>b.toString(16).padStart(2,"0"));
    return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10,16).join("")}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
    const r=Math.random()*16|0,v=c==="x"?r:r&0x3|0x8;
    return v.toString(16);
  });
}

Object.assign(globalThis,{generateUuid});
export {generateUuid};
