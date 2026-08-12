function throwIfError(result){
  if(result?.error)throw result.error;
  return result?.data;
}

function createCloudApi(client){
  if(!client)throw new TypeError("Supabase client is required");
  return {
    async getSession(){return throwIfError(await client.auth.getSession())?.session??null},
    onAuthStateChange(callback){return client.auth.onAuthStateChange((_event,session)=>callback(session))},
    async signUp({email,password,displayName}){
      return throwIfError(await client.auth.signUp({email,password,options:{data:{display_name:displayName}}}));
    },
    async signIn({email,password}){return throwIfError(await client.auth.signInWithPassword({email,password}))},
    async signOut(){throwIfError(await client.auth.signOut())},
    async loadAccount(){
      const [profileResult,seriesResult,projectsResult]=await Promise.all([
        client.from("profiles").select("user_id,display_name,avatar_path,bio,settings,created_at,updated_at").single(),
        client.from("series").select("*").is("deleted_at",null).order("created_at"),
        client.from("projects").select("*").is("deleted_at",null).order("created_at")
      ]);
      return {
        profile:throwIfError(profileResult),
        series:throwIfError(seriesResult)||[],
        projects:throwIfError(projectsResult)||[]
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

export {createCloudApi,throwIfError};
