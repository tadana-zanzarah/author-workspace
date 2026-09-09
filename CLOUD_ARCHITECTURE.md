# Cloud architecture

## Текущая граница

Supabase — authoritative источник для аккаунта, контейнеров проектов (`series`/`projects`) и для
содержимого проекта: глав, сцен, тегов, локаций и персонажей, включая участников сцен и их
отношения (полный список сущностей — ниже). `localStorage` для этого контента используется
только как last-good cache/recovery: он не подгружается в облако автоматически и не является
триггером cloud-мутации.

Единственное исключение — историческое legacy-пространство до появления аккаунтов
(ключ `novelTimelineV11`) и явный recovery-режим `?local=1`: они остаются полностью
localStorage-driven и не связаны с cloud-контентом текущего открытого проекта. Открытие
cloud-проекта использует отдельный локальный namespace `authorWorkspace:project:<cloud-project-uuid>`.

## Реализованная модель: аккаунт и контейнеры

- `auth.users` — identity и Supabase Auth session.
- `profiles` — приватное состояние аккаунта один-к-одному с `auth.users`.
- `series` — принадлежащие пользователю циклы; soft delete через `deleted_at`.
- `projects` — принадлежащие пользователю контейнеры проектов; `series_id` nullable, поэтому
  проект может быть самостоятельным. Один FK означает максимум один цикл.

RLS проверяет владельца через `(select auth.uid())`. Frontend-фильтрация не является механизмом
безопасности. Перемещение проекта, полный порядок цикла и архивирование цикла выполняются
атомарными `security invoker` RPC (архивирование цикла: книги сначала становятся
самостоятельными, затем цикл архивируется).

## Реализованная модель: содержимое проекта

- `chapters`, `scenes`, `tags`, `scene_tags` — главы; core-поля сцены (заголовок, текст рукописи,
  дата/время, статус написания/размещения, позиция, привязка к главе и локации); теги и
  scene tags.
- `characters` — глобальная identity персонажа в аккаунте (имя, анкета/`base_profile`).
- `project_characters` — участие персонажа в конкретном проекте: роль, порядок,
  project-level overrides анкеты поверх глобальной identity.
- `character_links` — структурные связи персонажей, независимые от эмоциональных отношений;
  `project_id` nullable, поэтому связь может принадлежать global character identity или быть
  project-scoped.
- `project_character_relations` — начальные эмоциональные отношения персонажей в проекте.
- `scene_characters` / `scene_relation_changes` — участники конкретной сцены (action, legacy
  state) и явные изменения отношений по сценам; derived/effective relation state не
  сохраняется — только initial relation и явные scene changes.
- `character_images` — metadata и `storage_path`; binary в Postgres не хранится.
- `locations` / `project_locations` — канонический профиль локации (имя, официальное имя,
  алиасы, тип, краткое описание, иерархия parent/children, тематические `base_profile` модули) и
  участие локации в конкретном проекте (выбор видимых тематических модулей).
- `location_media` — медиа-галерея локации: metadata и `storage_path`.
- `location_history_events` — хронологические события истории локации (заголовок, дата-метка,
  описание, порядок).

Для каждой из этих сущностей, где существует transactional RPC, прямые записи content tables из
UI запрещены — мутация обязана идти через RPC.

## Canonical identity vs project participation

Реализовано для двух сущностей:

- **CHARACTER** (`characters`) — глобальная identity в аккаунте; **PROJECT_CHARACTER**
  (`project_characters`) — участие и project-level overrides анкеты в конкретном проекте.
- **LOCATION** (`locations`) — канонический профиль и иерархия; **PROJECT_LOCATION**
  (`project_locations`) — участие локации в проекте и выбор видимых тематических модулей.

## Revision/concurrency-модель

Несколько независимых revision-доменов:

- `projects.revision` — для project-scoped мутаций: главы, core-поля сцен, теги/scene tags,
  участие локации (выбор модулей), участники сцен, отношения персонажей в проекте,
  project-scoped character/link мутации.
- Собственная revision персонажа (`characters.revision`) — для глобальных мутаций identity
  персонажа (имя, анкета, архивирование); project revision для них не используется.
- Собственная revision канонической локации (`locations.revision`) — для мутаций канонического
  профиля/иерархии локации и истории локации; project revision для них не используется.
- Собственная revision глобальной structural link (`character_links.revision`) — для
  не-project-scoped связей.

Общее для всех доменов: каждая cloud content mutation обязана сначала получить row lock и
проверить ownership/revision; успешная логическая операция увеличивает соответствующую revision
ровно один раз; семантический no-op не изменяет content rows, `updated_at` или revision; конфликт
(`REVISION_CONFLICT` и его revision-специфичные варианты) никогда не повторяется автоматически —
caller обязан reload/resolve конфликт. Project-scoped мутации выполняются сериализованной
revision-aware очередью и используют только последний подтверждённый сервером revision.

## Медиа/Storage

Character images и location media хранятся только как metadata + `storage_path` в Postgres;
бинарные данные — в Supabase Storage. Signed/private URL — transient runtime value, не
сохраняется как canonical project data. Оригинальное изображение персонажа не заменяется
результатом кадрирования — crop хранится отдельно как metadata. Cloud image write считается
успешным только после согласованного результата Storage + DB; partial failure требует
compensation или явного recoverable orphan state.

## Local→cloud migration

Реализован мастер миграции легаси-локального workspace в облако:

- выполняется по схеме preview before write; preview не имеет побочных эффектов;
- character identity не deduplicate по имени автоматически — mapping требует явного решения
  пользователя; неразрешённые ссылки и mappings блокируют миграцию;
- вся relational-миграция — одна атомарная транзакция; новые global identities откатываются
  вместе с project content при ошибке;
- storage partial writes используют journal и compensation только объектов текущей попытки;
  retry идемпотентен и сначала разрешается по attempt marker;
- исходный local project и mapped global identity никогда не перезаписываются и не удаляются
  автоматически после успешного импорта;
- upload legacy local image всегда требует явного подтверждения пользователя.

## Безопасность

- Browser использует только Supabase project URL и publishable key (либо legacy `anon` key). Они
  идентифицируют проект API, но не дают привилегий поверх RLS.
- `service_role`, secret key, database password, access tokens и private keys запрещены во
  frontend и Git.
- Создание профиля выполняет минимальный trigger на `auth.users`; его `security definer` функция
  находится в неэкспонируемой схеме `private`, а execute отозван у `public`, `anon` и
  `authenticated`.

## Ещё не реализовано

Явно НЕ реализовано на этом этапе — не путать с уже реализованным содержимым выше:

- расширяемые custom-поля анкеты персонажа поверх стандартной анкеты (`character_field_definitions`,
  `character_field_values`);
- `project_user_settings`.

## Более поздние публичные и совместные функции

Не реализованы и не должны смешиваться с private workspace:

- `publications`, `reviews`, `ratings`, `comments`, `library_entries`, `follows`, `project_members`.

**PUBLICATION позже является отдельным публичным объектом и никогда не даёт читателю прямой доступ
к private project.** Публичная версия должна быть явным snapshot/проекцией разрешённого автором
содержимого.

## Проверка RLS

`supabase/tests/cloud_foundation_rls.sql` создаёт в откатываемой транзакции User A/User B и
Project A/Project B, затем проверяет:

- User A видит Project A;
- User A не видит Project B;
- User A может изменить Project A;
- User A не может изменить Project B.

Скрипт предназначен для локальной Supabase database после применения migration.
