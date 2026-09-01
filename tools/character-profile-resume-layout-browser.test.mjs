// Regression coverage for the fix/character-photo-rail-gallery-height branch,
// a refinement on top of the (mostly-accepted) character résumé layout:
// (1) Character Gallery cards now stretch to use the modal's actual
// available height (grid rows use minmax(floor,1fr) inside a fixed-height
// modal) instead of a max-height guessed from one viewport's leftover space;
// (2) the résumé's secondary-photo strip — previously a horizontal row BELOW
// the primary portrait that pushed the whole identity column down as photos
// were added — is now a vertical rail BESIDE the portrait, with its width
// reserved unconditionally so the résumé's height/position never depends on
// photo count; (3) the "Сделать главным"/"Удалить" text actions shrank to
// compact star/trash icon buttons; (4) Age and Zodiac controls now start on
// the same horizontal line regardless of Age's two-line label. Checklist
// mirrors the task's acceptance list (GALLERY 1-4, RESUME 5-10, PHOTO 11-24)
// plus the new geometry checks from this branch's own task (A-F).
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
    {id:"resume-ten",name:"Декада",sortOrder:3700},
    {id:"gallery-short",name:"Коротко",sortOrder:4000},
    {id:"gallery-long",name:"Архивариус",sortOrder:4500}
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
    "resume-ten":{
      id:"resume-ten",characterId:"resume-ten",name:"Декада",photos:mkPhotos("photo-ten",10),
      primaryPhotoId:"photo-ten-0",hidden:{}
    },
    "gallery-short":{id:"gallery-short",characterId:"gallery-short",name:"Коротко",race:"Человек",hidden:{}},
    "gallery-long":{
      id:"gallery-long",characterId:"gallery-long",name:"Архивариус",surname:"Полнознающая",
      race:"Эльф",sex:"Женский",secondarySex:"Небинарный",age:"128",
      birthday:{year:"1896",month:"3",day:"2"},height:"172 см",build:"Атлетическое",
      eyeColor:"Изумрудный",hairColor:"Серебристый",profession:"Архивариус",orientation:"Бисексуальность",
      description:"Очень длинное описание персонажа для проверки прокрутки информационной области. ".repeat(30),
      hidden:{}
    }
  },
  characterLinks:[
    {id:"link-gallery-long",fromCharacterId:"gallery-long",toCharacterId:"resume-full",category:"guardianship",type:"guardian",reverseType:"ward",structureKind:"guardianship"}
  ],
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

  // ================= GALLERY (1-20) =================
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

    // 3/16/17/18/20. Card height is a fixed, viewport-aware value — NOT the
    // modal's available height divided by however many rows exist. With this
    // fixture (7 characters, several rows at 1440px) each card individually
    // claims most of the modal's vertical budget, so the grid now NEEDS to
    // scroll to reach row 2+ (the opposite of the old "stretch rows to fill,
    // never scroll" model this branch replaces) — that is the fix, not a
    // regression. What must hold: every row shares exactly one card height
    // (rows don't get squeezed relative to each other), and — the direct
    // regression check for "row 2 shrinks row 1" — the first row's card
    // height measured with only enough characters for one row must equal its
    // height once more characters push a 2nd/3rd row into existence.
    const heightUse=await page.evaluate(()=>{
      const modal=document.querySelector("#charsModal .modal").getBoundingClientRect();
      const grid=document.getElementById("profilesGrid");
      const gridRect=grid.getBoundingClientRect();
      const cards=[...document.querySelectorAll(".profile-card")];
      return {
        modalFits:modal.bottom<=window.innerHeight,
        gridScrollsX:grid.scrollWidth>grid.clientWidth+1,
        rowTops:[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top)))].sort((a,b)=>a-b),
        rowHeights:[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().height)))].sort((a,b)=>a-b),
        firstCardHeight:cards[0].getBoundingClientRect().height
      };
    });
    if(!heightUse.modalFits)throw new Error("Gallery modal overflows the viewport");
    if(heightUse.gridScrollsX)throw new Error("Gallery grid overflows horizontally");
    if(heightUse.rowTops.length<2)throw new Error(`Expected this fixture to wrap into at least 2 rows, got: ${JSON.stringify(heightUse.rowTops)}`);
    if(heightUse.rowHeights.length!==1)throw new Error(`Expected every row to share one stable card height, got distinct heights: ${JSON.stringify(heightUse.rowHeights)}`);

    // 16/17 direct check: shrink the fixture down to a single row's worth of
    // characters, measure the (now sole) row's card height, then restore the
    // full character list and confirm row 1's card height did not change —
    // i.e. a 2nd/3rd row appearing never shrinks row 1.
    const rowStability=await page.evaluate(()=>{
      const full=data.characters.slice();
      const single=full.slice(0,3);
      data.characters=single;renderProfiles();
      const oneRowCards=[...document.querySelectorAll(".profile-card")];
      const oneRowTops=new Set(oneRowCards.map(c=>Math.round(c.getBoundingClientRect().top)));
      const oneRowHeight=oneRowCards[0].getBoundingClientRect().height;
      data.characters=full;renderProfiles();
      const restoredHeight=document.querySelector(".profile-card").getBoundingClientRect().height;
      return {oneRowCount:oneRowTops.size,oneRowHeight,restoredHeight};
    });
    if(rowStability.oneRowCount!==1)throw new Error(`Fixture slice expected to render a single row, got ${rowStability.oneRowCount} row offsets`);
    if(Math.abs(rowStability.oneRowHeight-rowStability.restoredHeight)>2)throw new Error(`Card height changed once a 2nd/3rd row appeared: single-row=${rowStability.oneRowHeight} multi-row=${rowStability.restoredHeight}`);

    // 18. The grid can actually be scrolled to reach a later row.
    const scrollReach=await page.evaluate(()=>{
      const grid=document.getElementById("profilesGrid");
      const before=grid.scrollTop;
      grid.scrollTop=grid.scrollHeight;
      const after=grid.scrollTop;
      const lastCard=[...document.querySelectorAll(".profile-card")].pop();
      const reached=lastCard.getBoundingClientRect().bottom<=grid.getBoundingClientRect().bottom+1;
      grid.scrollTop=before;
      return {scrolled:after>before,reached};
    });
    if(!scrollReach.scrolled)throw new Error("Gallery grid did not actually scroll when scrollTop was advanced");
    if(!scrollReach.reached)throw new Error("Scrolling the gallery grid to its end still does not bring the last row's card fully into view");

    // 19. Modal footer (Закрыть / + Новый персонаж) stays visible/reachable.
    const footerVisible=await page.evaluate(()=>{
      const footer=document.querySelector("#charsModal .modal-actions");
      const r=footer.getBoundingClientRect();
      return r.top>=0&&r.bottom<=window.innerHeight&&r.height>0;
    });
    if(!footerVisible)throw new Error("Gallery modal footer is not reachable/visible");

    // Photo cover keeps roughly its established visual proportion (~1/3 of
    // the card) — a percentage-based cover, not a fixed px height.
    const coverRatio=await page.evaluate(()=>{
      const card=document.querySelector(".profile-card");
      return card.querySelector(".profile-cover").getBoundingClientRect().height/card.getBoundingClientRect().height;
    });
    if(coverRatio<0.22||coverRatio>0.48)throw new Error(`Gallery cover/card ratio drifted from "roughly a third": ${coverRatio}`);

    // 15. No-image placeholder occupies the same cover geometry as a real photo.
    const coverGeometry=await page.evaluate(()=>{
      const withPhoto=document.querySelector('.profile-card[data-character-id="resume-full"] .profile-cover').getBoundingClientRect();
      const noPhoto=document.querySelector('.profile-card[data-character-id="resume-nophoto"] .profile-cover').getBoundingClientRect();
      return {withPhotoH:withPhoto.height,noPhotoH:noPhoto.height};
    });
    if(Math.abs(coverGeometry.withPhotoH-coverGeometry.noPhotoH)>2)throw new Error(`No-image placeholder cover height differs from a real photo's cover: ${JSON.stringify(coverGeometry)}`);

    // 1/2/3/4/5. The critical assertion: a character with every fact filled
    // in, a long description AND a structural link (gallery-long) actually
    // shows those facts INSIDE the visible (unscrolled) information area —
    // not just present somewhere in the DOM.
    const factVisibility=await page.evaluate(()=>{
      const card=document.querySelector('.profile-card[data-character-id="gallery-long"]');
      const scroll=card.querySelector(".profile-card-scroll");
      scroll.scrollTop=0;
      const scrollRect=scroll.getBoundingClientRect();
      const facts=[...card.querySelectorAll(".profile-fact")];
      const factText=facts.map(f=>f.textContent);
      const visibleCount=facts.filter(f=>{
        const r=f.getBoundingClientRect();
        return r.top>=scrollRect.top-0.5&&r.bottom<=scrollRect.bottom+0.5&&r.height>0;
      }).length;
      return {
        clientHeight:scroll.clientHeight,
        factCount:facts.length,
        visibleCount,
        factText,
        hasEyeColor:factText.some(t=>t.includes("Цвет глаз")&&t.includes("Изумрудный")),
        hasHairColor:factText.some(t=>t.includes("Цвет волос")&&t.includes("Серебристый")),
        hasHeight:factText.some(t=>t.includes("Рост")&&t.includes("172")),
        descriptionInScroll:!!scroll.querySelector(".profile-description"),
        linksInScroll:!!scroll.querySelector(".profile-structural-summary"),
        linkText:scroll.querySelector(".profile-structural-summary")?.textContent||""
      };
    });
    if(factVisibility.clientHeight<80)throw new Error(`.profile-card-scroll has no meaningful usable height: ${factVisibility.clientHeight}px`);
    if(!factVisibility.hasEyeColor)throw new Error(`Eye color fact not rendered/visible: ${JSON.stringify(factVisibility.factText)}`);
    if(!factVisibility.hasHairColor)throw new Error(`Hair color fact not rendered/visible: ${JSON.stringify(factVisibility.factText)}`);
    if(!factVisibility.hasHeight)throw new Error(`Height fact not rendered/visible: ${JSON.stringify(factVisibility.factText)}`);
    if(factVisibility.visibleCount<3)throw new Error(`Fewer than 3 facts intersect the visible information area (DOM presence is not enough): visible=${factVisibility.visibleCount} of ${factVisibility.factCount}`);
    if(!factVisibility.descriptionInScroll)throw new Error("Long description is not inside the scrolling information region");
    if(!factVisibility.linksInScroll)throw new Error("Structural links summary is not inside the scrolling information region");
    if(!factVisibility.linkText.includes("Рене"))throw new Error(`Structural link does not name the linked character: "${factVisibility.linkText}"`);

    // 8/9. Long card scrolls internally; short card does not get an
    // unnecessary internal scrollbar.
    const scrollBehavior=await page.evaluate(()=>{
      const longScroll=document.querySelector('.profile-card[data-character-id="gallery-long"] .profile-card-scroll');
      const shortScroll=document.querySelector('.profile-card[data-character-id="gallery-short"] .profile-card-scroll');
      return {
        longOverflows:longScroll.scrollHeight>longScroll.clientHeight+1,
        shortOverflows:shortScroll.scrollHeight>shortScroll.clientHeight+1
      };
    });
    if(!scrollBehavior.longOverflows)throw new Error("Long-content card's information region does not need to scroll (scrollHeight <= clientHeight)");
    if(scrollBehavior.shortOverflows)throw new Error("Short-content card shows an unnecessary internal scrollbar");

    // 10/11. Scrolling the information region does not move stats or actions.
    const scrollIsolation=await page.evaluate(()=>{
      const card=document.querySelector('.profile-card[data-character-id="gallery-long"]');
      const scroll=card.querySelector(".profile-card-scroll");
      const stats=card.querySelector(".profile-auto");
      const actions=card.querySelector(".profile-card-actions");
      const before={stats:stats.getBoundingClientRect().top,actions:actions.getBoundingClientRect().top};
      scroll.scrollTop=scroll.scrollHeight;
      const after={stats:stats.getBoundingClientRect().top,actions:actions.getBoundingClientRect().top};
      scroll.scrollTop=0;
      return {statsDelta:Math.abs(after.stats-before.stats),actionsDelta:Math.abs(after.actions-before.actions)};
    });
    if(scrollIsolation.statsDelta>0.5)throw new Error(`Scrolling the info region moved the stats block: ${scrollIsolation.statsDelta}px`);
    if(scrollIsolation.actionsDelta>0.5)throw new Error(`Scrolling the info region moved the action footer: ${scrollIsolation.actionsDelta}px`);

    // 12/13. Stats and the action footer stay aligned at the same offset
    // across a short and a long card (unaffected by content length).
    const fullCard=page.locator('.profile-card[data-character-id="resume-full"]');
    const shortCard=page.locator('.profile-card[data-character-id="gallery-short"]');
    const longCard=page.locator('.profile-card[data-character-id="gallery-long"]');
    const offsetOf=async(locator,sel)=>locator.evaluate((el,s)=>el.querySelector(s).getBoundingClientRect().top-el.getBoundingClientRect().top,sel);
    const statsOffsets=[await offsetOf(fullCard,".profile-auto"),await offsetOf(shortCard,".profile-auto"),await offsetOf(longCard,".profile-auto")];
    const actionsOffsets=[await offsetOf(fullCard,".profile-card-actions"),await offsetOf(shortCard,".profile-card-actions"),await offsetOf(longCard,".profile-card-actions")];
    const spreadOf=arr=>Math.max(...arr)-Math.min(...arr);
    if(spreadOf(statsOffsets)>1)throw new Error(`Stats offset differs between cards: ${JSON.stringify(statsOffsets)}`);
    if(spreadOf(actionsOffsets)>1)throw new Error(`Actions offset differs between cards: ${JSON.stringify(actionsOffsets)}`);
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
        ageInputWidth:document.getElementById("pf_age").getBoundingClientRect().width,
        ageInputTop:document.getElementById("pf_age").getBoundingClientRect().top,
        zodiacInputTop:document.getElementById("pf_zodiac").getBoundingClientRect().top
      };
    });

    // 5. Name/Surname are row 1 (above birth date, which is above vitals).
    if(!layout.namesHasNameSurname)throw new Error("Name/Surname are not together in the first résумé row");
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
    // near-vertical single column (two intentional lines, not four wrapped ones).
    if(!layout.sublabelIsBlock)throw new Error("Age sublabel is not rendered on its own line");
    if(layout.ageFieldTopHeight>48)throw new Error(`Age field-top is taller than two label lines — looks wrapped, not intentional: ${layout.ageFieldTopHeight}px at width=${width}`);
    // 10. "не указывать" stays visible/usable and does not visibly starve
    // its neighboring input (Age's own input keeps a reasonable width).
    if(!layout.hideAgeVisible)throw new Error("Age's «не указывать» checkbox is not visible");
    if(!layout.hideBirthdayVisible)throw new Error("Birth date's «не указывать» checkbox is not visible");
    if(layout.ageInputWidth<80)throw new Error(`Age input was squeezed by its «не указывать» checkbox: ${layout.ageInputWidth}px at width=${width}`);

    // D. Age and Zodiac controls start on the same visual horizontal line —
    // previously Age's two-line label ("Возраст" + the "на начало истории"
    // hint) made its .profile-field-top taller than Zodiac's one-line
    // label, pushing #pf_age's own control down below #pf_zodiac's.
    const controlTopDelta=Math.abs(layout.ageInputTop-layout.zodiacInputTop);
    if(controlTopDelta>1)throw new Error(`Age and Zodiac controls do not start on the same line at width=${width}: diff=${controlTopDelta}px`);

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

  // ================= PHOTO RAIL (11-24) =================

  // 11. One photo -> one primary portrait; the rail still renders (its width
  // is always reserved) but with no thumbnail children — not omitted, and
  // not a pointless placeholder card either.
  {
    await page.locator('.profile-card[data-character-id="resume-partial"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const railInfo=await page.evaluate(()=>{
      const rail=document.querySelector(".photo-rail");
      return {exists:!!rail,thumbCount:rail?rail.querySelectorAll(".photo-thumb").length:-1,width:rail?rail.getBoundingClientRect().width:0};
    });
    if(!railInfo.exists)throw new Error("Photo rail container is missing even though its width must always be reserved");
    if(railInfo.thumbCount!==0)throw new Error("A single photo should not render any thumbnails in the rail");
    if(railInfo.width<20)throw new Error(`Rail width is not reserved for a single-photo character: ${railInfo.width}px`);
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

  // 12+23. Two photos -> one large active portrait + a vertical rail of
  // thumbnails BESIDE it (not below it); primary indicator is correct.
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const info=await page.evaluate(()=>{
      const resume=document.querySelector(".profile-resume");
      const rail=document.querySelector(".photo-rail");
      const photosRow=document.getElementById("profilePhotosGrid");
      return {
        resumeHeight:resume.getBoundingClientRect().height,
        railPresent:!!rail,
        thumbCount:document.querySelectorAll(".photo-thumb").length,
        photosRowDirection:getComputedStyle(photosRow).flexDirection,
        railBesidePortrait:document.querySelector(".photo-item-primary").getBoundingClientRect().right<=rail.getBoundingClientRect().left+1,
        primaryBadgeOnPrimaryTile:!!document.querySelector('.photo-item-primary[data-photo-id="photo-full-1"] .photo-primary'),
        primaryMarkOnThumb:!!document.querySelector('.photo-thumb[data-photo-id="photo-full-1"] .photo-thumb-primary-mark')
      };
    });
    if(!info.railPresent)throw new Error("Two photos should render the rail");
    if(info.thumbCount!==2)throw new Error(`Expected 2 thumbnails, got ${info.thumbCount}`);
    if(info.photosRowDirection!=="row")throw new Error(`Portrait+rail are not laid out side by side (flex-direction=${info.photosRowDirection}) — looks like the old stacked/below-the-portrait strip`);
    if(!info.railBesidePortrait)throw new Error("Rail does not sit beside (to the right of) the primary portrait");
    if(info.resumeHeight>420)throw new Error(`Two-photo résumé header grew too tall: ${info.resumeHeight}px`);
    if(!info.primaryBadgeOnPrimaryTile)throw new Error("Primary badge is not on the primary photo's enlarged tile");
    if(!info.primaryMarkOnThumb)throw new Error("Primary indicator is not on the primary photo's thumbnail");
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // 13+14+15+16. Five-or-more photos still don't fall back to a horizontal
  // strip or a stacked-below-the-portrait mini-gallery: the rail stays
  // vertical and any overflow scrolls inside it only.
  {
    await page.locator('.profile-card[data-character-id="resume-many"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const info=await page.evaluate(()=>{
      const rail=document.querySelector(".photo-rail");
      return {
        thumbCount:document.querySelectorAll(".photo-thumb").length,
        railFlexDirection:getComputedStyle(rail).flexDirection,
        primaryTileCount:document.querySelectorAll(".photo-item-primary").length
      };
    });
    if(info.thumbCount!==5)throw new Error(`Expected 5 thumbnails for a 5-photo character, got ${info.thumbCount}`);
    if(info.railFlexDirection!=="column")throw new Error(`Thumbnail rail is not a vertical column (found "${info.railFlexDirection}") — looks like the old horizontal strip`);
    if(info.primaryTileCount!==1)throw new Error(`Expected exactly one enlarged primary/active portrait, found ${info.primaryTileCount}`);

    // No horizontal scrollbar anywhere in the photo column; the rail may
    // only scroll vertically.
    const overflow=await page.evaluate(()=>{
      const row=document.getElementById("profilePhotosGrid"),rail=document.querySelector(".photo-rail");
      return {
        rowScrollsY:row.scrollHeight>row.clientHeight+1,
        rowScrollsX:row.scrollWidth>row.clientWidth+1,
        railScrollsX:rail.scrollWidth>rail.clientWidth+1,
        railScrollsY:rail.scrollHeight>rail.clientHeight+1
      };
    });
    if(overflow.rowScrollsY)throw new Error("Photo row has an unexpected vertical scrollbar");
    if(overflow.rowScrollsX)throw new Error("Photo row (outside the rail) has a horizontal scrollbar");
    if(overflow.railScrollsX)throw new Error("Thumbnail rail scrolls horizontally — it must only ever scroll vertically");

    // 17. Selecting a thumbnail changes the active managed photo.
    const thirdThumb=page.locator(".photo-thumb").nth(2);
    await thirdThumb.click();
    if(await thirdThumb.getAttribute("aria-selected")!=="true")throw new Error("Clicking a thumbnail did not mark it selected");
    const activePhotoId=await page.evaluate(()=>document.querySelector(".photo-item-primary").dataset.photoId);
    if(activePhotoId!=="photo-many-2")throw new Error(`Selecting a thumbnail did not change the active/enlarged photo: ${activePhotoId}`);

    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // C. Ten photos overflow the rail's height (matched to the portrait) and
  // must scroll vertically inside the rail only — never by growing the
  // photo row or falling back to a horizontal scrollbar.
  {
    await page.locator('.profile-card[data-character-id="resume-ten"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const overflow=await page.evaluate(()=>{
      const row=document.getElementById("profilePhotosGrid"),rail=document.querySelector(".photo-rail");
      return {
        thumbCount:document.querySelectorAll(".photo-thumb").length,
        rowScrollsY:row.scrollHeight>row.clientHeight+1,
        rowScrollsX:row.scrollWidth>row.clientWidth+1,
        railScrollsX:rail.scrollWidth>rail.clientWidth+1,
        railScrollsY:rail.scrollHeight>rail.clientHeight+1
      };
    });
    if(overflow.thumbCount!==10)throw new Error(`Expected 10 thumbnails for a 10-photo character, got ${overflow.thumbCount}`);
    if(overflow.rowScrollsY)throw new Error("Photo row has an unexpected vertical scrollbar for a 10-photo character");
    if(overflow.rowScrollsX)throw new Error("Photo row (outside the rail) has a horizontal scrollbar for a 10-photo character");
    if(overflow.railScrollsX)throw new Error("Thumbnail rail scrolls horizontally for a 10-photo character");
    if(!overflow.railScrollsY)throw new Error("Rail with 10 photos should need to scroll vertically");
    await page.click("#cancelProfile");
    if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
  }

  // No-photo empty state renders a placeholder, not a broken/empty grid.
  {
    await page.locator('.profile-card[data-character-id="resume-nophoto"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    if(!await page.locator(".photo-item-empty").count())throw new Error("No-photo empty state placeholder is missing");
    if(await page.locator(".photo-thumb").count())throw new Error("No-photo state should not render any rail thumbnails");
    await page.click("#cancelProfile");
  }

  // ================= RÉSЮМЕ HEIGHT / IDENTITY STABILITY (A+B) =================
  // 1, 2, 5 and 10 photos should produce practically the same résumé height
  // and the same X/Y position for Name/Surname/Birthday — the whole point of
  // moving the secondary photos into a reserved-width vertical rail instead
  // of a strip that grew downward under the portrait.
  {
    const samples=[];
    for(const id of ["resume-partial","resume-full","resume-many","resume-ten"]){
      await page.locator(`.profile-card[data-character-id="${id}"] button[aria-label^="Редактировать анкету"]`).click();
      await page.waitForSelector("#profileEditorModal",{state:"visible"});
      const geo=await page.evaluate(()=>{
        const rail=document.querySelector(".photo-rail");
        const firstThumb=document.querySelector(".photo-thumb");
        return {
          resumeHeight:document.querySelector(".profile-resume").getBoundingClientRect().height,
          photoColumnHeight:document.querySelector(".profile-resume-photo").getBoundingClientRect().height,
          nameTop:document.getElementById("pf_name").getBoundingClientRect().top,
          nameLeft:document.getElementById("pf_name").getBoundingClientRect().left,
          birthdayTop:document.querySelector(".profile-resume-birthday").getBoundingClientRect().top,
          personalityTop:document.querySelector(".profile-section-title").getBoundingClientRect().top,
          railWidth:rail?rail.getBoundingClientRect().width:null,
          railScrolls:rail?rail.scrollHeight>rail.clientHeight+1:null,
          firstThumbLeft:firstThumb?firstThumb.getBoundingClientRect().left:null
        };
      });
      samples.push({id,...geo});
      await page.click("#cancelProfile");
      if(await page.locator("#discardChangesModal").isVisible())await page.click("#discardChanges");
    }
    const spread=key=>Math.max(...samples.map(s=>s[key]))-Math.min(...samples.map(s=>s[key]));
    if(spread("resumeHeight")>6)throw new Error(`Résumé height varies with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,h:s.resumeHeight})))}`);
    if(spread("photoColumnHeight")>6)throw new Error(`Photo column height varies with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,h:s.photoColumnHeight})))}`);
    if(spread("nameTop")>1)throw new Error(`#pf_name Y position shifts with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,top:s.nameTop})))}`);
    if(spread("nameLeft")>1)throw new Error(`#pf_name X position shifts with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,left:s.nameLeft})))}`);
    if(spread("birthdayTop")>1)throw new Error(`Birth-date row Y position shifts with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,top:s.birthdayTop})))}`);
    if(spread("personalityTop")>6)throw new Error(`"Личность" section start shifts with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,top:s.personalityTop})))}`);

    // 39/40/41/45/46. The exact 1/2/5/10-photo acceptance list: rail width
    // and thumbnail X are stable whether or not the rail actually overflows
    // (resume-ten's 10 photos is the only fixture that scrolls).
    if(spread("railWidth")>1)throw new Error(`Photo rail width varies with photo count: ${JSON.stringify(samples.map(s=>({id:s.id,w:s.railWidth})))}`);
    const withThumbs=samples.filter(s=>s.firstThumbLeft!==null);
    const thumbSpread=Math.max(...withThumbs.map(s=>s.firstThumbLeft))-Math.min(...withThumbs.map(s=>s.firstThumbLeft));
    if(thumbSpread>1)throw new Error(`Thumbnail X position shifts once the rail overflows (scrollbar-gutter not reserved): ${JSON.stringify(withThumbs.map(s=>({id:s.id,left:s.firstThumbLeft})))}`);
    const tenPhotoSample=samples.find(s=>s.id==="resume-ten");
    if(!tenPhotoSample.railScrolls)throw new Error("10-photo rail should need to scroll vertically");
    const onePhotoSample=samples.find(s=>s.id==="resume-partial");
    if(onePhotoSample.railScrolls)throw new Error("1-photo rail unexpectedly needs to scroll");
  }

  // 18-22+24+F. Preview/crop/make-primary(star)/delete(trash)/add-photo all
  // still work from the résumé photo column via the active-photo + shared
  // icon-action-row model, and photo state (order, primary) round-trips
  // through save/reload.
  {
    await page.locator('.profile-card[data-character-id="resume-full"] button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    const photosGrid=page.locator("#profilePhotosGrid");

    // 26-34. View/Crop/Star/Trash are ALL icon-only buttons (no visible
    // "Просмотреть"/"Кадрировать" text), sharing one button box size, laid
    // out on a single horizontal row, with correct aria-label/title.
    const actionRow=await page.evaluate(()=>{
      const row=document.querySelector(".photo-actions");
      const buttons=[...row.querySelectorAll("button")];
      const rects=buttons.map(b=>b.getBoundingClientRect());
      const heights=[...new Set(rects.map(r=>Math.round(r.height)))];
      const widths=[...new Set(rects.map(r=>Math.round(r.width)))];
      const oneRow=[...new Set(rects.map(r=>Math.round(r.top)))].length===1;
      const view=row.querySelector('[data-action="view-photo"]');
      const crop=row.querySelector('[data-action="crop-photo"]');
      return {
        count:buttons.length,heights,widths,oneRow,
        view:{hasSvg:!!view.querySelector("svg"),text:view.textContent.trim(),ariaLabel:view.getAttribute("aria-label"),title:view.getAttribute("title")},
        crop:{hasSvg:!!crop.querySelector("svg"),text:crop.textContent.trim(),ariaLabel:crop.getAttribute("aria-label"),title:crop.getAttribute("title")}
      };
    });
    if(!actionRow.view.hasSvg)throw new Error("View action has no SVG icon");
    if(actionRow.view.text)throw new Error(`View action should be icon-only (no visible "Просмотреть" text), found: "${actionRow.view.text}"`);
    if(actionRow.view.ariaLabel!=="Просмотреть фотографию")throw new Error(`View aria-label regressed: ${actionRow.view.ariaLabel}`);
    if(actionRow.view.title!=="Просмотреть фотографию")throw new Error(`View title regressed: ${actionRow.view.title}`);
    if(!actionRow.crop.hasSvg)throw new Error("Crop action has no SVG icon");
    if(actionRow.crop.text)throw new Error(`Crop action should be icon-only (no visible "Кадрировать" text), found: "${actionRow.crop.text}"`);
    if(actionRow.crop.ariaLabel!=="Кадрировать фотографию")throw new Error(`Crop aria-label regressed: ${actionRow.crop.ariaLabel}`);
    if(actionRow.crop.title!=="Кадрировать фотографию")throw new Error(`Crop title regressed: ${actionRow.crop.title}`);
    if(actionRow.heights.length!==1)throw new Error(`Photo action buttons do not share one box height: ${JSON.stringify(actionRow.heights)}`);
    if(actionRow.widths.length!==1)throw new Error(`Photo action buttons do not share one box width: ${JSON.stringify(actionRow.widths)}`);
    if(!actionRow.oneRow)throw new Error("Photo action buttons are not all on one horizontal row");

    // F. Star/Trash are icon-only buttons (no visible text) carrying the
    // required accessible name/title, using the same inline-SVG icon
    // grammar as other row actions in the app (not emoji).
    await page.locator('.photo-thumb[data-photo-id="photo-full-2"]').click();
    const starInfo=await page.evaluate(()=>{
      const btn=document.querySelector('[data-action="make-primary"]');
      return btn&&{hasSvg:!!btn.querySelector("svg"),text:btn.textContent.trim(),ariaLabel:btn.getAttribute("aria-label"),title:btn.getAttribute("title")};
    });
    if(!starInfo)throw new Error("Make-primary (star) action button is missing");
    if(!starInfo.hasSvg)throw new Error("Make-primary action has no SVG icon");
    if(starInfo.text)throw new Error(`Make-primary action should be icon-only (no visible text), found: "${starInfo.text}"`);
    if(starInfo.ariaLabel!=="Сделать главным")throw new Error(`Make-primary aria-label regressed: ${starInfo.ariaLabel}`);
    if(starInfo.title!=="Сделать главным")throw new Error(`Make-primary title regressed: ${starInfo.title}`);

    const trashInfoBefore=await page.evaluate(()=>{
      const btn=document.querySelector('[data-action="delete-photo"]');
      return {hasSvg:!!btn.querySelector("svg"),text:btn.textContent.trim(),ariaLabel:btn.getAttribute("aria-label"),title:btn.getAttribute("title")};
    });
    if(!trashInfoBefore.hasSvg)throw new Error("Delete-photo action has no SVG icon");
    if(trashInfoBefore.text)throw new Error(`Delete-photo action should be icon-only (no visible text), found: "${trashInfoBefore.text}"`);
    if(trashInfoBefore.ariaLabel!=="Удалить фотографию")throw new Error(`Delete-photo aria-label regressed: ${trashInfoBefore.ariaLabel}`);
    if(trashInfoBefore.title!=="Удалить фотографию")throw new Error(`Delete-photo title regressed: ${trashInfoBefore.title}`);

    // 20. Make-primary: select the non-primary thumbnail, then use the star
    // icon button (aria-label is still the accessible name Playwright matches).
    await photosGrid.getByRole("button",{name:"Сделать главным"}).click();
    if(!await page.locator('.photo-item-primary[data-photo-id="photo-full-2"] .photo-primary').count())throw new Error("Make-primary did not work from the résumé photo column");
    // When the active photo IS already primary, the star action is not
    // offered at all (consistent with the pre-existing behavior for the
    // text button it replaces).
    if(await page.locator('[data-action="make-primary"]').count())throw new Error("Star (make-primary) action should not render for a photo that is already primary");

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

    // 21. Delete the currently-active photo (photo-full-1) via the trash icon.
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
