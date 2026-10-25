# Phase 0 --- דוח Discovery

> תאריך: 2026-10-24 · מבוסס על `Project Spec.md` גרסה 2.
> **סטטוס: אושר (2026-10-25).** כל ההחלטות שסומנו **[לאישור]** אושרו ונרשמו
> ביומן ההחלטות בספק (סעיף 17). Phase 1 יתחיל רק כשהמשתמש יורה על כך.

## 1. סיכום

-   הספק (גרסה 2, ייצוא חד-כיווני) ישים עם הסטאק שנבחר. אין חסם טכני.
-   **שני ממצאים משנים החלטות קודמות:**
    1.  **GitHub Actions כל 15 דקות חורג מהמכסה החינמית** בריפו פרטי (פירוט
        בסעיף 4.2). מוצע: כל 30 דקות.
    2.  **הרשאת `calendar.app.created` לא מסווגת בבירור בתיעוד**, ויש דיווח
        שהיא לא מופיעה בבורר ההרשאות של Google Cloud Console. היא כן מורשית
        רשמית ליצירת אירועים. מוצע לבדוק אותה בניסוי קטן כבר ב-Phase 1, לפני
        שבונים עליה (סעיף 3.2).
-   ספריות: הוחלפו שתי בחירות מובנות מאליהן. ספריית החזרתיות `rrule` לא
    עודכנה מאז 2023, ו-Prisma מסומנת ב-npm כגרסת RC (סעיף 5).

## 2. מצב הפרויקט

-   הריפו מכיל רק `Project Spec.md`, `.gitignore`, `.env.example` ואת הדוח
    הזה. אין קוד קיים, ולכן אין אילוצי תאימות.
-   סביבת הפיתוח: Node.js 24.12, npm 11.7, Docker 28 + Compose v2, Windows 11.
-   ריפו מרוחק: `github.com/dorhaboosha/our-calendar` (פרטי).

## 3. Google Calendar API ו-OAuth

### 3.1 ממצאים מאומתים (תיעוד רשמי)

| נושא | ממצא | השלכה |
|---|---|---|
| מצב "Testing" | בפרויקט External במצב Testing, refresh token פג אחרי **7 ימים**, אלא אם ההרשאות הן רק name/email/profile. | חובה להעביר את האפליקציה ל-**In production**. ההתחברות לאפליקציה (זהות בלבד) לא מושפעת. |
| אפליקציה לא מאומתת | עם הרשאות רגישות מוצג מסך "Google hasn't verified this app", ויש תקרה של 100 משתמשים חדשים לכל חיי הפרויקט. | לשני משתמשים זה מקובל: לוחצים Advanced ← Continue פעם אחת. לא צריך תהליך אימות. |
| תקרת refresh tokens | 100 tokens לכל חשבון Google לכל OAuth client. token חדש מעבר לתקרה מבטל את הישן בלי אזהרה. | לבקש `access_type=offline` **רק** בחיבור הייצוא, לא בכל התחברות. |
| הרשאת `calendar.app.created` | "Make secondary Google calendars, and see, create, change, and delete events on them". מופיעה ברשימת ההרשאות המורשות של `events.insert`. | מתאימה בדיוק לצורך. |
| מזהה אירוע שנבחר על ידי הלקוח | תווי base32hex (`a-v`, `0-9`), אורך 5--1024, ייחודי לכל יומן. Google **לא מבטיח** לזהות התנגשות מזהה ברגע היצירה. | מזהה = UUID מקומי בלי מקפים (32 תווי hex הם תת-קבוצה של base32hex). |

### 3.2 סיכון: `calendar.app.created`

-   התיעוד לא מציין אם ההרשאה רגישה. בפורום של Google יש דיווח שהיא לא מופיעה
    בבורר ה-Data Access ב-Console.
-   גם אם היא לא מופיעה בבורר, אפשר לבקש אותה בקוד. התוצאה הצפויה היא מסך
    "unverified app", שממילא נקבל.
