# Протокол сервер ↔ браузер

Один WebSocket `ws://<host>:<port>/ws`. Текстовые кадры — JSON с полем `t`. Бинарные кадры — состояние мира.
Порядок байт little-endian. Сервер — единственный владелец состояния, браузер только рисует и шлёт команды.

## Сервер → браузер

### `hello` (JSON, при подключении и после загрузки сейва или нового мира)

```json
{"t": "hello", "protocol": 1, "world_id": "…",
 "tank": {"seed": 7, "half_x": 40, "half_z": 25, "depth": 30,
          "floor": {"res": 1.0, "nx": 81, "nz": 51, "origin": [-40, -25]},
          "positives": [ … ], "holes": [ … ], "shelters": [ … ], "passages": [ … ],
          "kelp": [{"c": [x, z], "r": 7}], "light_depth": 12},
 "species": [{"id": "sparkfin", "index": 0, "name": {"ru": "…", "en": "…"}, "mesh": "fish",
              "length": 0.35, "radius": 0.12, "color": [r, g, b], "glow": [r, g, b], "cruise": 2.2, "burst": 6,
              "vision": 12, "fov_deg": 300, "actions": ["forage", …], "target": 28, "cap": 40}, …],
 "intents": ["forage", "school", …],
 "day_s": 1200,
 "plankton": {"nx": 16, "ny": 6, "nz": 10},
 "settings": {"repopulate": {"enabled": true, "delay_s": 300, "mode": "archive"}, "autosave_s": 0,
              "scale": 1.0, "workers": 2, "brain": "nowa"}}
```

Сразу после `hello` приходит бинарный кадр **floor** (тип 3): карта высот дна.

`intents` — общий список имён намерений; `intent` в кадре состояния — индекс в нём.

### Бинарный кадр `state` (тип 1), 20 Гц реального времени

| Смещение | Тип | Поле |
|---|---|---|
| 0 | u8 | тип = 1 |
| 1 | u8 | флаги: bit0 пауза, bit1 турбо |
| 2 | u16 | N — число существ |
| 4 | u32 | seq |
| 8 | f64 | время симуляции, с |
| 16 | f32 | заданная скорость (0 — пауза) |
| 20 | f32 | достигнутая скорость |
| 24 | f32 | фаза суток 0…1 (0 — полночь, 0,25 — рассвет, 0,5 — полдень) |
| 28 | f32 | освещённость 0…1 |
| 32 | u16 | M — число частиц |
| 34 | u16 | id выбранного существа & 0xFFFF (0 — нет) |
| 36 | | N записей существ по 40 байт |
| 36+40N | | M записей частиц по 16 байт |

Запись существа (40 байт):

| Смещение | Тип | Поле |
|---|---|---|
| 0 | u32 | id (уникален в мире, не переиспользуется) |
| 4 | u8 | индекс вида |
| 5 | u8 | индекс намерения |
| 6 | u8 | флаги: bit0 спит, bit1 рывок, bit2 ест, bit3 в укрытии, bit4 выбран |
| 7 | u8 | свечение 0…255 (возбуждение: страх, охота) |
| 8 | f32×3 | позиция |
| 20 | f32×3 | скорость, м/с (ориентация — по скорости) |
| 32 | f32 | масштаб тела (рост: 0,6 у мальков → 1,0) |
| 36 | f32 | энергия 0…1 |

Запись частицы (16 байт): f32×3 позиция, u8 вид (0 — корм, 1 — органика, 2 — останки), u8 размер (×0,01 м),
u16 резерв.

Ориентацию браузер строит из скорости: направление — нормированная скорость. Крен — от изменения курса,
сглаженно на клиенте. Фазу анимации плавания клиент копит сам: `phase += dt * |v| * k_вида`.
Между кадрами клиент интерполирует позиции (буфер на два кадра, задержка около 100 мс).

### Бинарный кадр `plankton` (тип 2), 1 Гц

