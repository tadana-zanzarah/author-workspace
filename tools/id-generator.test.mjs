import assert from "node:assert/strict";
import {generateUuid} from "../js/id-generator.js";

const UUID_V4_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const originalCrypto=globalThis.crypto;
function restoreCrypto(){Object.defineProperty(globalThis,"crypto",{value:originalCrypto,configurable:true,writable:true})}

// 1. Native path: when crypto.randomUUID exists, it must actually be used
// (not silently bypassed) -- proven by stubbing it to a known fixed value.
{
  const fixed="11111111-2222-4333-8444-555555555555";
  Object.defineProperty(globalThis,"crypto",{value:{...originalCrypto,randomUUID:()=>fixed},configurable:true,writable:true});
  assert.equal(generateUuid(),fixed,"generateUuid must delegate to crypto.randomUUID when it is available");
  restoreCrypto();
}

// 2. Stage E3.2.1 real-phone case: crypto.randomUUID is undefined (the
// actual observed Android/LAN-HTTP-insecure-context failure) but
// crypto.getRandomValues -- the older, non-secure-context-gated half of
// the Web Crypto API -- is still present. generateUuid must not throw, and
// must still produce a properly versioned/varianted (v4) UUID, not a
// trivial timestamp/Math.random-only id.
{
  Object.defineProperty(globalThis,"crypto",{value:{getRandomValues:originalCrypto.getRandomValues.bind(originalCrypto)},configurable:true,writable:true});
  assert.equal(typeof globalThis.crypto.randomUUID,"undefined","test setup: randomUUID must actually be absent for this case");
  let id;
  assert.doesNotThrow(()=>{id=generateUuid()},"generateUuid must not throw when crypto.randomUUID is unavailable but getRandomValues is present");
  assert.match(id,UUID_V4_RE,`fallback id must be a properly-shaped v4 UUID: ${id}`);
  const seen=new Set();
  for(let i=0;i<500;i++){
    const next=generateUuid();
    assert.match(next,UUID_V4_RE,`fallback id must be a properly-shaped v4 UUID: ${next}`);
    assert.equal(seen.has(next),false,"fallback ids must not collide across repeated calls");
    seen.add(next);
  }
  restoreCrypto();
}

// 3. Defensive last resort: crypto itself is entirely unavailable. Still
// must not throw, and must still be a real v4-shaped UUID (never a bare
// timestamp or a raw Math.random() number).
{
  Object.defineProperty(globalThis,"crypto",{value:undefined,configurable:true,writable:true});
  let id;
  assert.doesNotThrow(()=>{id=generateUuid()},"generateUuid must not throw when crypto is entirely unavailable");
  assert.match(id,UUID_V4_RE,`last-resort id must be a properly-shaped v4 UUID: ${id}`);
  restoreCrypto();
}

// 4. Native crypto.randomUUID, once restored, is used again (no lingering
// state from the fallback paths above).
{
  assert.equal(typeof globalThis.crypto.randomUUID,"function","test setup: native randomUUID must be restored");
  const id=generateUuid();
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,`restored native path must still produce a UUID: ${id}`);
}

console.log("id-generator unit tests: OK");
