# Local project → cloud migration

Checkpoint 1 вводит только чистый dry-run: `buildLocalToCloudMigrationPreview()` читает уже подготовленный V11 project и cloud snapshot, но не обращается к `localStorage`, Supabase RPC или Storage. Источник для workspace — `authorWorkspace:project:<cloudProjectId>`; чтение и существующая V10→V11 подготовка остаются отдельными этапами.

## Mapping

Preview строит план для `characters`/`project_characters`, `chapters`, `locations`, `tags`, `scenes`, `scene_tags`, `scene_characters`, `project_character_relations`, `scene_relation_changes`, `character_links` и `character_images`.

- Каждый local character требует явного `CREATE_NEW_GLOBAL_IDENTITY` или `MAP_TO_EXISTING_CHARACTER`. Совпадение нормализованного имени даёт только список candidates и никогда не выбирает identity.
- Валидный local UUID сохраняется. Несовместимый ID получает детерминированный UUID, зависящий от source project, target project, типа сущности и старого ID. Полная карта old→new возвращается в `provenance` и должна без изменений использоваться execution phase.
- `chapter-unassigned` всегда планируется как `chapter_id = NULL`; cloud chapter для «Без главы» не создаётся.
- Scene plan сохраняет provenance, chapter/location/tags, position, title, `scene_text`, строгие date/time, placement/writing status, `included` и `dateReview`.
- `people` преобразуются в будущие `scene_characters` с action, `legacy_state` и sort order. Initial relations становятся `project_character_relations`, явные scene changes — `scene_relation_changes`. Пустое явное значение означает `clear`; derived relation state не сохраняется.
- Structural link сохраняет прямую/обратную семантику. Если local data не содержит `global`/`project` scope, это обязательное пользовательское решение.
- Canonical `storage_path` можно переиспользовать как metadata plan. Data URL требует отдельного будущего upload confirmation; preview вычисляет размер, проверяет MIME и лимит 3 MiB, сохраняя crop, primary, caption, order и безопасные metadata. Binary и signed URL не записываются в план как canonical cloud data.

Безопасные неизвестные поля остаются в `source`/metadata частей entity plan. Опасные prototype-pollution keys отбрасываются существующим `safeOwnCopy`.

## Preview contract

Результат содержит:

```js
{
  ready,
  sourceProjectId,
  targetProjectId,
  localSchemaVersion,
  expectedProjectRevision,
  counts,
  warnings,
  blockingConflicts,
  characterMappings,
  imageUploads,
  provenance,
  chapterMappings,
  target,
  entityPlan
}
```

Blockers включают неизвестную schema, отсутствующие/повторные stable IDs, normalized tag duplicates, dangling references, invalid strict dates/times, unresolved character or link-scope decisions, semantic structural-link duplicates, invalid/oversize images и non-empty target. Warnings включают совпадающие имена (без dedupe), явный legacy image upload и status values, которые требуют review.

Non-empty target не merge-ится и не заменяется preview-функцией: результат предлагает выбрать другой project либо отдельный будущий replace flow с явным подтверждением. `expectedProjectRevision` фиксирует concurrency boundary; перед execution snapshot и revision должны быть проверены снова, а `REVISION_CONFLICT` требует reload/resolve.

## Checkpoint 2 outline

Execution должен принять завершённый preview, повторно проверить target revision, сохранить исходный local project, выполнить только transactional RPC в согласованном порядке и обновить cache лишь после server confirmation. Storage upload идёт отдельным подтверждённым шагом; при частичном сбое нужны compensation либо явный recoverable orphan record. Local source после успеха не удаляется автоматически. Rollback означает сохранение source и server-side compensation/recovery, а не восстановление из автоматически перезаписанного local cache.
