# Cloud architecture

## Граница текущего этапа

Supabase хранит аккаунт, профиль и метаданные контейнеров `series` / `projects`. Содержимое литературного проекта — персонажи, главы, сцены, тексты, локации, теги и отношения — на этом этапе остаётся в `localStorage` конкретного браузера.

Cloud project не означает cloud sync содержимого. Открытие контейнера выбирает отдельный локальный namespace `authorWorkspace:project:<cloud-project-uuid>`. Исторический ключ `novelTimelineV11` не переносится и не удаляется автоматически.

## Реализованная модель

- `auth.users` — identity и Supabase Auth session.
- `profiles` — приватное состояние аккаунта один-к-одному с `auth.users`.
- `series` — принадлежащие пользователю циклы; soft delete через `deleted_at`.
- `projects` — принадлежащие пользователю контейнеры проектов; `series_id` nullable, поэтому проект может быть самостоятельным. Один FK означает максимум один цикл.

RLS проверяет владельца через `(select auth.uid())`. Frontend-фильтрация не является механизмом безопасности. Архивирование цикла выполняется одной SQL-функцией: книги сначала становятся самостоятельными, затем цикл архивируется.

## Будущая модель содержимого

Следующий этап должен добавить:

- `characters`
- `project_characters`
- `character_field_definitions`
- `character_field_values`
- `character_images`
- `chapters`
- `scenes`
- `scene_characters`
- `locations`
- `tags`
- `scene_tags`
- `project_character_relations`
- `scene_relation_changes`
- `project_user_settings`

Обязательные правила:

1. **CHARACTER — глобальная identity в аккаунте.**
2. **PROJECT_CHARACTER — участие и состояние character в конкретном project.**
3. Любое поле анкеты может иметь project override без изменения глобальной identity.
4. Стандартная анкета расширяется custom fields через определения и значения полей.
5. WORKSPACE private. Доступ к строкам проекта не возникает из публикации или публичной ссылки.
6. Все сущности и ссылки используют устойчивые UUID/ID, а не имена или позиции массива.
7. Миграция содержимого из legacy/local namespace всегда начинается с preview, проверки ссылок и явного подтверждения; исходная локальная база сохраняется.

## Более поздние публичные и совместные функции

Не реализованы и не должны смешиваться с private workspace:

- `publications`
- `reviews`
- `ratings`
- `comments`
- `library_entries`
- `follows`
- `project_members`

**PUBLICATION позже является отдельным публичным объектом и никогда не даёт читателю прямой доступ к private project.** Публичная версия должна быть явным snapshot/проекцией разрешённого автором содержимого.

## Безопасность и транзакции

- Browser использует только Supabase project URL и publishable key (либо legacy `anon` key). Они идентифицируют проект API, но не дают привилегий поверх RLS.
- `service_role`, secret key, database password, access tokens и private keys запрещены во frontend и Git.
- Создание профиля выполняет минимальный trigger на `auth.users`. Его `security definer` функция находится в неэкспонируемой схеме `private`, а execute отозван у `public`, `anon` и `authenticated`.
- Перемещение проекта, полный порядок цикла и архивирование цикла выполняются атомарными `security invoker` RPC.
- Любой будущий sync содержимого требует revision/conflict protocol; текущий `projects.revision` лишь резервирует этот контракт и не означает работающий sync engine.

## Проверка RLS

`supabase/tests/cloud_foundation_rls.sql` создаёт в откатываемой транзакции User A/User B и Project A/Project B, затем проверяет:

- User A видит Project A;
- User A не видит Project B;
- User A может изменить Project A;
- User A не может изменить Project B.

Скрипт предназначен для локальной Supabase database после применения migration.
