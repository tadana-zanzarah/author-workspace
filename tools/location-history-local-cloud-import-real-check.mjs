// Location History -- HYBRID IMPLEMENTATION -- real-cloud local->cloud import acceptance check.
// Pure Node + @supabase/supabase-js against the REAL production project (no browser needed --
// mirrors tools/local-to-cloud-migration-real.test.mjs exactly), now that both History migrations
// are live. Builds a local project fixture carrying history.origin/historicalOverview/legends plus
// historyEvents (one undated, one with a fantasy free-text date label, one deliberately malformed
// blank-title event that must be dropped with a warning, never abort the import), runs the real
// buildLocalToCloudMigrationPreview -> confirmLocalToCloudMigrationPlan -> executeLocalToCloudMigration
// pipeline, and verifies prose/events/order/ids survived via get_local_project_import_snapshot.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {buildLocalToCloudMigrationPreview} from "../js/local-to-cloud-migration.js";
import {confirmLocalToCloudMigrationPlan,executeLocalToCloudMigration} from "../js/local-to-cloud-migration-execution.js";

const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location history local-cloud import real check skipped: credentials are not configured");process.exit(0)}
class UnusedRealtimeTransport{}
const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT",{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:UnusedRealtimeTransport}});
const marker=crypto.randomBytes(6).toString("hex"),title=`AW history-import ${marker}`;
const cleanup={projectId:null};
const must=async promise=>{const result=await promise;if(result.error)throw result.error;return result.data};

