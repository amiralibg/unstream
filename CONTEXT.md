# Unstream

A web app for searching songs, albums and playlists — or pasting a Spotify/Deezer link — and downloading them as tagged MP3 files. The UI ships in Farsi and English, Farsi by default (see `docs/DESIGN.md`); this glossary fixes the canonical Farsi rendering of each domain term so the copy stays consistent.

It stays a Farsi glossary on purpose. English is the language a dictionary is _translated into_ here — `locales/en.ts` is the canonical shape and its wording is its own record — while Farsi is the language the product was written in and the one where two words for the same thing keep suggesting themselves. Terms below are what `locales/fa.ts` must use.

## Language

**آنستریم** (Unstream):
The product's name as written in all user-facing copy.
_Avoid_: Unstream (in UI copy), آن‌استریم

**آهنگ** (Track):
A single downloadable song.
_Avoid_: ترک، قطعه، موزیک — with one exception: «موزیک» is permitted in the hero headline and `<head>` metadata (title, meta description, OG, JSON-LD, manifest), where it carries search intent («دانلود موزیک»). In-app copy — counts, labels, tabs, toasts — always uses آهنگ.

**آلبوم** (Album):
A release-grouped collection of tracks fetched from a source link or search.
_Avoid_: —

**پلی‌لیست** (Playlist):
A curated collection of tracks — one pasted from Spotify/Deezer, or one the
person makes in the app, which can mix songs on disk with songs that stream.
_Avoid_: فهرست پخش، لیست پخش

**صف پخش** (Queue):
What the player plays next, in order. Always the full phrase: a bare «صف»
already means the download queue («رفت تو صف»).
_Avoid_: صف (alone), لیست پخش

**پخش** (Play):
Playing a song in full, from disk or online. «آنلاین» marks a song that
streams rather than plays from a file.
_Avoid_: پلی، استریم (in UI copy)

**پخش خودکار** (Autoplay):
Carrying on with similar songs once the play queue runs out; the songs it
adds are «آهنگ‌های مشابه».
_Avoid_: اتوپلی، پخش اتوماتیک، پیشنهاد خودکار

**تم** / **رنگ** (Theme / Palette):
The light-or-dark mode, and the accent palette it is drawn in («اصلی» or
«آبی»). Modes are «روشن» and «تیره».
_Avoid_: پوسته، قالب، دارک‌مود

**خروجی** / **وارد کردن** (Export / Import):
Saving a playlist to a file for another device or player, and making a
playlist from such a file.
_Avoid_: اکسپورت، ایمپورت، دریافت خروجی

**آرتیست** (Artist):
The performer a track or album belongs to; also a browsable view of their releases.
_Avoid_: هنرمند، خواننده

**دانلود** (Download):
Fetching a track as a tagged MP3 file; also the queue item tracking that job.
_Avoid_: بارگیری، دریافت

**جستجو** (Search):
Finding tracks, albums, artists or playlists by free text.
_Avoid_: سرچ، پیدا کردن

**لغو** (Cancel):
Stopping a download that is already running, or a search still being waited on.
One word for both, even though only the download is really called off — what
the person means is the same in each case.
_Avoid_: کنسل، توقف، متوقف کردن

**کیفیت** (Audio quality):
The bitrate chosen for a download.
_Avoid_: کوالیتی

**لینک** (Link):
A pasted Spotify or Deezer URL that resolves to a track or collection.
_Avoid_: پیوند، آدرس

**دانلود همه** (Download all):
Downloading every track in an album or playlist in one action, which yields a ZIP.
_Avoid_: دانلود کامل

**متن آهنگ** (Lyrics):
The words of a song, shown in the app and embedded into downloaded files.
_Avoid_: لیریک، شعر، کلمه‌های آهنگ
