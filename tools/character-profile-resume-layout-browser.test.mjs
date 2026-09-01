// Regression coverage for the fix/character-resume-photo-layout branch:
// (1) removed the stale "Отношения, указанные в анкете..." explanatory
// paragraph from the Character Gallery modal, letting cards use the small
// amount of freed vertical space; (2) recomposed the Character Profile
// résumé fact grid — birth date is now its own full-width row, Age/Zodiac
// moved to a row of their own below it (the old cramped 3-column grid used
// to wrap "Возраст на начало истории" into a tall, near-vertical column);
// (3) replaced the résumé's multi-photo UI (a narrow vertical mini-gallery
// with per-thumbnail action rows and nested scrollbars) with one dominant
// active/primary portrait plus a single low-height horizontal thumbnail
// strip and one shared action row. Checklist mirrors the task's acceptance
// list (GALLERY 1-4, RESUME 5-10, PHOTO 11-24).
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8049,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dataUrl=`data:image/png;base64,${png}`;
const mkPhotos=(prefix,n)=>Array.from({length:n},(_,i)=>({id:`${prefix}-${i}`,source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}));
const project={
  version:11,
  characters:[
    {id:"resume-full",name:"Рене",sortOrder:1000},
    {id:"resume-partial",name:"Марго",sortOrder:2000},
    {id:"resume-nophoto",name:"Без фото",sortOrder:3000},
    {id:"resume-many",name:"Полина",sortOrder:3500},
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
    "resume-many":{
      id:"resume-many",characterId:"resume-many",name:"Полина",photos:mkPhotos("photo-many",5),
      primaryPhotoId:"photo-many-0",hidden:{}
    },
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
  await page.addInitScript(value=>{if(sessionStorage.getItem("resume-photo-layout-seeded"))return;sessionStorage.setItem("resume-photo-layout-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");
  await page.waitForSelector("#charsModal",{state:"visible"});

  // ================= GALLERY (1-4) =================
  {
    // 1. Stale explanatory paragraph is gone entirely (element and text).
    if(await page.locator("#charsModalDescription").count())throw new Error("Stale #charsModalDescription paragraph still present");
    const modalText=await page.locator("#charsModal .modal").innerText();
    if(modalText.includes("Отношения, указанные в анкете"))throw new Error("Stale gallery explanation text still rendered");
    if(modalText.includes("Фотографии сохраняются внутри файла данных браузера"))throw new Error("Stale gallery explanation text still rendered");

    // 2. The grid starts materially higher: nothing but the title sits above it.
    const gap=await page.evaluate(()=>{
      const title=document.getElementById("charsModalTitle").getBoundingClientRect();
      const grid=document.getElementById("profilesGrid").getBoundingClientRect();
      return grid.top-title.bottom;
    });
    if(gap>40)throw new Error(`Gallery grid does not start materially higher after removing the stale paragraph: gap=${gap}`);

    // 3. Cards remain viewport-safe: the modal itself never exceeds the
    // viewport (it scrolls internally instead — this fixture's 5 characters
    // wrap past one row at 1440px) and no single card exceeds the hard
    // height ceiling.
    const safe=await page.evaluate(()=>{
      const modal=document.querySelector("#charsModal .modal").getBoundingClientRect();
      return {modalFits:modal.bottom<=window.innerHeight,cardH:document.querySelector(".profile-card").getBoundingClientRect().height};
    });
    if(!safe.modalFits)throw new Error("Gallery modal overflows the viewport");
    if(safe.cardH>760)throw new Error(`Gallery card exceeds the hard height ceiling: ${safe.cardH}px`);

    // 4. Stats and the action footer stay aligned at the same offset across
    // a short and a longer card (unaffected by the paragraph removal).
    const fullCard=page.locator('.profile-card[data-character-id="resume-full"]');
    const shortCard=page.locator('.profile-card[data-character-id="gallery-short"]');
    const offsetOf=async(locator,sel)=>locator.evaluate((el,s)=>el.querySelector(s).getBoundingClientRect().top-el.getBoundingClientRect().top,sel);
    const statsDelta=Math.abs(await offsetOf(fullCard,".profile-auto")-await offsetOf(shortCard,".profile-auto"));
    const actionsDelta=Math.abs(await offsetOf(fullCard,".profile-card-actions")-await offsetOf(shortCard,".profile-card-actions"));
    if(statsDelta>1)throw new Error(`Stats offset differs between cards: ${statsDelta}`);
    if(actionsDelta>1)throw new Error(`Actions offset differs between cards: ${actionsDelta}`);
  }

  // ================= RESUME (5-10) =================
  for(const width of [1440,1200,1024]){
    await page.setViewportSize({width,height:900});
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    const layout=await page.evaluate(()=>{
      const names=document.querySelector(".profile-resume-names");
      const birthday=document.querySelector(".profile-resume-birthday");
      const vitals=document.querySelector(".profile-resume-vitals");
      const ageTop=vitals.querySelector(".profile-field-top");
      const ageStrong=ageTop.querySelector(":scope > strong");
      const sublabel=ageStrong.querySelector(".profile-field-sublabel");
      const hideAge=document.getElementById("hide_age");
      const hideBirthday=document.getElementById("hide_birthday");
      return {
        namesTop:names.getBoundingClientRect().top,
        birthdayTop:birthday.getBoundingClientRect().top,
        vitalsTop:vitals.getBoundingClientRect().top,
        namesHasNameSurname:!!names.querySelector("#pf_name")&&!!names.querySelector("#pf_surname"),
        birthdayHasFields:!!birthday.querySelector("#pf_birthYear")&&!!birthday.querySelector("#pf_birthMonth")&&!!birthday.querySelector("#pf_birthDay"),
        birthdayWidth:birthday.getBoundingClientRect().width,
        vitalsHasAgeZodiac:!!vitals.querySelector("#pf_age")&&!!vitals.querySelector("#pf_zodiac"),
        ageAccessibleText:ageStrong.textContent.trim(),
        sublabelIsBlock:sublabel&&getComputedStyle(sublabel).display==="block",
        ageFieldTopHeight:ageTop.getBoundingClientRect().height,
        hideAgeVisible:hideAge.getBoundingClientRect().width>0,
        hideBirthdayVisible:hideBirthday.getBoundingClientRect().width>0,
        ageInputWidth:document.getElementById("pf_age").getBoundingClientRect().width
      };
    });

    // 5. Name/Surname are row 1 (above birth date, which is above vitals).
    if(!layout.namesHasNameSurname)throw new Error("Name/Surname are not together in the first résumé row");
    if(!(layout.namesTop<layout.birthdayTop))throw new Error(`Names row is not above the birth-date row at width=${width}`);
    // 6. Birth date has its own usable wide row (year/month/day all present,
    // and the row uses most of the identity column's width rather than
    // being squeezed alongside Age/Zodiac).
    if(!layout.birthdayHasFields)throw new Error("Birth date row is missing year/month/day fields");
    const identityWidth=await page.evaluate(()=>document.querySelector(".profile-resume-identity").getBoundingClientRect().width);
    if(layout.birthdayWidth<identityWidth*0.9)throw new Error(`Birth date row is not a wide, full-width row at width=${width}: ${layout.birthdayWidth} of ${identityWidth}`);
    // 7. Age and Zodiac appear together, below the birth-date row.
    if(!layout.vitalsHasAgeZodiac)throw new Error("Age/Zodiac are not together in the résumé");
    if(!(layout.birthdayTop<layout.vitalsTop))throw new Error(`Age/Zodiac row is not below the birth-date row at width=${width}`);
    // 8. The full "Возраст на начало истории" semantic label is still the
    // accessible name for #pf_age (via aria-labelledby), even though only
    // "Возраст" is visually prominent.
    if(layout.ageAccessibleText!=="Возраст на начало истории")throw new Error(`Age field's accessible label text regressed: "${layout.ageAccessibleText}"`);
    const ageLabelledby=await page.evaluate(()=>{
      const id=document.getElementById("pf_age").getAttribute("aria-labelledby");
      return id&&document.getElementById(id)?.textContent.trim();
    });
    if(ageLabelledby!=="Возраст на начало истории")throw new Error(`#pf_age is not labelled by the full semantic phrase: "${ageLabelledby}"`);
    // 9. The secondary "на начало истории" descriptor drops to its own
    // quiet line instead of wrapping "Возраст" itself into a tall, narrow,
    // near-vertical column (two intentional lines, not four wrapped ones).
    if(!layout.sublabelIsBlock)throw new Error("Age sublabel is not rendered on its own line");
    if(layout.ageFieldTopHeight>48)throw new Error(`Age field-top is taller than two label lines — looks wrapped, not intentional: ${layout.ageFieldTopHeight}px at width=${width}`);
    // 10. "не указывать" stays visible/usable and does not visibly starve
    // its neighboring input (Age's own input keeps a reasonable width).
    if(!layout.hideAgeVisible)throw new Error("Age's «не указывать» checkbox is not visible");
    if(!layout.hideBirthdayVisible)throw new Error("Birth date's «не указывать» checkbox is not visible");
    if(layout.ageInputWidth<80)throw new Error(`Age input was squeezed by its «не указывать» checkbox: ${layout.ageInputWidth}px at width=${width}`);

    // No select/input inside the résumé overflows its own box at any tested width.
    const overflow=await page.evaluate(()=>[...document.querySelectorAll(".profile-resume-vitals select,.profile-resume-vitals input,.profile-resume-birthday select,.profile-resume-birthday input")].some(el=>el.scrollWidth>el.clientWidth+1));
    if(overflow)throw new Error(`A résumé date/fact control overflows its box at width=${width}`);
    // Birth date renders correctly (full date -> zodiac derives).
    const zodiacValue=await page.locator("#pf_zodiac").inputValue();
    if(zodiacValue!=="Дева")throw new Error(`Zodiac did not derive from birth date at width=${width}: ${zodiacValue}`);

    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }
  await page.setViewportSize({width:1440,height:900});

  // ================= PHOTO (11-24) =================

  // 11. One photo -> one primary portrait, no empty/pointless thumbnail strip.
  {
    await page.locator('.profile-card[data-character-id="resume-partial"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    if(await page.locator(".photo-resume-strip").count())throw new Error("A single photo should not render a thumbnail strip");
    if(!await page.locator(".photo-item-primary").count())throw new Error("Single photo is not shown as the primary portrait");
    const h=await page.locator(".profile-resume").evaluate(el=>el.getBoundingClientRect().height);
    if(h>340)throw new Error(`One-photo résumé header grew too tall: ${h}px`);
    // Partial birth date (month+day, no year) still yields a zodiac and does
    // not throw/overflow.
    const zodiac=await page.locator("#pf_zodiac").inputValue();
    if(zodiac!=="Овен")throw new Error(`Zodiac did not derive from partial birth date: ${zodiac}`);
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // 12+23. Two photos -> one large active portrait + horizontal thumbnails;
  // primary indicator is correct.
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const info=await page.evaluate(()=>{
      const resume=document.querySelector(".profile-resume");
      const strip=document.querySelector(".photo-resume-strip");
      return {
        resumeHeight:resume.getBoundingClientRect().height,
        stripPresent:!!strip,
        thumbCount:document.querySelectorAll(".photo-thumb").length,
        primaryBadgeOnPrimaryTile:!!document.querySelector('.photo-item-primary[data-photo-id="photo-full-1"] .photo-primary'),
        primaryMarkOnThumb:!!document.querySelector('.photo-thumb[data-photo-id="photo-full-1"] .photo-thumb-primary-mark')
      };
    });
    if(!info.stripPresent)throw new Error("Two photos should render a horizontal thumbnail strip");
    if(info.thumbCount!==2)throw new Error(`Expected 2 thumbnails, got ${info.thumbCount}`);
    if(info.resumeHeight>420)throw new Error(`Two-photo résumé header grew too tall: ${info.resumeHeight}px`);
    if(!info.primaryBadgeOnPrimaryTile)throw new Error("Primary badge is not on the primary photo's enlarged tile");
    if(!info.primaryMarkOnThumb)throw new Error("Primary indicator is not on the primary photo's thumbnail");
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // 13. Three-or-more photos still don't fall back to a vertical mini-gallery.
  {
    await page.locator('.profile-card[data-character-id="resume-many"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const info=await page.evaluate(()=>{
      const strip=document.querySelector(".photo-resume-strip");
      return {
        thumbCount:document.querySelectorAll(".photo-thumb").length,
        stripFlexDirection:getComputedStyle(strip).flexDirection,
        primaryTileCount:document.querySelectorAll(".photo-item-primary").length
      };
    });
    if(info.thumbCount!==5)throw new Error(`Expected 5 thumbnails for a 5-photo character, got ${info.thumbCount}`);
    if(info.stripFlexDirection!=="row")throw new Error(`Thumbnail strip is not a horizontal row (found "${info.stripFlexDirection}") — looks like the old vertical mini-gallery`);
    if(info.primaryTileCount!==1)throw new Error(`Expected exactly one enlarged primary/active portrait, found ${info.primaryTileCount}`);

    // 14+15+16. No vertical scrollbar anywhere in the photo column, no
    // horizontal scrollbar on the column as a whole — only the thumbnail
    // strip itself may scroll horizontally.
    const overflow=await page.evaluate(()=>{
      const grid=document.getElementById("profilePhotosGrid"),strip=document.querySelector(".photo-resume-strip");
      return {
        gridScrollsY:grid.scrollHeight>grid.clientHeight+1,
        gridScrollsX:grid.scrollWidth>grid.clientWidth+1,
        stripScrollsX:strip.scrollWidth>strip.clientWidth
      };
    });
    if(overflow.gridScrollsY)throw new Error("Photo column has a vertical internal scrollbar");
    if(overflow.gridScrollsX)throw new Error("Photo column (outside the thumbnail strip) has a horizontal scrollbar");
    if(!overflow.stripScrollsX)throw new Error("Thumbnail strip with 5 photos at 196px column width should need to scroll horizontally");

    // 17. Selecting a thumbnail changes the active managed photo.
    const thirdThumb=page.locator(".photo-thumb").nth(2);
    await thirdThumb.click();
    if(await thirdThumb.getAttribute("aria-selected")!=="true")throw new Error("Clicking a thumbnail did not mark it selected");
    const activePhotoId=await page.evaluate(()=>document.querySelector(".photo-item-primary").dataset.photoId);
    if(activePhotoId!=="photo-many-2")throw new Error(`Selecting a thumbnail did not change the active/enlarged photo: ${activePhotoId}`);

    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // No-photo empty state renders a placeholder, not a broken/empty grid.
  {
    await page.locator('.profile-card[data-character-id="resume-nophoto"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    if(!await page.locator(".photo-item-empty").count())throw new Error("No-photo empty state placeholder is missing");
    if(await page.locator(".photo-resume-strip").count())throw new Error("No-photo state should not render a thumbnail strip");
    await page.click("#cancelProfile");
  }

  // 18-22+24. Preview/crop/make-primary/delete/add-photo all still work from
  // the résumé photo column via the active-photo + shared-action-row model,
  // and photo state (order, primary) round-trips through save/reload.
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const photosGrid=page.locator("#profilePhotosGrid");

    // 20. Make-primary: select the non-primary thumbnail, then use the
    // shared action row (only offered because it is not already primary).
    await page.locator('.photo-thumb[data-photo-id="photo-full-2"]').click();
    await photosGrid.getByRole("button",{name:"Сделать главным"}).click();
    if(!await page.locator('.photo-item-primary[data-photo-id="photo-full-2"] .photo-primary').count())throw new Error("Make-primary did not work from the résumé photo column");

    // 19. Crop: select the other photo, then crop it via the shared row.
    await page.locator('.photo-thumb[data-photo-id="photo-full-1"]').click();
    await page.locator('[data-action="crop-photo"]').click();
    await page.waitForSelector("#photoCropModal",{state:"visible"});
    await page.click("#cancelPhotoCrop");
    await page.waitForSelector("#photoCropModal",{state:"hidden"});

    // 18. Preview (lightbox) for the currently active photo.
    await page.locator('[data-action="view-photo"]').click();
    await page.waitForSelector("#photoLightboxModal",{state:"visible"});
    await page.click("#closePhotoLightbox");
    await page.waitForSelector("#photoLightboxModal",{state:"hidden"});

    // 22. Add photo still works from the résumé column.
    const beforeAdd=await page.evaluate(()=>profileDraftPhotos.length);
    await page.setInputFiles("#profilePhotosInput",[{name:"c.png",mimeType:"image/png",buffer:Buffer.from(png,"base64")}]);
    await page.waitForFunction(n=>profileDraftPhotos.length===n,beforeAdd+1);

    // 21. Delete the currently-active photo (photo-full-1).
    const beforeDelete=await page.evaluate(()=>profileDraftPhotos.length);
    await photosGrid.getByRole("button",{name:"Удалить"}).click();
    const afterDelete=await page.evaluate(()=>profileDraftPhotos.length);
    if(afterDelete!==beforeDelete-1)throw new Error(`Delete photo did not work from the résumé photo column: ${beforeDelete} -> ${afterDelete}`);

    // 24. Save and reload: photo order/primary state persists correctly.
    await page.click("#saveProfile");
    await page.waitForSelector("#profileEditorModal",{state:"hidden"});
    const saved=await page.evaluate(()=>data.profiles["resume-full"]);
    if(saved.photos.length!==2)throw new Error(`Unexpected saved photo count: ${saved.photos.length}`);
    if(saved.photos[0].id!=="photo-full-2")throw new Error(`Photo order did not persist correctly: ${JSON.stringify(saved.photos.map(p=>p.id))}`);
    if(saved.primaryPhotoId!=="photo-full-2")throw new Error(`Primary photo did not persist correctly: ${saved.primaryPhotoId}`);

    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const reloaded=await page.evaluate(()=>({count:profileDraftPhotos.length,primary:profileDraftPrimaryPhotoId,order:profileDraftPhotos.map(p=>p.id)}));
    if(reloaded.count!==2||reloaded.primary!=="photo-full-2"||reloaded.order[0]!=="photo-full-2")throw new Error(`Reloaded photo state regressed: ${JSON.stringify(reloaded)}`);
    if(!await page.locator('.photo-item-primary[data-photo-id="photo-full-2"] .photo-primary').count())throw new Error("Primary indicator is wrong after reload");
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // ================= SAVE SCOPE (unchanged by this branch) =================
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    const inResume=await page.evaluate(()=>!!document.querySelector(".profile-resume #cloudProfileScope, .profile-resume input[name=\"profileSaveScope\"]"));
    if(inResume)throw new Error("Save scope is visible inside the résumé/top area");

    await page.evaluate(()=>{document.getElementById("cloudProfileScope").hidden=false;updateProfileScopeHelp()});
    const footerCheck=await page.evaluate(()=>{
      const footer=document.querySelector(".profile-modal-actions");
      const radios=[...document.querySelectorAll('input[name="profileSaveScope"]')];
      return {inFooter:radios.every(r=>footer.contains(r)),count:radios.length};
    });
    if(!footerCheck.inFooter||footerCheck.count!==2)throw new Error(`Save-scope radio group is not correctly placed in the sticky footer: ${JSON.stringify(footerCheck)}`);

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
  console.log("Character résumé/photo layout browser tests: OK");
}finally{await browser.close();server.kill()}
