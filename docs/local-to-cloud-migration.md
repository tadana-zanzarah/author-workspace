# Local project → cloud migration

Checkpoint 1 ввёл чистый dry-run: `buildLocalToCloudMigrationPreview()` читает уже подготовленный V11 project и cloud snapshot, но не обращается к `localStorage`, Supabase RPC или Storage. Checkpoint 2 добавляет независимый от DOM execution API; источник для workspace — `authorWorkspace:project:<cloudProjectId>`, а чтение и существующая V10→V11 подготовка остаются отдельными этапами.

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

## Execution lifecycle

`confirmLocalToCloudMigrationPlan()` принимает только `ready` preview без blockers и фиксирует UUID `migrationAttemptId`. `prepareLocalToCloudMigrationExecution()` повторно валидирует plan/provenance/mappings/scopes и строит отдельно DB payload и upload journal. Raw local blob executor не принимает, спорные решения не делает.

`executeLocalToCloudMigration()` выполняет:

1. `preflight_local_project_import`: auth, ownership, plan shape, revision, empty target, image paths/primary constraints и attempt collision без mutations.
2. Декодирование подтверждённых legacy data URL в память и upload в private `character-images` с `upsert:false` по стабильному `<owner>/characters/<character>/<photo>/original.<ext>`.
3. `import_local_project_content`: один project row lock и одна Postgres transaction для новых identities, memberships, chapters/locations/tags/scenes, adjuncts, relations, links и image metadata.
4. `get_local_project_import_snapshot` и сравнение planned IDs/counts с authoritative snapshot.

DB payload никогда не содержит data URL/base64 или signed URL. Для mapped identity RPC только проверяет существование/owner и создаёт project membership; `characters.base_profile` не меняется. Local differences сохраняются как project override с различием missing key/inherit и explicit `null`. Для new identity создание character и project content находится в одной транзакции, поэтому relational failure откатывает identity.

`chapter-unassigned` не вставляется: соответствующая scene получает `chapter_id = NULL`. Derived emotional relation state не сохраняется; initial relations и явные scene changes остаются отдельными directed rows. Structural links импортируются только с resolved `global` (`project_id = NULL`) или `project` scope.

## Revision, idempotency and unknown result

RPC блокирует project `FOR UPDATE`, повторно проверяет `projects.revision` и emptiness и увеличивает revision ровно один раз после всех relational writes. `local_project_import_attempts` хранит committed result по stable attempt UUID и fingerprint. Повтор того же payload возвращает тот же result без записей и revision bump; reuse UUID с другим payload отклоняется.

Если RPC вернул определённую Postgres/permission ошибку, executor компенсирует Storage и сообщает safe domain code. Если транспорт оборвался и commit неизвестен, executor сначала вызывает `get_local_project_import_attempt`: committed result продолжает verification; отсутствие marker возвращает `UNKNOWN_IMPORT_RESULT` и запрещает blind retry.

## Storage compensation and verification

Journal различает `uploadedObjects`, byte-compatible `reusedObjects`, warnings и `cleanupFailures`. Collision никогда не перезаписывается: существующий объект переиспользуется только при полном совпадении bytes; иначе `STORAGE_COLLISION`. При DB failure удаляются только objects текущей попытки. Ошибка удаления возвращает `CLEANUP_INCOMPLETE` с recoverable orphan report; pre-existing/reused objects не удаляются.

После commit verification точно сверяет project-scoped rows и проверяет присутствие planned global link/image IDs. Несовпадение возвращает `VERIFICATION_FAILED`; уже committed data автоматически не удаляется. Structured result содержит attempt/source/target IDs, previous/new revision, created counts, mapped characters, uploaded/reused images, verification, warnings и cleanup failures без secrets или binary.

Успех никогда не удаляет, не очищает и не переписывает исходный local project. Cache/cloud-authoritative переключение остаётся задачей будущего wizard checkpoint 3.
