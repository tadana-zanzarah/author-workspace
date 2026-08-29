alter table public.character_images
  drop constraint if exists character_images_character_context_fkey;

alter table public.character_images
  add constraint character_images_character_context_fkey
  foreign key (character_id,project_character_id)
  references public.project_characters(character_id,id)
  on delete cascade;
