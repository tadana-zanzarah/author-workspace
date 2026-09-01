// Regression coverage for the design/character-surfaces-refinement branch:
// gallery stat/relationship-text removal, stable card height with internal
// scroll, the new single-value combobox popover (replacing browser-native
// <datalist> suggestions) and its reopen/custom/keyboard behavior, the three
// new appearance fields (eye/hair color, hairstyle), and the crop-slider
// palette fix. Deep coverage for multi-value chips, structural links CRUD,
// crop drag geometry, and modal focus trap already exists in sibling
// *-browser.test.mjs files and in character-surfaces-visual-system-browser
// .test.mjs (updated alongside this file for the intentional button-label
// changes) — this file only checks what's NEW in this phase.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8046,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

// char-links has many structural links so its card body must overflow the
// height cap and scroll internally — the point of check #5.
const linkTargets=Array.from({length:14},(_,i)=>({id:`char-link-target-${i}`,name:`Персонаж №${i+1}`,sortOrder:2000+i*10}));
const project={
  version:11,
  characters:[
    {id:"char-a",name:"Анна",sortOrder:1000},
    {id:"char-links",name:"Связная",sortOrder:1500},
    ...linkTargets
  ],
  profiles:{
    "char-a":{id:"char-a",characterId:"char-a",name:"Анна",race:"Человек",build:"Стройное",hidden:{},initialRelations:{"char-links":"Подруга"}},
    "char-links":{id:"char-links",characterId:"char-links",name:"Связная",hidden:{}},
    ...Object.fromEntries(linkTargets.map(c=>[c.id,{id:c.id,characterId:c.id,name:c.name,hidden:{}}]))
  },
  characterLinks:linkTargets.map((c,i)=>({id:`link-${i}`,fromCharacterId:"char-links",toCharacterId:c.id,category:"other",type:"custom",reverseType:"custom",customLabel:`Связь ${i+1}`,reverseCustomLabel:`Обратная связь ${i+1}`})),
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(6000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{if(sessionStorage.getItem("char-refinement-seeded"))return;sessionStorage.setItem("char-refinement-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");
  await page.waitForSelector("#charsModal",{state:"visible"});

  // ================= GALLERY =================
  {
    const grid=await page.evaluate(()=>document.getElementById("profilesGrid").textContent);
    // 1. Removed stats are gone entirely (not just relabeled).
    for(const removed of ["Хронология","Слов в сценах","Отношений"]){
      if(grid.includes(removed))throw new Error(`Removed gallery stat still present: ${removed}`);
    }
    // 2. The old relationship-summary text block is gone.
    if(await page.locator(".profile-relations-list").count())throw new Error("Relationship-summary block still renders in the gallery");
    // Retained stats are still there.
    for(const kept of ["Все сцены","Локации","Теги"]){
      if(!grid.includes(kept))throw new Error(`Expected gallery stat missing: ${kept}`);
    }

    // 3. Structural links remain, with real link labels (not truncated to a
    // "and N more" placeholder — the card scrolls instead, see check 5).
    const linksCard=page.locator('.profile-card[data-character-id="char-links"]');
    const structuralText=await linksCard.locator(".profile-structural-summary").textContent();
    // char-links is the link's "from" side, so its own card displays each
    // target under the *reverse* label (what the target is to char-links).
    if(!structuralText.includes("Обратная связь 1")||!structuralText.includes(`Обратная связь ${linkTargets.length}`))throw new Error(`Structural links summary missing entries: ${structuralText}`);

    // 4+5. Cards align to the same height, and the character with many links
    // scrolls internally instead of growing the card or moving the footer.
    const heights=await page.evaluate(()=>[...document.querySelectorAll(".profile-card")].map(c=>Math.round(c.getBoundingClientRect().height)));
    const distinctHeights=new Set(heights);
    if(distinctHeights.size!==1)throw new Error(`Gallery cards are not the same height: ${JSON.stringify(heights)}`);
    const scrollInfo=await linksCard.evaluate(el=>{
      const scroller=el.querySelector(".profile-card-scroll"),actions=el.querySelector(".profile-card-actions");
      return {scrollable:scroller.scrollHeight>scroller.clientHeight+1,actionsTop:actions.getBoundingClientRect().top,cardBottom:el.getBoundingClientRect().bottom};
    });
    if(!scrollInfo.scrollable)throw new Error("Character with many structural links did not need internal scroll — fixture too small to exercise check 5");
    const footerDistanceFromBottom=scrollInfo.cardBottom-scrollInfo.actionsTop;
    const shortCardFooterDistance=await page.locator('.profile-card[data-character-id="char-a"]').evaluate(el=>{
      const actions=el.querySelector(".profile-card-actions");
      return el.getBoundingClientRect().bottom-actions.getBoundingClientRect().top;
    });
    if(Math.abs(footerDistanceFromBottom-shortCardFooterDistance)>2)throw new Error(`Footer position differs between short and overflowing cards: ${footerDistanceFromBottom} vs ${shortCardFooterDistance}`);
  }

  // ================= COMBOBOX SYSTEM =================
  {
    await page.locator('.profile-card[data-character-id="char-a"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    // 15. Migrated fields no longer depend on the browser-native <datalist>
    // presentation — the `list` attribute is gone and ARIA combobox
    // semantics are in place instead.
    const migrated=["pf_race","pf_secondarySex","pf_build","pf_eyeColor","pf_hairColor","pf_hairstyle","pf_profession","pf_orientation"];
    const attrs=await page.evaluate(ids=>ids.map(id=>{
      const el=document.getElementById(id);
      return {id,hasList:el.hasAttribute("list"),role:el.getAttribute("role"),hasListbox:!!document.getElementById(`${id}_listbox`)};
    }),migrated);
    for(const a of attrs){
      if(a.hasList)throw new Error(`${a.id} still carries a native list= attribute`);
      if(a.role!=="combobox")throw new Error(`${a.id} is missing role=combobox`);
      if(!a.hasListbox)throw new Error(`${a.id} has no app-styled listbox`);
    }

    // 11. A populated combobox reopens showing the full suggestion list, not
    // just the one value already typed (the original bug being fixed).
    await page.fill("#pf_build","Стройное");
    await page.locator("#pf_build").dispatchEvent("change");
    await page.locator("#pf_build").blur();
    await page.locator("#pf_build").click();
    const optionCount=await page.locator("#pf_build_listbox [role=option]").count();
    if(optionCount<5)throw new Error(`Reopening a populated combobox did not show the full list (saw ${optionCount} options)`);
    const selectedOption=await page.locator('#pf_build_listbox [role=option][aria-selected="true"]').textContent();
    if(selectedOption.trim()!=="Стройное")throw new Error("Reopened list did not mark the current value as selected");

    // 12. Single+custom: picking a different suggestion REPLACES the value,
    // it doesn't append/duplicate.
    await page.locator('#pf_build_listbox [role=option]',{hasText:"Атлетическое"}).click();
    if(await page.inputValue("#pf_build")!=="Атлетическое")throw new Error("Selecting a suggestion did not replace the previous single value");

    // Custom free text: typing something with no match offers "Добавить «…»".
    await page.fill("#pf_hairColor","Огненно-рыжий");
    await page.locator("#pf_hairColor").dispatchEvent("input");
    const addOption=page.locator("#pf_hairColor_listbox [role=option]",{hasText:"Добавить «Огненно-рыжий»"});
    if(!await addOption.count())throw new Error("Custom value option did not appear for unmatched text");
    await addOption.click();
    if(await page.inputValue("#pf_hairColor")!=="Огненно-рыжий")throw new Error("Custom value was not accepted");

    // 14. Keyboard navigation: ArrowDown twice + Enter selects the 2nd option.
    await page.fill("#pf_race","");
    await page.locator("#pf_race").dispatchEvent("input");
    await page.locator("#pf_race").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const activeText=await page.locator("#pf_race_listbox [role=option].active").textContent();
    await page.keyboard.press("Enter");
    if(await page.inputValue("#pf_race")!==activeText.trim())throw new Error("Keyboard ArrowDown+Enter did not select the highlighted option");

    // Escape closes the popover without closing the modal underneath it
    // (modal-manager routes Escape to any open [role=combobox] first).
    await page.locator("#pf_race").click();
    if((await page.getAttribute("#pf_race","aria-expanded"))!=="true")throw new Error("Combobox did not reopen for the Escape check");
    await page.keyboard.press("Escape");
    if((await page.getAttribute("#pf_race","aria-expanded"))!=="false")throw new Error("Escape did not close the combobox popover");
    if(!await page.locator("#profileEditorModal").isVisible())throw new Error("Escape on an open combobox incorrectly closed the modal too");

    // 18. Focus remains visible on the combobox input.
    await page.locator("#pf_build").focus();
    const focusRing=await page.evaluate(()=>getComputedStyle(document.getElementById("pf_build")).outlineStyle);
    if(focusRing==="none")throw new Error("Combobox input lost its focus-visible outline");

    // 10+20. New appearance fields persist through save → reload.
    await page.fill("#pf_eyeColor","Зелёные");
    await page.locator("#pf_eyeColor").dispatchEvent("change");
    await page.fill("#pf_hairstyle","Короткая");
    await page.locator("#pf_hairstyle").dispatchEvent("change");
    await page.click("#saveProfile");
    await page.waitForSelector("#profileEditorModal",{state:"hidden"});
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).profiles["char-a"]);
    if(saved.eyeColor!=="Зелёные")throw new Error(`eyeColor did not persist: ${saved.eyeColor}`);
    if(saved.hairColor!=="Огненно-рыжий")throw new Error(`hairColor did not persist: ${saved.hairColor}`);
    if(saved.hairstyle!=="Короткая")throw new Error(`hairstyle did not persist: ${saved.hairstyle}`);
    if(saved.build!=="Атлетическое")throw new Error(`build did not persist: ${saved.build}`);

    await page.locator('.profile-card[data-character-id="char-a"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    if(await page.inputValue("#pf_eyeColor")!=="Зелёные")throw new Error("eyeColor did not reload correctly");
    if(await page.inputValue("#pf_hairColor")!=="Огненно-рыжий")throw new Error("hairColor did not reload correctly");
    if(await page.inputValue("#pf_hairstyle")!=="Короткая")throw new Error("hairstyle did not reload correctly");
    // 9. New fields also have hide checkboxes wired up like other fields.
    for(const id of ["hide_eyeColor","hide_hairColor","hide_hairstyle"]){
      if(!await page.locator(`#${id}`).count())throw new Error(`Missing hide checkbox: ${id}`);
    }
    await page.click("#cancelProfile");
  }

  // ================= PHOTOS =================
  {
    await page.locator('.profile-card[data-character-id="char-a"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const pngBase64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await page.setInputFiles("#profilePhotosInput",[
      {name:"a.png",mimeType:"image/png",buffer:Buffer.from(pngBase64,"base64")},
      {name:"b.png",mimeType:"image/png",buffer:Buffer.from(pngBase64,"base64")}
    ]);
    await page.waitForSelector('.photo-rail .photo-thumb:nth-child(2)');
    // 16. The primary portrait tile ends at its own content height — no
    // leftover space below the image + shared action row (superseded the
    // old per-thumbnail geometry check — secondary tiles are now plain
    // thumbnails with no action row of their own; see
    // character-profile-resume-layout-browser.test.mjs for the dedicated
    // photo-composition suite).
    const primaryGeometry=await page.evaluate(()=>{
      const item=document.querySelector(".photo-item-primary");
      const img=item.querySelector("img"),actions=item.querySelector(".photo-actions");
      const style=getComputedStyle(item);
      return {
        itemHeight:item.getBoundingClientRect().height,
        contentHeight:img.getBoundingClientRect().height+actions.getBoundingClientRect().height,
        borderTop:parseFloat(style.borderTopWidth),borderBottom:parseFloat(style.borderBottomWidth)
      };
    });
    const primarySlack=primaryGeometry.itemHeight-(primaryGeometry.contentHeight+primaryGeometry.borderTop+primaryGeometry.borderBottom);
    if(Math.abs(primarySlack)>1.5)throw new Error(`Primary photo tile has leftover space below its content: ${JSON.stringify(primaryGeometry)}`);
    // 5. App-styled upload trigger is present and the raw input, while
    // clipped off-screen, is still a real tab stop (kept keyboard-usable).
    const trigger=await page.evaluate(()=>{
      const btn=document.querySelector(".photo-upload-button"),input=document.getElementById("profilePhotosInput");
      return {btnText:btn.textContent.trim(),inputTabbable:input.tabIndex>=0,inputRect:input.getBoundingClientRect().width};
    });
    if(!trigger.btnText.includes("Добавить фото"))throw new Error("App-styled photo upload trigger missing");
    if(!trigger.inputTabbable)throw new Error("Native file input lost its tab stop after being visually hidden");
    // Save (rather than discard) so the uploaded photos exist for the crop
    // slider check below.
    await page.click("#saveProfile");
    await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  }

  // ================= CROP SLIDER PALETTE =================
  {
    await page.locator('.profile-card[data-character-id="char-a"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    await page.locator('[data-action="crop-photo"]').click();
    await page.waitForSelector("#photoCropModal",{state:"visible"});
    // 17+19. The range slider uses the warm brand accent, not browser blue.
    const accent=await page.evaluate(()=>getComputedStyle(document.getElementById("photoCropZoom")).accentColor);
    if(accent!=="rgb(95, 65, 40)")throw new Error(`Crop zoom slider is not using the brand accent color: ${accent}`);
    await page.click("#cancelPhotoCrop");
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  if(errors.length)throw new Error(`Console/page errors during test: ${errors.join(" | ")}`);
  console.log("Character surfaces refinement browser tests: OK");
}finally{await browser.close();server.kill()}