try{
  const auth=await must(client.auth.signInWithPassword({email,password})),ownerId=auth.user.id;
  const project=await must(client.from("projects").insert({owner_id:ownerId,title}).select("id,revision").single());
  cleanup.projectId=project.id;

  const local={
    version:11,characters:[],profiles:{},characterLinks:[],
    chapters:[{id:"chapter-unassigned",title:"Без главы"}],
    locations:[{
      id:"local-location",name:`History Import Location ${marker}`,description:"",
      baseProfile:{history:{
        origin:`Основана беженцами ${marker}.`,
        historicalOverview:`Быстро выросла благодаря гавани ${marker}.`,
        legends:`Под городом спит дракон ${marker}.`
      }},
      historyEvents:[
        {id:"local-event-undated",title:`Легенда ${marker}`,dateLabel:"",description:`Никто не знает точно, когда это случилось ${marker}.`,sortOrder:0},
        {id:"local-event-fantasy",title:`Основание ${marker}`,dateLabel:"за три века до войны",description:"",sortOrder:1},
        {id:"local-event-malformed",title:"   ",dateLabel:"должно быть отброшено",description:"",sortOrder:2}
      ]
    }],
    tags:[],scenes:[]
  };
  const localBefore=JSON.stringify(local);
  const preview=buildLocalToCloudMigrationPreview({localProject:local,sourceProjectId:`acceptance-history-${marker}`,targetProjectId:project.id,targetProjectRevision:project.revision,targetCloudState:{}});
  assert.equal(preview.ready,true,JSON.stringify(preview.blockingConflicts));
  assert.equal(preview.counts.historyEvents,2,"malformed (blank-title) event must not count as a surviving event");
  assert(preview.warnings.some(w=>w.code==="MISSING_HISTORY_EVENT_TITLE"),"malformed event must produce a warning, not a silent drop");

  const confirmed=confirmLocalToCloudMigrationPlan(preview,{migrationAttemptId:crypto.randomUUID()});
  const plannedEvents=confirmed.entityPlan.locations[0].historyEvents;
  assert.equal(plannedEvents.length,2);
  const undatedPlanned=plannedEvents.find(e=>e.localId==="local-event-undated");
  const fantasyPlanned=plannedEvents.find(e=>e.localId==="local-event-fantasy");

  const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client,ownerId,localSource:local});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.revision,project.revision+1);
  assert.equal(JSON.stringify(local),localBefore,"local source must be untouched by import");

  const canonicalId=(await must(client.from("project_locations").select("location_id").eq("project_id",project.id).single())).location_id;

  // prose preserved
  const locationRow=await must(client.from("locations").select("base_profile").eq("id",canonicalId).single());
  assert.equal(locationRow.base_profile.history.origin,`Основана беженцами ${marker}.`);
  assert.equal(locationRow.base_profile.history.historicalOverview,`Быстро выросла благодаря гавани ${marker}.`);
  assert.equal(locationRow.base_profile.history.legends,`Под городом спит дракон ${marker}.`);

  // events preserved: titles, dateLabel (incl. blank + fantasy label) exact, descriptions, order,
  // deterministic ids, and the malformed event genuinely absent.
  const snapshot=await must(client.rpc("get_local_project_import_snapshot",{target_project_id:project.id}));
  assert.equal(snapshot.ok,true,JSON.stringify(snapshot));
  const events=snapshot.data.location_history_events;
  assert.equal(events.length,2,"malformed event must not have been imported");
  const undated=events.find(e=>e.id===undatedPlanned.id);
  const fantasy=events.find(e=>e.id===fantasyPlanned.id);
  assert(undated,"undated event must be present under its deterministic id");
  assert(fantasy,"fantasy-label event must be present under its deterministic id");
  assert.equal(undated.date_label,"","blank date_label must round-trip exactly as empty string, never defaulted to something else");
  assert.equal(undated.description,`Никто не знает точно, когда это случилось ${marker}.`);
  assert.equal(undated.sort_order,0);
  assert.equal(fantasy.date_label,"за три века до войны","fantasy free-text date label must round-trip verbatim, never parsed/rejected");
  assert.equal(fantasy.sort_order,1);
  assert.equal(events.some(e=>e.title.trim()===""),false,"the malformed blank-title event must never have been imported");

  // atomicity/idempotency of the migration_attempt_id replay path is already exhaustively covered
  // (mocked RPC) by tools/local-to-cloud-migration-execution.test.mjs and, at the real SQL layer,
  // by supabase/tests/location_history_events_foundation.sql's own import block -- not re-probed
  // here with a hand-built raw RPC payload against production, which would risk exercising a
  // payload shape this script does not actually construct the same way prepareLocalToCloudMigration
  // Execution does.

  console.log(JSON.stringify({ok:true,marker,revision:{before:project.revision,after:result.revision},eventCount:events.length,proseVerified:true,orderVerified:true,deterministicIdsVerified:true,malformedEventDropped:true,verification:result.verification.ok},null,2));
}finally{
  if(cleanup.projectId){
    const canonical=await client.from("project_locations").select("location_id").eq("project_id",cleanup.projectId);
    const locationIds=(canonical.data||[]).map(x=>x.location_id);
    if(locationIds.length)await client.from("location_history_events").delete().in("location_id",locationIds);
    const removedProject=await client.from("projects").delete().eq("id",cleanup.projectId);
    if(removedProject.error)console.error("cleanup project",removedProject.error.message);
    if(locationIds.length){const removedLocations=await client.from("locations").delete().in("id",locationIds);if(removedLocations.error)console.error("cleanup locations",removedLocations.error.message)}
    const verifyProjects=await client.from("projects").select("id",{count:"exact",head:true}).eq("title",title);
    const verifyLocations=locationIds.length?await client.from("locations").select("id",{count:"exact",head:true}).in("id",locationIds):{count:0,error:null};
    const verifyEvents=locationIds.length?await client.from("location_history_events").select("id",{count:"exact",head:true}).in("location_id",locationIds):{count:0,error:null};
    const cleanupReport={projects:verifyProjects.count??-1,locations:verifyLocations.count??-1,events:verifyEvents.count??-1};
    console.log(JSON.stringify({cleanup:cleanupReport}));
    assert.deepEqual(cleanupReport,{projects:0,locations:0,events:0});
  }
  await client.auth.signOut();
}
