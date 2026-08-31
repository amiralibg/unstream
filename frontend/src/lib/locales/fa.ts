import type { Messages } from './en'

/** ASCII digits to Persian ones. This is why the UI no longer needs the
 *  typeface's Farsi-digit cut to rewrite every digit on the page: the numbers
 *  Farsi states in its own voice are converted here, and everything else — an
 *  English track title, "MP3", a bitrate — keeps the digits it came with. */
const fd = (value: number | string): string =>
  String(value).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])

/** Farsi — the interface's original and, until this file got a sibling, only
 *  language (docs/DESIGN.md#farsi-only). Typed as `Messages`, so anything `en`
 *  adds fails to compile here until it is translated.
 *
 *  Persian has no plural agreement after a number ("۵ آهنگ", not "۵ آهنگ‌ها"),
 *  so the counting functions ignore `n` beyond printing it — which is exactly
 *  why the plural rule lives in the locale and not in a shared helper. */
const fa: Messages = {
  app: {
    name: 'آنستریم',
    home: 'خانه',
    quote: (text) => `«${text}»`,
    num: fd,
  },

  language: {
    label: 'زبان',
    picker: 'انتخاب زبان',
  },

  settings: {
    label: 'تنظیمات',
    open: 'باز کردن تنظیمات',
    close: 'بستن تنظیمات',
    downloadsFolder: 'پوشه دانلودها',
    downloadsLocation: 'محل ذخیره‌ی دانلودها',
    changeFolder: 'تغییر پوشه',
    openInFinder: 'باز کردن پوشه',
    resetDefault: 'بازنشانی به پیش‌فرض',
    defaultFolderHint: 'پیش‌فرض: ~/Music/Unstream',
    folderSaved: 'پوشه ذخیره‌سازی تغییر کرد',
    appVersion: (v) => `نسخه برنامه ${fd(v)}`,
    ytdlpVersion: (v) => `نسخه yt-dlp ${fd(v)}`,
    serverUrl: 'آدرس سرور',
    serverUrlHint: 'سرور دریافت متادیتا و جستجو',
    saveServer: 'ذخیره',
    resetServer: 'بازنشانی',
    checkUpdates: 'بررسی به‌روزرسانی',
    checkingUpdates: 'در حال بررسی…',
    upToDate: 'برنامه به‌روز است',
    updateAvailable: (v) => `به‌روزرسانی جدید موجود است (${fd(v)})`,
    installUpdate: 'نصب و اجرای مجدد',
    installing: 'در حال نصب…',
    updateFailed: 'به‌روزرسانی ناموفق بود — بعداً دوباره امتحان کنید',
  },

  banner: {
    youtubeDisabled:
      'دانلود از یوتیوب روی این سرور غیرفعال است. برای دانلود نامحدود آهنگ‌ها از برنامه دسکتاپ آنستریم استفاده کنید.',
    getApp: 'دریافت برنامه دسکتاپ',
  },

  meta: {
    title: 'دانلود موزیک، آلبوم و پلی‌لیست از اسپاتیفای و یوتیوب | آنستریم',
    description:
      'لینک اسپاتیفای، یوتیوب، ساندکلاد یا دیزر را وارد کنید یا جستجو کنید و موزیک، آلبوم و پلی‌لیست را به‌صورت فایل MP3 تگ‌خورده با کیفیت ۳۲۰ دانلود کنید — رایگان و بدون اکانت.',
    ogLocale: 'fa_IR',
    // The unsuffixed name: it is the build's default and the one the service
    // worker precaches as part of the app shell.
    manifest: '/manifest.webmanifest',
  },

  quality: {
    label: 'کیفیت',
    group: 'کیفیت صدا',
    original: 'اورجینال',
    hints: {
      '128': 'کم‌حجم‌ترین حالت — برای پادکست یا گوشی‌ای که جاش پره کافیه.',
      '192': 'پیش‌فرض. کیفیت خوب با تقریباً نصف حجم ۳۲۰.',
      '320': 'بهترین حالتی که mp3 داره. همه‌جا هم پخش میشه.',
      original:
        'بدون انکود دوباره — همون m4a یا opus خود آپلود. بهترین صدا، بیشترین حجم، و روی بعضی دستگاه‌های قدیمی پخش نمیشه.',
    },
  },

  hero: {
    titleLine1: 'دانلود موزیک،',
    titleLine2: 'آلبوم و پلی‌لیست',
    blurb:
      'لینک اسپاتیفای، یوتیوب، ساندکلاد، دیزر یا اپل موزیک رو بذار — یا همه‌ی کاتالوگ‌ها رو یکجا جستجو کن. فایل MP3 تگ‌خورده با کاور و کیفیت دلخواهت رو بگیر؛ نه اکانت می‌خواد، نه ثبت‌نام.',
    shortcutBefore: 'برای جستجو',
    shortcutAfter: 'رو بزن، یا هر جای صفحه یه لینک پیست کن.',
  },

  form: {
    placeholder:
      'آهنگ، آلبوم یا آرتیست جستجو کن — یا لینک اسپاتیفای / دیزر / یوتیوب / ساندکلاد رو پیست کن',
    opening: 'در حال باز کردن…',
    searching: 'در حال جستجو…',
    open: 'باز کن',
    search: 'جستجو',
    cancelSearch: 'لغو جستجو',
    cancelOpen: 'لغو باز کردن لینک',
  },

  recent: {
    heading: 'آخرین جستجوها',
    clear: 'پاک کردن آخرین جستجوها',
  },

  nav: {
    back: 'برگشت',
    backToResults: 'برگشت به نتایج',
    backToArtist: 'برگشت به آرتیست',
  },

  shared: {
    badge: 'لینک اشتراکی',
    titleError: 'این لینک اشتراکی باز نشد',
    titleQuery: 'یکی یه جستجو برات فرستاده',
    titleBusy: 'در حال باز کردن چیزی که برات فرستادن…',
    titleDefault: 'این رو یکی برات فرستاده',
    bodyError: 'شاید لینک خراب یا خصوصی باشه، یا از منبعی باشه که آنستریم نمی‌تونه بخونتش.',
    queryBefore: 'نتایج برای',
    queryAfter: '— خودکار از لینکی که دنبال کردی باز شد.',
    bodyDefault:
      'آنستریم این رو خودکار از روی لینکت باز کرد. آهنگ‌هایی که می‌خوای رو انتخاب کن، یا از اول شروع کن.',
    searchElse: 'جستجوی یه چیز دیگه',
  },

  results: {
    resultsFor: 'نتایج برای',
    count: (n, more) => `${fd(n)} نتیجه${more ? ' تا الان' : ''}`,
    filter: 'فیلتر نتایج',
    all: 'همه',
    showAll: (n) => `نمایش همه‌ی ${fd(n)} تا`,
    searchingDeeper: 'در حال جستجوی عمیق‌تر…',
    emptyBefore: 'چیزی برای',
    emptyAfter: 'پیدا نشد',
    emptyHint: 'فقط اسم آرتیست رو امتحان کن، املا رو یه چک بکن، یا به‌جاش لینک آلبوم رو پیست کن.',
    kinds: {
      track: {
        label: 'آهنگ‌ها',
        more: 'آهنگ‌های بیشتر',
        exhausted: (n) => `همین بود — ${fd(n)} آهنگ از همه‌ی منبع‌ها.`,
      },
      artist: {
        label: 'آرتیست‌ها',
        more: 'آرتیست‌های بیشتر',
        exhausted: (n) => `همین بود — ${fd(n)} آرتیست از همه‌ی منبع‌ها.`,
      },
      album: {
        label: 'آلبوم‌ها',
        more: 'آلبوم‌های بیشتر',
        exhausted: (n) => `همین بود — ${fd(n)} آلبوم از همه‌ی منبع‌ها.`,
      },
      playlist: {
        label: 'پلی‌لیست‌ها',
        more: 'پلی‌لیست‌های بیشتر',
        exhausted: (n) => `همین بود — ${fd(n)} پلی‌لیست از همه‌ی منبع‌ها.`,
      },
    },
  },

  collection: {
    kinds: { track: 'آهنگ', album: 'آلبوم', playlist: 'پلی‌لیست' },
    trackCount: (n) => `${fd(n)} آهنگ`,
    duration: (ms) => {
      const minutes = Math.round(ms / 60000)
      if (minutes < 60) return `${fd(minutes)} دقیقه`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest ? `${fd(hours)} ساعت و ${fd(rest)} دقیقه` : `${fd(hours)} ساعت`
    },
    copy: 'کپی لینک اشتراکی این صفحه',
    copyShort: 'کپی لینک اشتراکی',
    copied: 'لینک اشتراکی کپی شد',
    copyFailed: 'کپی لینک انجام نشد',
    clearSelection: 'لغو انتخاب',
    downloadSelected: (n) => `دانلود ${fd(n)} انتخاب‌شده`,
    downloadAll: 'دانلود همه',
    starting: 'در حال شروع…',
    selectedOf: (n, total) => `${fd(n)} از ${fd(total)} انتخاب شده`,
    tickShort: 'با تیک انتخاب کن',
    tickLong: 'هرکدوم رو تیک بزنی فقط همون‌ها دانلود میشن',
    selectAll: 'انتخاب همه',
    clearAll: 'لغو همه',
    finished: (done, total) => `تموم شد — ${fd(done)} از ${fd(total)} دانلود شد`,
    failedCount: (n) => `${fd(n)} تا نشد`,
    queuedAll: (n, name) => `${fd(n)} آهنگ از ${name} رفت تو صف`,
    queuedSome: (n) => `${fd(n)} آهنگ رفت تو صف`,
    queuedOne: (title) => `«${title}» رفت تو صف`,
  },

  stages: {
    queued: 'تو صف',
    searching: 'در حال جستجو…',
    downloading: 'در حال دانلود',
    tagging: 'در حال تگ زدن…',
    retrying: 'تلاش دوباره…',
  },

  track: {
    select: (title) => `انتخاب ${title}`,
    previewStop: 'توقف پیش‌نمایش',
    previewPlay: 'پخش ۳۰ ثانیه پیش‌نمایش',
    previewStopFor: (title) => `توقف پیش‌نمایش ${title}`,
    previewPlayFor: (title) => `پخش ۳۰ ثانیه از ${title}`,
    failed: 'ناموفق',
    startingDownload: 'در حال شروع دانلود…',
    download: 'دانلود این آهنگ',
    downloadFor: (title) => `دانلود ${title}`,
  },

  lyrics: {
    label: 'متن آهنگ',
    dialog: (title) => `متن آهنگ ${title}`,
    open: (title) => `نمایش متن آهنگ ${title}`,
    copy: 'کپی متن آهنگ',
    copied: 'متن آهنگ کپی شد',
    copyFailed: 'کپی متن انجام نشد',
    close: 'بستن متن آهنگ',
    retry: 'دوباره تلاش کن',
    source: 'منبع',
    unavailable: {
      title: 'الان نشد متن رو بگیریم',
      hint: 'سرویس متن آهنگ جواب نداد. چند لحظه دیگه دوباره امتحان کن.',
    },
    absent: {
      title: 'متن این آهنگ پیدا نشد',
      hint: 'یا هنوز توی دیتابیس نیست، یا اسم آهنگ جور دیگه‌ای ثبت شده.',
    },
    // «متن» beside «کیفیت», not the sheet's full «متن آهنگ».
    embed: {
      label: 'متن',
      action: 'ذخیره‌ی متن آهنگ داخل فایل دانلودی',
      on: 'متن آهنگ داخل فایل دانلودی ذخیره میشه',
      off: 'متن آهنگ داخل فایل دانلودی ذخیره نمیشه',
    },
  },

  dock: {
    heading: 'دانلودها',
    close: 'بستن پنل دانلود',
    show: 'نمایش دانلودها',
    activeSummary: (n) => `${fd(n)} در جریان`,
    doneSummary: (n) => `${fd(n)} تمام‌شده`,
    expired: 'فایل‌ها دیگه روی سرور نیستن — دوباره دانلودش کن',
    progress: (done, total) => `${fd(done)} از ${fd(total)} دانلود شد`,
    failedCount: (n) => `${fd(n)} ناموفق`,
    eta: (seconds) => {
      if (seconds < 60) return `حدود ${fd(seconds)} ثانیه مونده`
      const minutes = Math.round(seconds / 60)
      return `حدود ${fd(minutes)} دقیقه مونده`
    },
    originalQuality: 'بدون انکود دوباره دانلود شده',
    encodedQuality: (kbps) => `انکود شده با ${fd(kbps)} kbps`,
    zip: 'دانلود همه به‌صورت ZIP',
    zipLong: 'دانلود همه‌ی آهنگ‌ها به‌صورت ZIP',
    remove: 'حذف از لیست',
    starting: 'در حال شروع…',
    downloadFile: (title, ext) => `دانلود ${title}.${ext}`,
    downloadFileLong: (title, ext) => `دانلود ${title} با فرمت ${ext}`,
    revealInFolder: (title) => `نمایش «${title}» در پوشه`,
    playTrack: (title) => `پخش «${title}»`,
    openFolder: 'باز کردن پوشه دانلودها',
    failed: 'ناموفق',
    deleted: 'پاک شده',
    cancel: 'لغو این دانلود',
    cancelling: 'در حال لغو…',
    cancelled: 'لغو شد',
    cancelledCount: (n) => `${fd(n)} لغو شده`,
    retry: 'تلاش دوباره',
  },

  share: {
    action: (title) => `اشتراک‌گذاری یا ذخیره‌ی ${title}`,
    actionShort: (title) => `اشتراک‌گذاری ${title}`,
    unsupported: 'این مرورگر اشتراک‌گذاری فایل رو پشتیبانی نمی‌کنه',
    failed: 'فایل برای اشتراک‌گذاری آماده نشد',
  },

  quick: {
    done: 'دانلود شده — تو لیستته',
    running: 'در حال دانلود…',
    original: 'دانلود بدون انکود دوباره',
    kbps: (kbps) => `دانلود با ${fd(kbps)} kbps`,
    download: (name) => `دانلود ${name}`,
    queued: (name) => `«${name}» رفت تو صف`,
  },

  artist: {
    badge: 'آرتیست',
    releases: (n) => `${fd(n)} اثر`,
    fans: (n) =>
      n >= 1_000_000
        ? `${fd((n / 1_000_000).toFixed(1))} میلیون فالوور`
        : n >= 1_000
          ? `${fd(Math.round(n / 1_000))} هزار فالوور`
          : `${fd(n)} فالوور`,
    topTracks: 'آهنگ‌های برتر',
    discography: 'دیسکوگرافی',
  },

  notify: {
    ready: (name, n) => `${name} — ${fd(n)} آهنگ آماده‌ی ذخیره‌ست`,
    partial: (name, done, failed) =>
      `${name} — ${fd(done)} آهنگ آماده شد، ${fd(failed)} تا دانلود نشد`,
    failed: (name) => `${name} — دانلود انجام نشد`,
    cancelled: (name, done) =>
      done > 0 ? `${name} — لغو شد، ${fd(done)} آهنگ آماده‌ی ذخیره‌ست` : `${name} — دانلود لغو شد`,
    linkDetected: 'لینک پیدا شد — در حال باز کردن…',
    newVersion: 'نسخه‌ی جدید آنستریم اومده',
    refresh: 'رفرش',
    close: 'بستن اعلان',
  },

  subtitle: (part) =>
    part
      .replace(/^(\d+) releases?$/, (_, n) => `${fd(n)} اثر`)
      .replace(/^(\d+) tracks?$/, (_, n) => `${fd(n)} آهنگ`)
      .replace(/^(\d+) followers?$/, (_, n) => `${fd(n)} فالوور`)
      .replace(/^by (.+)$/, 'از $1')
      .replace(/^Artist$/, 'آرتیست')
      .replace(/^On SoundCloud$/, 'تو ساندکلاد')
      .replace(/^SINGLE$/, 'تک‌آهنگ'),

  errors: {
    tooManySearches: (n) => `یه کم تند رفتی — ${fd(n)} ثانیه صبر کن و دوباره جستجو کن.`,
    tooManyLinks: (n) => `یه کم تند رفتی — ${fd(n)} ثانیه صبر کن و دوباره امتحان کن.`,
    tooManyDownloads: (n) =>
      `برای امروز به سقف دانلود رسیدی — ${fd(n)} ثانیه دیگه دوباره امتحان کن.`,
    downloadsAtOnce: 'همزمان چندتا دانلود در جریانه — صبر کن یکیش تموم شه.',
    tooManyTracks: (n) => `این لیست خیلی بلنده — هر بار حداکثر ${fd(n)} آهنگ.`,
    unsupportedLink:
      'این لینک پشتیبانی نمیشه — لینک اسپاتیفای، دیزر، اپل موزیک، یوتیوب یا ساندکلاد بذار، یا اسمش رو جستجو کن.',
    noTracksSelected: 'هیچ آهنگی برای دانلود انتخاب نشده.',
    nothingFinished: 'هنوز هیچ آهنگی آماده نشده.',
    notReady: 'این فایل هنوز آماده نیست.',
    unknownJob: 'این دانلود دیگه روی سرور نیست.',
    emptyQuery: 'چیزی برای جستجو ننوشتی.',
    badRequest: 'این لینک باز نشد — شاید خصوصی باشه یا منبعش در دسترس نباشه.',
    notFound: 'پیدا نشد.',
    rateLimited: 'یه کم تند رفتی — چند لحظه صبر کن.',
    noAnswer: 'سرور جواب نداد — یه بار دیگه امتحان کن.',
    offline: 'به سرور وصل نشدیم — اینترنتت رو چک کن.',
    unknown: 'یه مشکلی پیش اومد',
  },
}

export default fa