-   **חלופה אם היא לא עובדת:** `calendar.calendars` (יצירת יומנים משניים) +
    `calendar.events.owned` (אירועים ביומנים בבעלות המשתמש). זה עובד, אבל
    רחב יותר: גישה גם ליומן הראשי.
-   **[לאישור] מוצע:** ניסוי Google קטן (spike) בסוף Phase 1. מתחברים עם
    ההרשאה, יוצרים יומן, יוצרים אירוע עם מזהה קבוע, מוחקים ויוצרים מחדש
    באותו מזהה, ויוצרים אירוע חוזר עם חריגה. התוצאות יתועדו לפני Phase 4.

### 3.3 אסטרטגיית ייצוא (מתוכננת)

-   **Upsert:** `events.update` (החלפה מלאה, כי היומן שלנו). תשובה 404 ←
    `events.insert` עם המזהה הקבוע. תשובה 409 ב-insert (קיים אירוע מבוטל עם
    אותו מזהה) ← `update` עם `status: confirmed`. כך מתבצע גם שחזור של
    אירוע שנמחק ידנית. **לאמת ב-spike.**
-   **מחיקה:** `events.delete`. תשובות 404/410 נחשבות הצלחה (idempotent).
-   **יום שלם:** `start.date` = תאריך התחלה. `end.date` = תאריך הסיום
    שבממשק + יום אחד (בלעדי).
-   **מתוזמן:** `dateTime` + `timeZone: Asia/Jerusalem`.
-   **חזרתיות:** הסדרה נשלחת כאירוע אחד עם `recurrence: ["RRULE:..."]`.
    חריגה נשלחת כעדכון או ביטול של המופע לפי מזהה המופע של Google
    (`{eventId}_{originalStart}`). **לאמת ב-spike.**
-   **בעלות:** קידומת `דור: ` / `מעיין: ` בכותרת, `colorId` לפי בעלים,
    ומטא-דאטה ב-`extendedProperties.private`.
-   **מגבלות קצב:** תשובות 403 `rateLimitExceeded` ו-429 ← backoff אקספוננציאלי.
    תשובות 401 / `invalid_grant` ← החיבור מסומן `NEEDS_REAUTH` בלי ניסיונות
    חוזרים.

## 4. אירוח

### 4.1 Render (מסלול חינמי) ו-Neon

-   השירות "נרדם" אחרי **15 דקות** בלי תעבורה נכנסת, וההתעוררות לוקחת
    **כדקה**.
-   יש **750 שעות** חינם לחודש לכל workspace. Background Workers ו-Cron Jobs
    **לא** זמינים במסלול החינמי. שינויים במערכת הקבצים נמחקים בכל הפעלה מחדש.
-   השרת ב-Render הוא תהליך Node רגיל ולא serverless. לכן אפשר להמשיך עבודה
    אחרי שהתשובה נשלחה (`after()` של Next.js), וחיבור TCP רגיל ל-Postgres
    עובד.
-   Neon: connection string מאוגם (pooled) להרצה, וישיר למיגרציות.

### 4.2 GitHub Actions כטריגר --- תיקון להחלטה

-   מרווח מינימלי: 5 דקות. ריצות מתוזמנות יכולות להתעכב בשעות עומס.
-   **ריפו פרטי:** 2,000 דקות חינם לחודש, וכל job מעוגל **למעלה לדקה שלמה**.
-   כל 15 דקות: 96 ריצות ביום × 31 ימים ≈ **2,976 דקות**. זה **חורג**
    מהמכסה, ו-GitHub פשוט יעצור את הריצות (מגבלת הוצאה ברירת מחדל: $0).
-   **[לאישור] מוצע: כל 30 דקות** ≈ 1,488 דקות לחודש, בתוך המכסה. ייצוא שנכשל
    יושלם תוך חצי שעה לכל היותר (או מיד כשמישהו פותח את האפליקציה).
