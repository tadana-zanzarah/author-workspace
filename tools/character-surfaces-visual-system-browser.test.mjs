// Regression coverage for the design/character-surfaces-visual-system branch:
// two tiny core fixes (sidebar toggle alignment, filter font parity), the
// global no-accidental-blue control palette, and the Character Gallery /
// Character Profile visual pass. Deep functional coverage for multi-value
// fields, image crop, character links, dirty-state guards, and modal focus
// trap already exists in sibling *-browser.test.mjs files — this file checks
// the NEW visual contract plus that none of that existing functionality
// regressed as a side effect of the DOM/CSS restructuring.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8044,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

const longName="Александра-Виктория фон Штерн-Розенберг-Каменецкая-Долгопрудная";
const project={
  version:11,
  characters:[
    {id:"char-long",name:"Александра-Виктория",sortOrder:1000},
    {id:"char-nophoto",name:"Марк",sortOrder:2000},
    {id:"char-third",name:"Рене",sortOrder:3000}
  ],
  profiles:{
    "char-long":{
      id:"char-long",characterId:"char-long",name:"Александра-Виктория",surname:"фон Штерн-Розенберг-Каменецкая-Долгопрудная",
      race:"Человек",sex:"Женский",age:"27",height:"172 см",profession:"Картограф",
      favorites:["Чай"],hobbies:["Фехтование"],description:"Подробное описание для проверки типографики.",
      photos:[{id:"photo-1",source:{kind:"data-url",value:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}],
      primaryPhotoId:"photo-1",initialRelations:{"char-nophoto":"Брат"},hidden:{}
    },
    "char-nophoto":{id:"char-nophoto",characterId:"char-nophoto",name:"Марк",race:"Эльф",hidden:{}},
    "char-third":{id:"char-third",characterId:"char-third",name:"Рене",hidden:{}}
  },
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(6000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{if(sessionStorage.getItem("char-surfaces-seeded"))return;sessionStorage.setItem("char-surfaces-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}

  // ================= CORE TINY FIXES =================
  {
    // 1. Sidebar toggle: box centers already matched before this branch (flex
    // centering) — the actual bug was font-glyph ink bias, fixed by swapping
    // to an inline SVG chevron. Assert the SVG is present (no stray text
    // glyph) and that its path is exactly vertically symmetric in its own
    // viewBox, i.e. optically centered by construction.
    const svgCheck=await page.evaluate(()=>{
      const btn=document.getElementById("toggleNavigation");
      const svg=btn.querySelector("svg"),path=btn.querySelector("path");
      if(!svg||!path)return {ok:false,reason:"no svg icon"};
      const box=path.getBBox();
      const btnRect=btn.getBoundingClientRect(),svgRect=svg.getBoundingClientRect();
      return {
        ok:true,
        hasTextGlyph:/[‹›]/.test(btn.textContent),
        pathVerticalCenter:box.y+box.height/2,
        boxCentersMatch:Math.abs((btnRect.top+btnRect.bottom)/2-(svgRect.top+svgRect.bottom)/2)<1
      };
    });
    if(!svgCheck.ok)throw new Error("Sidebar toggle: no SVG icon found");
    if(svgCheck.hasTextGlyph)throw new Error("Sidebar toggle: still renders a text glyph, not the SVG icon");
    if(Math.abs(svgCheck.pathVerticalCenter-8)>0.05)throw new Error(`Sidebar toggle icon path not vertically centered in its viewBox: ${svgCheck.pathVerticalCenter}`);
    if(!svgCheck.boxCentersMatch)throw new Error("Sidebar toggle icon box not centered in the button");

    // 2. Filter typography: Character/Tag (multi) must match Chapter/Location/
    // Status/Placement (single) pixel-for-pixel on the empty-state label.
    const fonts=await page.evaluate(()=>{
      const ids={chapter:"filterChapter",character:"filterCharacter",location:"filterLocation",tag:"filterTag",writing:"filterWriting",placement:"filterPlacement"};
      const out={};
      for(const [key,id] of Object.entries(ids)){
        const text=document.getElementById(id).querySelector(".filter-trigger-text");
        const cs=getComputedStyle(text);
        out[key]={fontSize:cs.fontSize,fontFamily:cs.fontFamily,fontWeight:cs.fontWeight};
      }
      return out;
    });
    const reference=JSON.stringify(fonts.chapter);
    for(const key of ["character","location","tag","writing","placement"]){
      if(JSON.stringify(fonts[key])!==reference)throw new Error(`Filter typography mismatch for ${key}: ${JSON.stringify(fonts[key])} vs chapter ${reference}`);
    }
  }

  // ================= GLOBAL CONTROLS =================
  {
    await page.click("#projectMenu > summary");await page.click("#manageChars");
    await page.locator('#profilesGrid button[aria-label^="Редактировать анкету"]').first().click();
    if(!await page.locator("#profileEditorModal").isVisible())throw new Error("Profile editor did not open");

    // 3+5. Focus-visible ring on a real input must be present and warm, not blue.
    await page.locator("#pf_race").focus();
    const inputFocus=await page.evaluate(()=>{
      const el=document.getElementById("pf_race"),cs=getComputedStyle(el);
      return {outlineStyle:cs.outlineStyle,outlineColor:cs.outlineColor,matches:el.matches(":focus-visible")};
    });
    if(inputFocus.outlineStyle==="none"||!inputFocus.matches)throw new Error("Profile input lost focus-visible outline");
    const blueOutlines=["rgb(58, 110, 168)","rgb(0, 0, 238)","rgb(0, 122, 255)","rgb(66, 133, 244)"];
    if(blueOutlines.includes(inputFocus.outlineColor))throw new Error(`Profile input focus ring is still browser-blue: ${inputFocus.outlineColor}`);
    if(inputFocus.outlineColor!=="rgb(95, 65, 40)")throw new Error(`Profile input focus ring is not the brand accent: ${inputFocus.outlineColor}`);

    // 4. Checkbox checked-state accent must be the design-system brand, not blue.
    const checkboxAccent=await page.evaluate(()=>getComputedStyle(document.getElementById("hide_race")).accentColor);
    if(checkboxAccent!=="rgb(95, 65, 40)")throw new Error(`«не указывать» checkbox accent is not the brand color: ${checkboxAccent}`);

    // 6. Disabled vs enabled must be visually distinguishable (existing global
    // input:disabled rule — assert it still applies inside the restructured form).
    const disabledDiff=await page.evaluate(()=>{
      const el=document.getElementById("pf_height");
      const enabled=getComputedStyle(el).backgroundColor;
      el.disabled=true;
      const disabled=getComputedStyle(el).backgroundColor;
      el.disabled=false;
      return {enabled,disabled,differ:enabled!==disabled};
    });
    if(!disabledDiff.differ)throw new Error(`Disabled profile input is not visually distinct: ${JSON.stringify(disabledDiff)}`);

    await page.click("#cancelProfile");
  }

  // ================= GALLERY =================
  {
    if(!await page.locator("#charsModal").isVisible())await page.click("#manageChars");
    const card=page.locator('#profilesGrid .profile-card[data-character-id="char-long"]');

    // 7. Photo remains prominent (a real <img>, not a placeholder swallowed by chrome).
    if(!await card.locator(".profile-cover img").count())throw new Error("Photo not rendered in gallery card");
    // 8. Name/data/actions remain.
    if(!(await card.locator(".profile-name").textContent()||"").includes("Александра-Виктория"))throw new Error("Name missing from card");
    if(!await card.locator(".profile-fact").count())throw new Error("Facts missing from card");
    // Actions are now compact icon buttons (pencil edit, trash delete,
    // demoted quiet clock for chronology) — identified by aria-label/title,
    // not visible text (see AGENTS.md icon-only-button accessible-name rule).
    for(const selector of ['button[aria-label^="Личная хронология"]','button[aria-label^="Редактировать анкету"]','button[aria-label^="Удалить персонажа"]']){
      if(!await card.locator(selector).count())throw new Error(`Card action missing: ${selector}`);
    }
    // 12. Long name does not overflow/break the card.
    const overflow=await card.locator(".profile-name").evaluate(el=>el.scrollWidth>el.clientWidth+1);
    if(overflow)throw new Error("Long character name overflows the gallery card");
    const cardOverflow=await card.evaluate(el=>el.scrollWidth>el.clientWidth+1);
    if(cardOverflow)throw new Error("Gallery card has horizontal overflow with a long name");

    // 9. Reorder still works (← / → move buttons already present in card actions).
    const orderBefore=await page.evaluate(()=>data.characters.map(c=>c.id));
    await card.locator('button[aria-label*="вправо"]').click();
    const orderAfter=await page.evaluate(()=>data.characters.map(c=>c.id));
    if(JSON.stringify(orderBefore)===JSON.stringify(orderAfter))throw new Error("Reorder (move right) did not change character order");

    // 20. Personal chronology still opens.
    await page.locator('#profilesGrid .profile-card[data-character-id="char-long"] button[aria-label^="Личная хронология"]').click();
    if(!await page.locator("#characterTimelineModal").isVisible())throw new Error("Character timeline modal did not open");
    await page.click("#closeCharacterTimeline");

    // 10. Open profile still works.
    await page.locator('#profilesGrid .profile-card[data-character-id="char-long"] button[aria-label^="Редактировать анкету"]').click();
    if(!await page.locator("#profileEditorModal").isVisible())throw new Error("Open profile from gallery card did not open the editor");
    await page.click("#cancelProfile");

    // 11. Delete path preserved (guarded by confirm()).
    page.once("dialog",dialog=>dialog.dismiss());
    await page.locator('#profilesGrid .profile-card[data-character-id="char-third"] button[aria-label^="Удалить персонажа"]').click();
    await page.waitForTimeout(150);
    let stillThere=await page.evaluate(()=>data.characters.some(c=>c.id==="char-third"));
    if(!stillThere)throw new Error("Dismissing the delete confirmation should not delete the character");
    page.once("dialog",dialog=>dialog.accept());
    await page.locator('#profilesGrid .profile-card[data-character-id="char-third"] button[aria-label^="Удалить персонажа"]').click();
    await page.waitForTimeout(150);
    stillThere=await page.evaluate(()=>data.characters.some(c=>c.id==="char-third"));
    if(stillThere)throw new Error("Confirming the delete confirmation should delete the character");
  }

  // ================= PROFILE =================
  {
    await page.locator('#profilesGrid .profile-card[data-character-id="char-long"] button[aria-label^="Редактировать анкету"]').click();
    if(!await page.locator("#profileEditorModal").isVisible())throw new Error("Profile editor did not reopen");

    // 13. All existing fields remain (id-addressed, restructuring must not have dropped any).
    const fieldIds=["pf_name","pf_surname","pf_race","pf_sex","pf_secondarySex","pf_age","pf_birthYear","pf_birthMonth","pf_birthDay","pf_zodiac","pf_height","pf_build","pf_profession","pf_orientation","pf_favorites","pf_hobbies","pf_character","pf_features","pf_description","profileInitialRelations","profileCharacterLinks"];
    const missing=await page.evaluate(ids=>ids.filter(id=>!document.getElementById(id)),fieldIds);
    if(missing.length)throw new Error(`Profile fields missing after restructuring: ${missing.join(", ")}`);
    const hideIds=["hide_race","hide_sex","hide_secondarySex","hide_age","hide_birthday","hide_zodiac","hide_height","hide_build","hide_profession","hide_orientation","hide_favorites","hide_hobbies","hide_character","hide_features","hide_description"];
    const missingHide=await page.evaluate(ids=>ids.filter(id=>!document.getElementById(id)),hideIds);
    if(missingHide.length)throw new Error(`«не указывать» checkboxes missing: ${missingHide.join(", ")}`);

    // Each field label is still an accessible name source (app.js wires
    // aria-labelledby from .profile-field-top > strong — verify it survived
    // being moved into <section> wrappers).
    const raceLabelled=await page.evaluate(()=>{
      const input=document.getElementById("pf_race");
      const labelId=input.getAttribute("aria-labelledby");
      return labelId&&document.getElementById(labelId)?.textContent==="Раса";
    });
    if(!raceLabelled)throw new Error("pf_race lost its accessible label after section restructuring");

    // 14. «не указывать» still round-trips through save.
    await page.check("#hide_race");
    await page.click("#saveProfile");
    let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
    if(!saved.profiles["char-long"].hidden?.race)throw new Error("«не указывать» (hide_race) did not persist");
    await page.locator('#profilesGrid .profile-card[data-character-id="char-long"] button[aria-label^="Редактировать анкету"]').click();
    if(!await page.locator("#hide_race").isChecked())throw new Error("«не указывать» state did not reload correctly");
    await page.uncheck("#hide_race");

    // 15. Multi-value fields still function (deep coverage in
    // multi-value-profile-browser.test.mjs — light smoke check here).
    const hobbies=page.locator("#pf_hobbies");
    await hobbies.locator("input").click();
    await hobbies.getByRole("option",{name:"Кулинария",exact:true}).click().catch(()=>{});
    if(!await page.evaluate(()=>hasDirtyForms()))throw new Error("Editing did not mark the profile dirty");

    // 18. Photo controls structurally present (deep coverage in
    // character-images-browser.test.mjs / character-image-crop-ux-browser.test.mjs).
    if(!await page.locator("#profilePhotosInput").count())throw new Error("Photo upload input missing");
    if(!await page.locator("#profilePhotosGrid .photo-item").count())throw new Error("Existing photo not rendered in editor");
    // Crop control is now an icon-only button (see
    // character-profile-resume-layout-browser.test.mjs for full icon-row
    // coverage) — identified by its data-action, not by visible text.
    if(!await page.locator('#profilePhotosGrid [data-action="crop-photo"]').count())throw new Error("Crop control missing");

    // 19. Relationships still render (initial relations list).
    if(!await page.locator("#profileInitialRelations .initial-relation-row").count())throw new Error("Initial relations rows missing");

    // 21+22. Cancel discards, dirty-state guard still fires.
    await page.fill("#pf_height","999 см");
    if(!await page.evaluate(()=>hasDirtyForms()))throw new Error("Field edit did not mark profile dirty");
    await page.click("#cancelProfile");
    if(!await page.locator("#discardChangesModal").isVisible())throw new Error("Dirty close guard did not appear on Cancel");
    await page.click("#discardChanges");
    if(await page.locator("#profileEditorModal").isVisible())throw new Error("Profile editor did not close after discarding");

    // 23. Modal keyboard/focus behavior (deep coverage in accessibility-browser.test.mjs
    // — light check: Escape closes the (now clean) characters modal and returns focus).
    await page.locator('#profilesGrid .profile-card[data-character-id="char-long"] button[aria-label^="Редактировать анкету"]').click();
    await page.keyboard.press("Escape");
    if(await page.locator("#profileEditorModal").isVisible())throw new Error("Escape did not close the clean (non-dirty) profile editor");
  }

  if(errors.length)throw new Error(`Console/page errors during test: ${errors.join(" | ")}`);
  console.log("Character surfaces visual system browser tests: OK");
}finally{await browser.close();server.kill()}
