// Regression coverage for the design/character-profile-resume-layout branch:
// Character Profile top area recomposed as a compact character résumé
// (portrait + name/surname/birth-date/age/zodiac) instead of leading with
// photo-management/save-scope chrome; save-scope moved out of the résumé
// into a radio choice in the sticky footer; Character Gallery cards grew
// taller and gained eye/hair color facts. Checklist below mirrors the task's
// acceptance list (PROFILE RESUME 1-11, SAVE SCOPE 12-20, GALLERY 21-30).
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8048,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dataUrl=`data:image/png;base64,${png}`;
const project={
  version:11,
  characters:[
    {id:"resume-full",name:"Рене",sortOrder:1000},
    {id:"resume-partial",name:"Марго",sortOrder:2000},
    {id:"resume-nophoto",name:"Без фото",sortOrder:3000},
    {id:"gallery-short",name:"Коротко",sortOrder:4000}
  ],
  profiles:{
    "resume-full":{
      id:"resume-full",characterId:"resume-full",name:"Рене",surname:"де Лакруа-Монферран",
      race:"Человек",sex:"Женский",birthday:{year:"1994",month:"9",day:"2"},age:"32",
      photos:[
        {id:"photo-full-1",source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""},
        {id:"photo-full-2",source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}
      ],
      primaryPhotoId:"photo-full-1",eyeColor:"Зелёные",hairColor:"Рыжий",height:"168 см",
      hidden:{}
    },
    "resume-partial":{
      id:"resume-partial",characterId:"resume-partial",name:"Марго",surname:"Очень-Длинная-Двойная-Фамилия-Через-Дефис",
      race:"Эльф",birthday:{month:"3",day:"21"},
      photos:[{id:"photo-partial-1",source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}],
      primaryPhotoId:"photo-partial-1",hidden:{eyeColor:true,hairColor:true}
    },
    "resume-nophoto":{id:"resume-nophoto",characterId:"resume-nophoto",name:"Без фото",hidden:{}},
    "gallery-short":{id:"gallery-short",characterId:"gallery-short",name:"Коротко",race:"Человек",hidden:{}}
  },
  characterLinks:[],
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(8000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{if(sessionStorage.getItem("resume-layout-seeded"))return;sessionStorage.setItem("resume-layout-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");
  await page.waitForSelector("#charsModal",{state:"visible"});

  // ================= GALLERY (21-30) =================
  {
    // 21. Cards are taller than the c91150a baseline (640px max-height budget).
    const cardH=await page.locator(".profile-card").first().evaluate(el=>el.getBoundingClientRect().height);
    if(cardH<=640)throw new Error(`Gallery card is not taller than the c91150a baseline: ${cardH}px`);

    // 22. Cards remain viewport-safe: the grid never pushes past the modal.
    const safe=await page.evaluate(()=>{
      const modal=document.querySelector("#charsModal .modal").getBoundingClientRect();
      const grid=document.getElementById("profilesGrid").getBoundingClientRect();
      return grid.bottom<=modal.bottom+1&&modal.bottom<=window.innerHeight;
    });
    if(!safe)throw new Error("Gallery grid/modal overflow the viewport");

    // 23+24. Eye color, then hair color, appear before height in the facts list.
    const fullCard=page.locator('.profile-card[data-character-id="resume-full"]');
    const factLabels=await fullCard.locator(".profile-fact strong").allTextContents();
    const eyeIdx=factLabels.findIndex(t=>t.includes("Цвет глаз")),hairIdx=factLabels.findIndex(t=>t.includes("Цвет волос")),heightIdx=factLabels.findIndex(t=>t.includes("Рост"));
    if(eyeIdx<0||hairIdx<0||heightIdx<0)throw new Error(`Missing expected fact rows: ${JSON.stringify(factLabels)}`);
    if(!(eyeIdx<heightIdx))throw new Error("Eye color does not appear before height");
    if(!(hairIdx<heightIdx))throw new Error("Hair color does not appear before height");
    if(!(eyeIdx<hairIdx))throw new Error("Eye color does not appear before hair color");

    // 25. Missing/hidden eye+hair values are omitted cleanly (hidden on
    // resume-partial), not shown as a noisy blank/undefined row.
    const partialCard=page.locator('.profile-card[data-character-id="resume-partial"]');
    const partialLabels=await partialCard.locator(".profile-fact strong").allTextContents();
    if(partialLabels.some(t=>t.includes("Цвет глаз")))throw new Error("Hidden eyeColor still rendered a fact row");
    if(partialLabels.some(t=>t.includes("Цвет волос")))throw new Error("Hidden hairColor still rendered a fact row");

    // 26. Only the info region scrolls on an overflowing card; the card itself does not.
    const scrollState=await fullCard.evaluate(el=>{
      const scroller=el.querySelector(".profile-card-scroll");
      return {cardOverflowsSelf:el.scrollHeight>el.clientHeight+1,infoScrollable:scroller.scrollHeight>=scroller.clientHeight};
    });
    if(scrollState.cardOverflowsSelf)throw new Error("Outer card overflows/scrolls — only .profile-card-scroll should");

    // 27+28. Stats and action footer stay fixed while info scrolls.
    const before=await fullCard.evaluate(el=>({stats:el.querySelector(".profile-auto").getBoundingClientRect().top,actions:el.querySelector(".profile-card-actions").getBoundingClientRect().top}));
    await fullCard.evaluate(el=>{el.querySelector(".profile-card-scroll").scrollTop=9999});
    const after=await fullCard.evaluate(el=>({stats:el.querySelector(".profile-auto").getBoundingClientRect().top,actions:el.querySelector(".profile-card-actions").getBoundingClientRect().top}));
    if(Math.abs(before.stats-after.stats)>0.5)throw new Error("Statistics moved while info scrolled");
    if(Math.abs(before.actions-after.actions)>0.5)throw new Error("Action footer moved while info scrolled");

    // 29+30. Stats and actions align at the same offset across a short and a longer card.
    const offsetOf=async(locator,sel)=>locator.evaluate((el,s)=>el.querySelector(s).getBoundingClientRect().top-el.getBoundingClientRect().top,sel);
    const shortCard=page.locator('.profile-card[data-character-id="gallery-short"]');
    const statsDelta=Math.abs(await offsetOf(fullCard,".profile-auto")-await offsetOf(shortCard,".profile-auto"));
    const actionsDelta=Math.abs(await offsetOf(fullCard,".profile-card-actions")-await offsetOf(shortCard,".profile-card-actions"));
    if(statsDelta>1)throw new Error(`Stats offset differs between cards: ${statsDelta}`);
    if(actionsDelta>1)throw new Error(`Actions offset differs between cards: ${actionsDelta}`);
  }

  // ================= PROFILE RESUME (1-11) =================
  for(const width of [1440,1200,1024]){
    await page.setViewportSize({width,height:900});
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    const resumeInfo=await page.evaluate(()=>{
      const resume=document.querySelector(".profile-resume");
      const personality=document.querySelector(".profile-section");
      return {
        hasResume:!!resume,
        nameInResume:!!resume.querySelector("#pf_name"),
        surnameInResume:!!resume.querySelector("#pf_surname"),
        birthdayInResume:!!resume.querySelector("#pf_birthYear"),
        ageInResume:!!resume.querySelector("#pf_age"),
        zodiacInResume:!!resume.querySelector("#pf_zodiac"),
        primaryPhotoInResume:!!resume.querySelector(".photo-item-primary img"),
        nameCount:document.querySelectorAll("#pf_name").length,
        surnameCount:document.querySelectorAll("#pf_surname").length,
        birthdayCount:document.querySelectorAll("#pf_birthYear").length,
        ageCount:document.querySelectorAll("#pf_age").length,
        zodiacCount:document.querySelectorAll("#pf_zodiac").length,
        personalityTitle:personality?.querySelector(".profile-section-title")?.textContent,
        personalityHasName:!!personality?.querySelector("#pf_name"),
        personalityHasSurname:!!personality?.querySelector("#pf_surname"),
        resumeBottom:resume.getBoundingClientRect().bottom,
        personalityTop:personality?.getBoundingClientRect().top,
        resumeHeight:resume.getBoundingClientRect().height
      };
    });
    if(width===1440){
      // 1-5. Name/surname/birth date/age/zodiac all live in the résumé.
      if(!resumeInfo.nameInResume)throw new Error("Name field is not inside the résumé header");
      if(!resumeInfo.surnameInResume)throw new Error("Surname field is not inside the resume header");
      if(!resumeInfo.birthdayInResume)throw new Error("Birth date field is not inside the resume header");
      if(!resumeInfo.ageInResume)throw new Error("Age field is not inside the resume header");
      if(!resumeInfo.zodiacInResume)throw new Error("Zodiac field is not inside the resume header");
      // 6. Promoted fields are not duplicated elsewhere in the form.
      if(resumeInfo.nameCount!==1)throw new Error(`#pf_name is duplicated: ${resumeInfo.nameCount}`);
      if(resumeInfo.surnameCount!==1)throw new Error(`#pf_surname is duplicated: ${resumeInfo.surnameCount}`);
      if(resumeInfo.birthdayCount!==1)throw new Error(`#pf_birthYear is duplicated: ${resumeInfo.birthdayCount}`);
      if(resumeInfo.ageCount!==1)throw new Error(`#pf_age is duplicated: ${resumeInfo.ageCount}`);
      if(resumeInfo.zodiacCount!==1)throw new Error(`#pf_zodiac is duplicated: ${resumeInfo.zodiacCount}`);
      if(resumeInfo.personalityHasName||resumeInfo.personalityHasSurname)throw new Error("Личность section still contains a promoted field");
      // 7. Primary photo appears in the resume.
      if(!resumeInfo.primaryPhotoInResume)throw new Error("Primary photo is not rendered in the resume header");
      // 9. Two photos do not inflate the resume excessively.
      if(resumeInfo.resumeHeight>420)throw new Error(`Two-photo resume header grew too tall: ${resumeInfo.resumeHeight}px`);
      // 11. The first detailed section (Личность) begins soon after the resume.
      if(resumeInfo.personalityTitle!=="ЛИЧНОСТЬ"&&!/личность/i.test(resumeInfo.personalityTitle||""))throw new Error(`First section after résumé is not Личность: ${resumeInfo.personalityTitle}`);
      if(resumeInfo.personalityTop-resumeInfo.resumeBottom>80)throw new Error(`Личность section does not begin soon after the résumé: gap=${resumeInfo.personalityTop-resumeInfo.resumeBottom}`);
    }
    // No select/input inside the resume overflows its own box at any tested width.
    const overflow=await page.evaluate(()=>[...document.querySelectorAll(".profile-resume-facts select,.profile-resume-facts input")].some(el=>el.scrollWidth>el.clientWidth+1));
    if(overflow)throw new Error(`A resume date/fact control overflows its box at width=${width}`);
    // 4 (again). Birth date renders correctly (full date -> zodiac derives).
    const zodiacValue=await page.locator("#pf_zodiac").inputValue();
    if(zodiacValue!=="Дева")throw new Error(`Zodiac did not derive from birth date at width=${width}: ${zodiacValue}`);

    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }
  await page.setViewportSize({width:1440,height:900});

  // 8. One photo does not inflate the resume header either.
  {
    await page.locator('.profile-card[data-character-id="resume-partial"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const h=await page.locator(".profile-resume").evaluate(el=>el.getBoundingClientRect().height);
    if(h>320)throw new Error(`One-photo resume header grew too tall: ${h}px`);
    // Partial birth date (month+day, no year) still yields a zodiac and does
    // not throw/overflow.
    const zodiac=await page.locator("#pf_zodiac").inputValue();
    if(zodiac!=="Овен")throw new Error(`Zodiac did not derive from partial birth date: ${zodiac}`);
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // 10. Photo actions (view/crop/delete/make-primary) still work from the resume.
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    await page.locator('[data-photo-id="photo-full-2"]').getByRole("button",{name:"Сделать главным"}).click();
    if(!await page.locator('[data-photo-id="photo-full-2"] .photo-primary').count())throw new Error("Make-primary did not work from the resume photo column");
    await page.locator('[data-photo-id="photo-full-1"]').getByRole("button",{name:"Кадрировать"}).click();
    await page.waitForSelector("#photoCropModal",{state:"visible"});
    await page.click("#cancelPhotoCrop");
    await page.waitForSelector("#photoCropModal",{state:"hidden"});
    await page.locator('[data-photo-id="photo-full-1"]').getByRole("button",{name:"Просмотреть"}).click();
    await page.waitForSelector("#photoLightboxModal",{state:"visible"});
    await page.click("#closePhotoLightbox");
    await page.waitForSelector("#photoLightboxModal",{state:"hidden"});
    const before=await page.locator("#profilePhotosGrid .photo-item").count();
    await page.locator('[data-photo-id="photo-full-1"] button.danger').click();
    const after=await page.locator("#profilePhotosGrid .photo-item").count();
    if(after!==before-1)throw new Error(`Delete photo did not work from the resume photo column: ${before} -> ${after}`);
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // No-photo empty state renders a placeholder, not a broken/empty grid.
  {
    await page.locator('.profile-card[data-character-id="resume-nophoto"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    if(!await page.locator(".photo-item-empty").count())throw new Error("No-photo empty state placeholder is missing");
    await page.click("#cancelProfile");
  }

  // ================= SAVE SCOPE (12-20) =================
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    // 12. Save scope is not visible in the resume/top area.
    const inResume=await page.evaluate(()=>!!document.querySelector(".profile-resume #cloudProfileScope, .profile-resume input[name=\"profileSaveScope\"]"));
    if(inResume)throw new Error("Save scope is visible inside the resume/top area");

    await page.evaluate(()=>{document.getElementById("cloudProfileScope").hidden=false;updateProfileScopeHelp()});

    // 13. Radio group is visible in the sticky footer.
    const footerCheck=await page.evaluate(()=>{
      const footer=document.querySelector(".profile-modal-actions");
      const radios=[...document.querySelectorAll('input[name="profileSaveScope"]')];
      return {inFooter:radios.every(r=>footer.contains(r)),count:radios.length,visible:radios.every(r=>r.getBoundingClientRect().width>0)};
    });
    if(!footerCheck.inFooter||footerCheck.count!==2)throw new Error(`Save-scope radio group is not correctly placed in the sticky footer: ${JSON.stringify(footerCheck)}`);
    if(!footerCheck.visible)throw new Error("Save-scope radios are not visible once the cloud scope control is shown");

    // 14+17. Exactly one option is selected, and it is the project-only
    // default (matches the pre-redesign hardcoded default for any character).
    const checked=await page.evaluate(()=>[...document.querySelectorAll('input[name="profileSaveScope"]')].filter(r=>r.checked).map(r=>r.value));
    if(checked.length!==1)throw new Error(`Expected exactly one selected scope option, got ${JSON.stringify(checked)}`);
    if(checked[0]!=="project")throw new Error(`Default save scope regressed: ${checked[0]}`);

    // 15+16. Radios map to the same underlying value the save logic reads.
    if(await page.evaluate(()=>profileSaveScopeValue())!=="project")throw new Error("profileSaveScopeValue() did not report 'project' for the default radio state");
    await page.check("#profileSaveScopeGlobal");
    if(await page.evaluate(()=>profileSaveScopeValue())!=="global")throw new Error("profileSaveScopeValue() did not report 'global' after checking the global radio");
    await page.check("#profileSaveScopeProject");
    if(await page.evaluate(()=>profileSaveScopeValue())!=="project")throw new Error("profileSaveScopeValue() did not report 'project' after checking the project radio back");

    // 18. Helper text updates for each option with plain, non-technical wording.
    await page.evaluate(()=>updateProfileScopeHelp());
    const projectHelp=await page.locator("#profileScopeHelp").textContent();
    await page.check("#profileSaveScopeGlobal");
    await page.evaluate(()=>updateProfileScopeHelp());
    const globalHelp=await page.locator("#profileScopeHelp").textContent();
    if(!projectHelp.includes("только в этом проекте"))throw new Error(`Project-scope help text regressed: ${projectHelp}`);
    if(!/во всех проектах/.test(globalHelp))throw new Error(`Global-scope help text regressed: ${globalHelp}`);
    for(const technical of ["override","inheritance","global profile","base profile"]){
      if(projectHelp.toLowerCase().includes(technical)||globalHelp.toLowerCase().includes(technical))throw new Error(`Help text leaks a technical term "${technical}"`);
    }

    // Radio labels are clickable (native <label> wrapping, not just the input).
    await page.locator(".profile-scope-option",{hasText:"Только в этом проекте"}).click();
    if(await page.evaluate(()=>profileSaveScopeValue())!=="project")throw new Error("Clicking the radio's label text did not select the project option");

    // 19+20. Save/Cancel behavior is unchanged: editing a field enables Save,
    // and Cancel discards without persisting.
    await page.fill("#pf_age","99");
    await page.dispatchEvent("#pf_age","input");
    if(await page.locator("#saveProfile").isDisabled())throw new Error("Save button did not enable after editing a field");
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible()){await page.click("#discardChanges")}
    await page.waitForSelector("#profileEditorModal",{state:"hidden"});
    const persistedAge=await page.evaluate(()=>data.profiles["resume-full"].age);
    if(persistedAge==="99")throw new Error("Cancel/discard persisted an edit that should have been discarded");
  }

  if(errors.length)throw new Error(`Console/page errors during test: ${errors.join(" | ")}`);
  console.log("Character profile résumé layout browser tests: OK");
}finally{await browser.close();server.kill()}