-   חלופה: cron-job.org (חינמי, כל 5 דקות) במקום GitHub Actions.

## 5. ספריות

גרסאות נבדקו ב-npm ב-2026-10-24.

| תחום | בחירה | גרסה | הערות |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.4 | 16.x היא גרסת Active LTS. |
| UI | Chakra UI | 3.37 | RTL באמצעות `dir="rtl"` על `<html>` ו-`LocaleProvider`. אין צורך ב-stylis כמו ב-v2. |
| לוח שנה | FullCalendar + `@fullcalendar/react` | 7.1 | daygrid, timegrid, list ו-interaction ב-**MIT** (חינם). רק תצוגות timeline/resource בתשלום, ואנחנו לא צריכים אותן. `direction: 'rtl'` צריך להגדיר במפורש (לא נגזר מה-locale). |
| התחברות | **Better Auth** | 1.7 | Auth.js מתוחזק כיום על ידי צוות Better Auth, וההמלצה לפרויקטים חדשים היא Better Auth. Google provider + בדיקת allowlist ביצירת משתמש. |
| חיבור ייצוא | זרימת OAuth ייעודית עם `google-auth-library` | --- | **[לאישור]** נפרד מ-Better Auth, כדי שה-refresh token של היומן יוצפן ויישמר רק אצלנו, וההתחברות לאפליקציה תישאר עם הרשאות זהות בלבד. |
| ORM | Prisma | **7.10** (יציבה) | **[לאישור]** תג `latest` ב-npm מצביע כרגע על `8.0.0-rc.27`. נקבע גרסה 7 יציבה. Prisma 7 דורשת driver adapter: `@prisma/adapter-pg` עובד גם מקומית וגם מול Neon (חיבור TCP). |
| שפה | next-intl, בלי i18n routing | 4.14 | `messages/he.json`, locale קבוע מקובץ התצורה. |
| תאריכים | date-fns + `@date-fns/tz` | 4.4 / 1.5 | Temporal עדיין לא זמין ב-Node 24 בלי polyfill. |
| חזרתיות | **rrule-temporal** (מועמדת) | 2.2 | **[לאישור]** ספריית `rrule` המוכרת לא עודכנה מאז 11/2023 ויש לה בעיות ידועות עם אזורי זמן. ההחלטה הסופית תתקבל בתחילת Phase 3 על סמך בדיקות שעון קיץ. |
| הצגת חזרתיות | פריסה בצד השרת | --- | **[לאישור]** השרת פורס מופעים לטווח המבוקש ושולח ל-FullCalendar אירועים רגילים. אין צורך בתוסף rrule של FullCalendar, ויש מקור אמת אחד לחריגות. |
| Google API | `@googleapis/calendar` | 20.1 | חבילה ממוקדת, קטנה בהרבה מ-`googleapis`. |
| ולידציה | zod | 4.6 | משותפת לטופס ול-API. |
| בדיקות | Vitest + Playwright | 5.0 / 1.64 | Vitest ליחידה ואינטגרציה (מול Postgres ב-Docker). Playwright ל-E2E. |
| הצפנה | `node:crypto` AES-256-GCM | --- | בלי תלות חיצונית. המפתח ב-`TOKEN_ENCRYPTION_KEY`. |

## 6. ארכיטקטורה

### 6.1 מבנה (Modular Monolith)

```
src/
  app/                  Next.js routes (UI + API route handlers)
  modules/
    auth/               Better Auth config, allowlist, session helpers
    events/             domain: validation, CRUD, recurrence expansion
    google-export/      OAuth connect, token crypto, Google client, export logic
    jobs/               outbox: enqueue, claim, retry/backoff, runner endpoint
    users/              config users ↔ DB users, color settings
  config/app.config.ts  locale, direction, timezone, users, categories
  messages/he.json
prisma/schema.prisma
```

