# Публикация в Chrome Web Store — тексты и ответы для формы

Архив для загрузки: `npm run pack` → `dist/ytm-timecodes-chrome-<версия>.zip`.

## Вкладка «Store listing»

**Category:** Entertainment (или Tools)

**Language:** добавить English и Русский. Название и краткое описание берутся из манифеста
(`src/_locales`), а подробное описание вводится отдельно для каждого языка.

### Description (English)

```
Love listening to live concerts in YouTube Music? YouTube Music hides the video description and comments, which is exactly where people post the tracklist. This extension brings it back.

• A "Timecodes" button in the player bar shows the name of the song that is playing right now
• A panel with the full tracklist: the current song is highlighted and the list follows playback
• Click a song to jump to its start
• Repeat a single song from a concert with the 🔁 button
• Tracklists are found automatically in video chapters, the description and top comments; the most complete one is picked, others are one click away
• Understands many formats: "0:00 Song", "1. Song - 3:45", "[1:02:03] Song", ranges, several timecodes in one line

Privacy: no data collection, no analytics, no accounts. The extension only reads public video information from YouTube on music.youtube.com.

Not affiliated with YouTube or Google.
```

### Description (Русский)

```
Любите слушать живые концерты в YouTube Music? YouTube Music не показывает описание и комментарии к видео, а ведь именно там обычно оставляют треклист. Это расширение возвращает его.

• Кнопка «Таймкоды» в плеере показывает название песни, которая играет сейчас
• Панель с треклистом: текущая песня подсвечена, список прокручивается за воспроизведением
• Клик по песне перематывает на её начало
• Кнопка 🔁 ставит на повтор одну песню из концерта
• Таймкоды находятся автоматически в главах видео, описании и популярных комментариях; выбирается самый полный список, остальные доступны в один клик
• Понимает разные форматы: «0:00 Песня», «1. Песня - 3:45», «[1:02:03] Песня», диапазоны, несколько таймкодов в одной строке

Конфиденциальность: никакого сбора данных, аналитики и аккаунтов. Расширение только читает публичную информацию о видео с YouTube на music.youtube.com.

Не связано с YouTube или Google.
```

### Graphics

| Поле | Файл |
| --- | --- |
| Store icon 128×128 | `src/icons/icon128.png` |
| Screenshots 1280×800 (1–5 шт.) | сделать самому, см. ниже |
| Small promo tile 440×280 | `store/promo-small-440x280.png` |
| Marquee promo tile 1400×560 (необязательно) | `store/promo-marquee-1400x560.png` |

**Скриншоты:** откройте концерт в music.youtube.com с открытой панелью таймкодов,
сделайте снимок окна и обрежьте/сожмите до **1280×800** (или 640×400), PNG или JPEG.
Хорошо смотрятся 2–3 кадра: панель со списком, трек на повторе, кнопка с названием песни.

## Вкладка «Privacy»

**Single purpose:**

```
Shows a clickable tracklist (song timecodes) for the video playing in YouTube Music, built from the video's chapters, description and top comments.
```

**Permission justification → Host permission (music.youtube.com):**

```
The content script runs only on music.youtube.com to add the timecodes button and panel to the player and to read the public description, chapters and comments of the playing video from YouTube's web API on the same site.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage:** не отмечать ни одного типа данных. Поставить все три галочки-сертификации
(не продаю данные третьим лицам; не использую их не по назначению; не использую для кредитных решений).

**Privacy policy URL:**

```
https://github.com/cybertatar/YouTubeMusicTimecodePlugin/blob/main/PRIVACY.md
```

(ссылка заработает после слияния ветки в `main`)

## Вкладка «Distribution»

- **Payments:** Free
- **Visibility:** Public, или Unlisted, если хотите раздавать только по ссылке
- **Regions:** All regions