`u8 тип=2, u8 0, u16 nx, u16 ny, u16 nz`, затем `nx·ny·nz` байт плотности 0…255.
Индекс = `(iy·nz + iz)·nx + ix`. Клетка `ix` покрывает `x ∈ [−half_x + ix·sx, …)`, где `sx = 2·half_x/nx`;
`iy` идёт от дна (`y = −depth`) к поверхности.

### Бинарный кадр `floor` (тип 3), после `hello`

`u8 тип=3, u8 0, u16 nx, u16 nz, u16 0`, затем `nx·nz` значений f32: высота дна `y` в узле
`(origin_x + ix·res, origin_z + iz·res)`, строка — `iz`, индекс = `iz·nx + ix`. Между узлами — билинейная интерполяция.

### JSON-кадры

- `{"t": "stats", "pop": {"sparkfin": 27, …}, "history": [[t, [n0, n1, …]], …], "births": n,
   "deaths": {"eaten": n, "starvation": n, "old_age": n, "removed": n},
   "extinct": {"shade": {"since": t, "respawn_in": s}},
   "brains": {"workers": 2, "brains": n, "pending": n, "p50_ms": …, "p95_ms": …, "sleep_ms_mean": …,
              "decisions": n, "lag_waits": n},
   "speed": {"set": 10 | "turbo", "achieved": 9.4}, "generation_max": {"sparkfin": 5, …},
   "births_species": {"sparkfin": n, …}, "deaths_species": {"sparkfin": {"eaten": n, …}, …},
   "learning": {"sparkfin": [{"gen": 0, "dead": n, "alive": n, "age_days": 1.4, "reward": 0.03,
                              "catch": null, "escape": 0.62, "eaten": 0.4, "decisions": n,
                              "evade": 0.6, "feed": null, "hunt": null}, …], …},
   "settings": {…}, "plankton": 0.4, "particles": n, "time": s, "day": d,
   "resumed_from": "autosave" | null, "error": null | "…"}` — 1 Гц.
  - В `learning` по каждому виду NOWA до 12 последних поколений:
    - `age_days` — средний возраст смерти;
    - `reward` — средняя награда на решение;
    - `catch` — доля удачных бросков;
    - `escape` — доля пережитых встреч с хищником;
    - `eaten` — доля съеденных среди умерших;
    - **качество выбора** — доля решений, где выбор подходил к ситуации:
      - `evade` — хищник рядом, выбрано бегство, укрытие или зарывание;
      - `feed` — голод при видимом корме или добыче, выбрано кормовое действие;
      - `hunt` — добыча рядом, выбраны бросок, погоня или подкрадывание.

      Ориентиры: мозг `reflex` даёт ≈ 1,0, `random` ≈ 0,3.
- `{"t": "inspect", "id": 17, "species": "shade", "generation": 3, "age_days": 1.2, "energy": 0.6,
   "stamina": 0.9, "intent": "chase", "mode": "habitual" | "balanced" | "deliberative" | "inhibitory",
   "tokens": […2–3 токена, которые получает мозг…], "senses": […все 8–9 ощущений…], "sleeping": false,
   "in_cover": false, "decisions": n, "body": {"speed", "vision", "metabolism"}, "pos": [x, y, z],
   "brain": {"affect": {…8 осей…}, "neuromodulators": {…5…}, "uncertainty": 0.1, "mode": "…", "episodes": n,
             "decisions": n, "sleeps": n, "lost_unconsolidated": n, "wakefulness": 0.3, "last_tokens": […],
             "last_action": "…"},
   "genome": {"genes": {"nm_da_ne_weight": -0.2, …}, "generation": 3, …}, "epigenome_size": n,
   "target": 42, "vision": 24, "fov_deg": 200, "parents": [a, b], "children": n, "lifespan_days": 5.4}` —
  1 Гц, пока выбран. `brain`, `genome` — только у видов с мозгом NOWA (при `--brain nowa`).
  - Описание 39 генов (модуль, диапазон, смысл) один раз приходит в `hello.genes`:
    `[{"key", "module", "min", "max", "default", "description"}]`.