כלל: מודולים מתקשרים רק דרך הפונקציות שהם מייצאים. `events` לא מכיר את
Google; הוא רק כותב עבודות ל-outbox.

### 6.2 תור הייצוא (outbox)

-   שמירת אירוע ויצירת `ExportJob` לכל יעד פעיל מתבצעות **באותה טרנזקציה**.
    אם השמירה הצליחה, העבודה קיימת.
-   העבודה לא נושאת payload. היא קוראת את המצב **העדכני** של האירוע בזמן
    הריצה, ולכן כמה עריכות רצופות מתאחדות לייצוא אחד. עבודה ממתינה
    שכבר קיימת לאותו (יעד, אירוע) לא משוכפלת (אינדקס ייחודי חלקי).
-   תפיסת עבודות: `SELECT ... FOR UPDATE SKIP LOCKED`, כדי שבקשה רגילה
    וטריגר תקופתי לא יריצו את אותה עבודה פעמיים.
-   **הרצה:** (1) `after()` מיד אחרי השמירה. (2) כל בקשה לאפליקציה מעבדת
    ברקע עבודות שהגיע זמנן. (3) `POST /api/jobs/run` עם `CRON_SECRET`
    מ-GitHub Actions.
-   **Backoff:** 1 דקה, 5 דקות, 15 דקות, שעה, 6 שעות. אחרי 8 ניסיונות העבודה
    מסומנת "נדרשת פעולה" ומוצגת בממשק עם כפתור "נסה שוב".
-   `exportedVersion` במיפוי מאפשר לדלג על עבודה שכבר יוצאה.

## 7. מודל נתונים --- עדכונים מוצעים לספק

-   **טבלאות Better Auth:** `user`, `session`, `account`, `verification`. טבלת
    `User` של הספק תמוזג לטבלת `user` של Better Auth (עם `configKey`,
    `color`).
-   **[לאישור] חזרתיות על `Event`:** עמודת `rrule` (nullable) ישירות על
    האירוע, במקום טבלת `RecurrenceRule` נפרדת. לכל סדרה יש כלל אחד, אז טבלה
    נפרדת לא מוסיפה כלום. "מופע זה והבאים" יוצר `Event` חדש עם
    `splitFromEventId`.
-   **קטגוריה:** מפתח טקסט (`work`, `vacation`, ...) שנבדק מול קובץ התצורה.
    אין טבלת קטגוריות.
-   **אילוץ CHECK:** אם `isAllDay`, אז `startDate`/`endDate` מלאים
    ו-`startAt`/`endAt` ריקים, ולהפך.
-   **`EventException`:** מפתח ייחודי (`eventId`, `originalStart`).
-   **`ExportJob`:** אינדקס ייחודי חלקי על (`exportTargetId`, `eventId`) כאשר
    `status = PENDING`.

## 8. סיכונים

| סיכון | חומרה | מיתון |
|---|---|---|
| `calendar.app.created` לא עובדת כמצופה | בינונית | spike בסוף Phase 1; חלופת הרשאות מוכנה (3.2). |
| שחזור אירוע שנמחק באותו מזהה, ומזהי מופעים של חריגות | בינונית | spike; אם נכשל, ממפים מזהה חדש לגרסה (`{uuid}v{n}`). |
| חזרתיות + שעון קיץ | בינונית | בדיקות יחידה ייעודיות לתאריכי המעבר בישראל לפני כל חיבור ל-UI. |
| התעוררות איטית ב-Render החינמי | נמוכה | ידוע ומקובל; מעבר למסלול בתשלום לא דורש שינוי קוד. |
| GitHub מעכב או עוצר ריצות מתוזמנות | נמוכה | ניסיון חוזר גם בכל שימוש באפליקציה; חלופת cron-job.org. |
| Prisma 8 יוצאת כיציבה בזמן הפיתוח | נמוכה | נשארים על 7 עד סוף הפרויקט, ומשדרגים בנפרד. |

