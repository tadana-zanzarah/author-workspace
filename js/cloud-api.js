function throwIfError(result){
  if(result?.error)throw result.error;
  return result?.data;
}

function throwQueryError(result,table){
  if(!result?.error)return result?.data;
  const error=result.error;
  console.error("[Author Workspace cloud query]",{
    table,
    status:error?.status??null,
    code:error?.code??null,
    message:error?.message??String(error),
    details:error?.details??null,
    hint:error?.hint??null
  });
  if(error&&typeof error==="object")error.cloudQuery=table;
  throw error;
}

async function getVerifiedSession(client){
  const session=throwIfError(await client.auth.getSession())?.session??null;
  if(!session)return null;
  const user=throwIfError(await client.auth.getUser())?.user??null;
  if(!user||user.id!==session.user?.id)throw new Error("Authenticated session user mismatch");
  return {...session,user};
}

function createCloudApi(client){
  if(!client)throw new TypeError("Supabase client is required");
  return {
    async getSession(){return getVerifiedSession(client)},
    onAuthStateChange(callback){return client.auth.onAuthStateChange((event,session)=>callback(session,event))},
    async signUp({email,password,displayName,emailRedirectTo}){
      return throwIfError(await client.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo}}));
    },
    async signIn({email,password}){return throwIfError(await client.auth.signInWithPassword({email,password}))},
    async signOut(){throwIfError(await client.auth.signOut())},
    async loadAccount(){
      const user=throwIfError(await client.auth.getUser())?.user??null;
      if(!user)throw new Error("Authenticated user is unavailable");
      const [profileResult,seriesResult,projectsResult]=await Promise.all([
        client.from("profiles").select("user_id,display_name,avatar_path,bio,settings,created_at,updated_at").single(),
        client.from("series").select("*").is("deleted_at",null).order("created_at"),
        client.from("projects").select("*").is("deleted_at",null).order("created_at")
      ]);
      return {
        profile:throwQueryError(profileResult,"profiles"),
        series:throwQueryError(seriesResult,"series")||[],
        projects:throwQueryError(projectsResult,"projects")||[]
      };
    },
    async createSeries({ownerId,title,description=""}){
      return throwIfError(await client.from("series").insert({owner_id:ownerId,title,description}).select().single());
    },
    async updateSeries(id,changes){
      return throwIfError(await client.from("series").update(changes).eq("id",id).select().single());
    },
    async archiveSeries(id){throwIfError(await client.rpc("archive_series_keep_projects",{target_series_id:id}))},
    async createProject({ownerId,title,description="",seriesId=null,position=null}){
      return throwIfError(await client.from("projects").insert({
        owner_id:ownerId,title,description,series_id:seriesId,position_in_series:seriesId?position:null
      }).select().single());
    },
    async setProjectSeries(projectId,seriesId,position=null){
      throwIfError(await client.rpc("set_project_series",{
        target_project_id:projectId,target_series_id:seriesId,target_position:seriesId?position:null
      }));
    },
    async reorderSeries(seriesId,projectIds){
      throwIfError(await client.rpc("reorder_series_projects",{
        target_series_id:seriesId,ordered_project_ids:projectIds
      }));
    }
  };
}

export {createCloudApi,getVerifiedSession,throwIfError,throwQueryError};
