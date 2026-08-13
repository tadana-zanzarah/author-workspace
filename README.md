# Рабочее пространство автора

Клиентское браузерное приложение для организации художественного проекта: сцен, глав, персонажей, отношений, локаций, тегов и текста рукописи. Интерфейс и данные приложения работают локально, без регистрации и сервера.

## Возможности

- табличный таймлайн, карточки и компактный список сцен;
- анкеты персонажей и история отношений;
- главы, локации, теги и статусы написания;
- автосохранение, безопасная миграция старых данных и recovery-preview;
- импорт и экспорт проекта в JSON, экспорт текста.

## Локальный запуск

Требуется Node.js. Из корня репозитория запустите:

```powershell
node tools/server.mjs
```

Затем откройте `http://localhost:8000/`. Приложение использует ES-модули, поэтому запуск через HTTP-сервер надёжнее прямого открытия `index.html`.

## Проверки

```powershell
npm test
npm run test:smoke
npm run test:dirty-browser
npm run test:accessibility-browser
```

Browser-тесты используют локально установленный Microsoft Edge и Playwright из рабочего runtime проекта.

## Хранение данных

Сейчас проекты сохраняются в `localStorage` конкретного браузера и адреса сайта. Аккаунты, облачная база, cloud sync и синхронизация между устройствами пока не реализованы. Регулярно используйте «Экспорт JSON» и храните файл отдельно как резервную копию.

Публикация сайта и облачное хранение пользовательских проектов — разные этапы. Статическая публикация делает приложение доступным по URL, но сама по себе не переносит проекты между браузерами или устройствами.

## Структура

- `index.html` — production entry point;
- `css/` — стили интерфейса;
- `js/` — модули приложения, хранения, миграций и UI;
- `tools/` — локальный сервер и автоматические тесты;
- `reference/` — read-only исторические эталоны;
- `backup/` — неприкосновенные внешние резервные копии.

Build step для текущей версии не нужен: корень репозитория можно публиковать как обычный статический сайт.

### Online test version

https://tadana-zanzarah.github.io/author-workspace/

## Supabase: аккаунты и контейнеры проектов

Облачный фундамент хранит в Supabase только аккаунт, профиль и метаданные циклов/проектов. Сцены, персонажи, главы, тексты, локации, теги и отношения пока **не синхронизируются между устройствами** и остаются в localStorage.

Каждый cloud project использует отдельный локальный ключ:

`authorWorkspace:project:<cloud-project-uuid>`

Исторический `novelTimelineV11` сохраняется без автоматического переноса или удаления. Подробная модель описана в [CLOUD_ARCHITECTURE.md](CLOUD_ARCHITECTURE.md).

### Browser configuration без build step

Заполните только два browser-public значения в `js/supabase-config.js`:

```js
export const SUPABASE_CONFIG=Object.freeze({
  url:"https://YOUR_PROJECT_REF.supabase.co",
  publishableKey:"YOUR_PUBLISHABLE_KEY"
});
```

Publishable key (или старый `anon` key) разрешено использовать в публичном browser-коде: безопасность строк обеспечивает RLS, а не сокрытие ключа. Никогда не помещайте в этот файл `service_role` / secret key, database password, personal access token или private key.

Без конфигурации приложение продолжает открывать прежний локальный workspace. Это безопасный fallback для разработки и восстановления данных, но Auth и «Мои проекты» в таком режиме недоступны.

На `localhost` локальный workspace остаётся режимом по умолчанию для recovery и существующих browser-тестов. Для проверки реального Supabase Auth откройте `http://localhost:8000/?cloud=1`. На GitHub Pages облачный экран включается автоматически.

### Supabase schema

Миграция находится в `supabase/migrations/20260812193655_cloud_foundation.sql`. Она создаёт `profiles`, `series`, `projects`, индексы, trigger профиля, RLS policies и атомарные RPC для перемещения/сортировки проектов и безопасного удаления цикла.

После применения migration запустите SQL verification `supabase/tests/cloud_foundation_rls.sql` на локальной Supabase database. Скрипт работает в транзакции и завершает её через `rollback`.

Для email Auth добавьте разрешённые redirect URL:

- local: `http://localhost:8000/`
- GitHub Pages: `https://tadana-zanzarah.github.io/author-workspace/`

Стандартная persistence Supabase Auth хранит session; приложение никогда не сохраняет пароль самостоятельно.

Данные пока хранятся только в `localStorage` текущего браузера. У сайта нет аккаунтов, а данные между устройствами не синхронизируются. Используйте JSON export как резервную копию.