## 9. תוכנית שלבים

כל שלב מסתיים בבדיקות ירוקות, commit, ועצירה לאישור.

**Phase 1 --- Foundation**
1.  אתחול Next.js + TypeScript (strict) + ESLint/Prettier + Chakra (RTL) +
    next-intl + `app.config.ts` + `messages/he.json`.
2.  Docker Compose ל-Postgres מקומי; Prisma 7 + adapter-pg; מיגרציה
    ראשונה (משתמשים + טבלאות Better Auth).
3.  Better Auth עם Google; allowlist מ-`USER_EMAIL_*`; שיוך ל-`configKey`;
    דחיית כל אימייל אחר; middleware שמגן על כל הדפים וה-API.
4.  מסך הגדרות: בחירת צבע לכל משתמש.
5.  Vitest + Playwright מוגדרים; CI ב-GitHub Actions (lint, typecheck,
    בדיקות).
6.  פריסה ראשונה ל-Render + Neon.
7.  **Google spike** (סעיף 3.2), עם תיעוד תוצאות.

**Phase 2 --- Calendar Core:** מודל `Event` + אילוצים; API לפי טווח; טופס
עם "יום שלם" וולידציה; FullCalendar יום/שבוע/חודש ב-RTL; צבעים, סינון לפי
בעלים וקטגוריה; בדיקות קצה של חצות ושעון קיץ.

**Phase 3 --- Recurrence:** בחירה סופית של ספריית החזרתיות; פריסה בצד
השרת; חריגות; API עם `scope` (`THIS` / `THIS_AND_FOLLOWING` / `ALL`) ופיצול
סדרות; בדיקות שעון קיץ.

**Phase 4 --- Google Export:** זרימת חיבור + הסבר פרטיות; הצפנת token;
יצירת יומן "Our Calendar"; outbox + runner + backoff; upsert/delete;
חזרתיות וחריגות; "ייצא מחדש"; מצב ייצוא בממשק; ניתוק עם בחירה למחוק את
היומן; workflow מתוזמן ב-GitHub Actions.

**Phase 5 --- Hardening:** מעבר על 17 בדיקות הקבלה; rate limiting; בדיקת
לוגים ללא סודות; גיבויים ב-Neon (point-in-time restore); README והוראות
התקנה.

## 10. החלטות לאישור

1.  **טריגר תקופתי:** GitHub Actions כל **30** דקות, במקום 15.
2.  **Google spike** בסוף Phase 1, לפני שבונים על `calendar.app.created`.
3.  **Better Auth** להתחברות, וזרימת OAuth **נפרדת** לחיבור הייצוא.
4.  **Prisma 7** יציבה, לא 8 RC.
5.  **rrule-temporal** כמועמדת לחזרתיות, עם החלטה סופית בתחילת Phase 3.
6.  **פריסת מופעים בצד השרת** במקום תוסף rrule של FullCalendar.
7.  **`rrule` כעמודה על `Event`** במקום טבלת `RecurrenceRule`.

## מקורות

-   [Google Calendar API --- scopes](https://developers.google.com/workspace/calendar/api/auth)
-   [Events: insert (מזהה אירוע, הרשאות)](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
-   [Using OAuth 2.0 (תפוגת refresh token, תקרות)](https://developers.google.com/identity/protocols/oauth2)
-   [Unverified apps](https://support.google.com/cloud/answer/7454865)
-   [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
-   [Render free instances](https://render.com/docs/free)
-   [GitHub Actions --- schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
-   [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
-   [FullCalendar license](https://fullcalendar.io/license) · [plugin index](https://fullcalendar.io/docs/plugin-index) · [direction](https://fullcalendar.io/docs/direction)
-   [Chakra UI v3 RTL](https://chakra-ui.com/docs/features/rtl-support)
-   [next-intl without i18n routing](https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing)
-   [Prisma + Neon](https://www.prisma.io/docs/orm/overview/databases/neon)