- `{"t": "lineage", "id": 17, "nodes": [{"id", "species", "gen", "parents": […], "children": […], "born", "died",
   "cause", "alive"}, …]}` — ответ на команду `lineage`: предки до `up` поколений и потомки до `down`.
- События:
  - `{"t": "event", "kind": "catch", "species": "<охотник>", "prey": "<вид жертвы>", "pos": […]}`;
  - `{"t": "event", "kind": "birth", "species", "id", "pos", "generation"}`;
  - `{"t": "event", "kind": "death", "cause": "eaten"|"starvation"|"old_age"|"removed", "species", "id", "pos"}`;
  - `{"t": "event", "kind": "extinct", "species"}`;
  - `{"t": "event", "kind": "repopulate", "species", "n", "mode": "archive"|"fresh"}`.

  Буфер событий ограничен 200 последними, если никто не подключён.
- `{"t": "saves", "items": [{"slot": "…", "saved_at": "…", "sim_time": …, "size": …, "creatures": …}]}`.
- `{"t": "toast", "level": "info"|"error", "text": {"ru": "…", "en": "…"}}`.

## Браузер → сервер (JSON)

| Команда | Поля |
|---|---|
| `speed` | `value`: 0 (пауза), 1, 2, 5, 10, `"turbo"` |
| `feed` | `pos`: [x, y, z] — горсть корма |
| `spawn` | `species`, `pos` |
| `select` | `id` или `null` |
| `save` | `slot` |
| `load` | `slot` |
| `delete_save` | `slot` |
| `list_saves` | — |
| `settings` | `repopulate`: {`enabled`, `delay_s`, `mode`: `"fresh"` \| `"archive"`}, `autosave_s` |
| `new_world` | `seed` |
| `lineage` | `id`, `up` (по умолчанию 4), `down` (по умолчанию 3) |
| `kill_species` | `species` — только для тестов, при `NOWASEA_DEBUG_COMMANDS=1` |

WebSocket принимает команды только со страницы этого же сервера: при чужом заголовке `Origin` соединение
отклоняется (403). Позиции в `feed` и `spawn` прижимаются к объёму воды, мусорные значения отвергаются.

HTTP: `GET /` — рендер; `GET /api/saves/<slot>.zip` — экспорт сейва; `POST /api/saves/import?slot=<slot>` —
импорт (тело — zip); `GET /api/health`.

## SDF бака

Обе стороны считают одно и то же. Камень = `max(min(positives), −min(holes))`. Твёрдое = `min(камень, дно)`.
Расстояние до дна = `(p.y − h(p.x, p.z)) · 0,7`. Стекло — бокс `|x| ≤ half_x`, `|z| ≤ half_z`, `−depth ≤ y ≤ 0`.

Поворот `yaw` (вокруг оси y): локальные координаты `q = p − c`, `x' = q.x·cos(yaw) + q.z·sin(yaw)`,
`z' = −q.x·sin(yaw) + q.z·cos(yaw)`.

```wgsl
fn sdEllipsoid(q: vec3f, r: vec3f) -> f32 {      // q — локальные координаты
  let k0 = length(q / r); let k1 = length(q / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-9);
}
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
fn sdRoundBox(q: vec3f, h: vec3f, rnd: f32) -> f32 {  // q — локальные координаты
  let d = abs(q) - (h - rnd);
  return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0) - rnd;
}
```

Примитивы: `{"type": "ellipsoid", "c", "r", "yaw"}`, `{"type": "capsule", "a", "b", "r"}`,
`{"type": "box", "c", "h", "yaw", "round"}`. Поле `name` — только подпись.

Визуальный шум на поверхности камня допустим только в рендере и не больше ±0,15 м: коллизии считает сервер.
