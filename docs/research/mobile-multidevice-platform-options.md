# Mobile browser platforms and offline durability: TimeTrace options

Research date: **2026-11-26**. Source baseline: **`bfacc9d`**.
Research for [Research mobile browser platform and offline durability limits (#76)](https://github.com/sinsenti/TimeTrace/issues/76),
under [Wayfinding: TimeTrace on desktop web, iPhone, and Android (#74)](https://github.com/sinsenti/TimeTrace/issues/74).
This extends the platform comparison below; it is not an implementation specification or stack selection.

## Settled context

The parent map sets these inputs; they are not unanswered platform questions:

- **Desktop web and mobile browsers on iPhone and Android are mandatory.** Native packages can
  supplement, never replace, mobile browser access. Preserve desktop capabilities with appropriate
  phone interactions, without requiring drag gestures.
- **One owner, multiple devices, one separately hosted service.** Online access must work with the
  laptop off; neither phone nor laptop needs to run a local daemon. Hosting/provider selection is
  separate in [Plan a hosted deployment of TimeTrace (#73)](https://github.com/sinsenti/TimeTrace/issues/73).
  Do not expose the current local daemon publicly.
- **Minimum offline scope includes timer Start/Stop and saving work for synchronization on reconnect.**
  Preserve captured work, surface conflicts, and never silently discard or double-count it. The
  platform limits below bound what can honestly be promised; they do not reduce that requirement
  to an online-only product or require installation as a substitute for browser support.
- Private staged previews are acceptable; full release requires agreed feature parity. After full
  release, native shortcuts, widgets, lock-screen controls and native-only reminder enhancements
  are optional follow-ups, not launch prerequisites. Existing features still belong in parity review.
- Client choice does not select Python versus TypeScript on the server. Multi-user features and
  external integrations remain outside this map. Recorded intervals, scheduled sessions, recurrence,
  corrections and accounting retain their existing distinctions [R9].

## Executive findings

1. **Mobile web is the required baseline, not merely an interim UI.** Responsive web/PWA, Capacitor
   with web, and Expo with a deliberate web path can all serve it. Installation, offline storage,
   background delivery, and lock-screen UI are separate capabilities; installing a website does not
   grant native timer privileges or guarantee retention of unsynchronized work [W1], [W2], [W3], [W5].
2. **A correct elapsed timer does not need JavaScript executing every second.** Persist interval
   boundaries/pause state and derive the display from timestamps. That does not schedule an alert,
   perform a background state transition, or keep another device's controls current. TimeTrace already
   distinguishes recording, independent focus timing, and notification delivery [R3], [R4], [R5].
3. **“On the lock screen” has at least three meanings:** a delivered notification; a continuously
   updating timer surface; and an alarm with OS-managed controls/interruption behavior. Web Push
   can supply the first on supported devices. iOS ActivityKit/WidgetKit and Android notification
   chronometers supply native timer surfaces; **iOS/iPadOS 26 AlarmKit** adds a materially different,
   authorized alarm/countdown capability [W1], [A3], [A4], [A5], [A6], [D4], [D6]. These are not interchangeable.
4. **Capacitor and React Native/Expo are both credible mobile routes, for different product merits.**
   Capacitor retains browser/DOM UI and adds native bridges. React Native offers native mobile UI
   with a React-based web path, not automatic reuse of an arbitrary DOM application. Current Expo
   docs include **`expo-widgets` Live Activities**: “all Live Activities require handwritten Swift”
   would now be an inaccurate blanket claim [C1], [E1], [E6].
5. **Tauri deserves separate desktop and mobile evaluations.** Linux desktop integration is a
   strong reason to consider it; mobile support exists, but matching a mobile timer's OS features
   depends on plugins/native integration, not the shared window shell. Flutter is also material if
   first-class Linux plus mobile delivery from one UI toolkit becomes important [T1], [T2], [T3], [T4], [T5], [T6], [T7], [F1], [F2].
6. **The client decision does not decide Python versus TypeScript on the server.** All candidates
   can use an HTTP API. Shared TypeScript may improve client/server development and portable pure
   logic; FastAPI can expose language-neutral OpenAPI contracts. Neither language provides device
   synchronization, background guarantees, or an offline conflict policy [B1], [B3]; analysis below.
7. **Offline capture is not background execution, and replay is not recovery.** Durable local
   Start/Stop anchors can reconstruct work after suspension without running JS continuously. But a
   browser may discard pages without a final callback, deny persistence, or lose unsynchronized data
   to eviction or clearing. A lost server acknowledgement needs receipt lookup, not a new Start/Stop.
   Current receipts protect accepted server operations, not yet an offline recording protocol
   [W2], [W5], [W14], [W16], [R3], [R7]. Sections 6–8 define the limits and unrun proof checks.

## Evidence and limits

- **Documented facts** below cite platform-owner documentation, standards, official project source,
  or current repository files. **Assessment** and **implication** label research conclusions, not
  owner decisions. **Unverified** means no device/runtime demonstration was performed.
- References ending in `latest` or pointing to a project's `main` branch are access-date snapshots,
  not pinned SDK guarantees. Browser policies and framework support must be rechecked against the
  eventual minimum supported OS/browser and release build versions.
- Some general guides retain stale subsections. For example, web.dev's installation chapter says
  iOS lacks badging and macOS Safari cannot install apps; Apple's newer documentation contradicts
  those statements. This note uses WebKit for Apple capabilities and the newer Mozilla install
  guide rather than repeating those older claims [W1], [W2], [W3], [W12].
- **Documentation and source inspection only.** No application or physical-device tests were run.
  Every proposed check in section 8 is **UNRUN**. Documentation establishes API policy, not observed
  retention, recovery, timing, battery use, or accessibility on a particular phone.

## 1. Current TimeTrace, not the old client roadmap

| Observation at this baseline | Evidence and consequence |
| --- | --- |
| The runtime is the root FastAPI daemon, serving Jinja2 web pages and JSON APIs; browser code is plain JS using the shared API client. | `create_daemon_app`, router registration and `ApiClient.request` [R1], [R2]. A responsive web redesign does not inherently require React or a backend rewrite. |
| Default host is `127.0.0.1:8002`; SQLite and timer state are local to the daemon. | Settings [R6], `MultipleTimerService` and `TimerStore` [R3]. A phone's `localhost` is the phone, not the Linux computer. A packaged client is not itself a network access solution. |
| Current multi-timer writes already have revisions, operation receipts, serialization, and DB/file reconciliation. | `MultipleTimerService.mutate`, `operation`, `TimerStore.locked` [R3]. Do not describe this as the historical single in-memory counter, or mistake local crash recovery for a distributed sync protocol. |
| Focus timing and bounded notifications already exist independently of an open browser. | Root lifespan starts `FocusRuntime`; `FocusEvaluator` uses wall, monotonic and suspend-inclusive clocks [R1], [R4]. Historical claims that all native notifications await a wrapper are outdated. |
| Existing native delivery is **Linux interactive session-bus submission**, with explicit unavailable/fallback states. | `LinuxNotifications` and the #63 maintenance record [R5]. Not phone push, tray installation, generic reminders, or proof that a human saw a notification. Sleep/stopped daemon has no exact-time promise. |
| Browser preferences/pins and uncertain-operation journals are not an offline domain replica. | Current `api_client.js`, `multiple_timers.js`, `workspace_pins.js` [R2], [R7]. A bounded search of application source found no service-worker registration, web app manifest wiring, IndexedDB store, or PushManager integration. This is source inspection, not a browser-cache audit. |
| The inspected root app configures a narrow CORS list; no general authentication layer was identified in the inspected app/router wiring. | Root app and API router registration [R1]. This is not a complete security audit. **Do not expose the current daemon to the Internet merely by changing its bind address.** CORS is not user authentication. |
| Host OS inactivity is currently sampled by the daemon. | `idle_checker_loop` and timer idle handling [R1], [R8]. A headless server's inactivity or an idle desktop cannot establish whether someone is working on a phone. Moving the host requires an explicit inactivity policy, not silently retaining desktop assumptions. |

The [old roadmap][R0] names React Native/Expo mobile and Tauri desktop, including unmeasured
RAM figures and a suggested wrap-first order. Those are historical direction, **not comparative
benchmarks or a new approval**. Its Postgres/PowerSync/Redis external-integration sketch does not
establish that those components are needed for shared-host access, nor authorize their adoption.
The current timer source supersedes its older single-timer description. Existing recorded-work,
plan, overlap-accounting, recurrence, and approval boundaries remain constraints [R0], [R9].

## 2. Keep four decisions separate

| Decision | Candidate choices | What it does **not** decide |
| --- | --- | --- |
| Client presentation/runtime | Responsive browser/PWA; DOM UI in Capacitor; React Native/Expo plus web; Tauri; Flutter; platform-native UI | Server language, source of truth, or offline merge semantics |
| Backend implementation | Retain Python/FastAPI; adopt TypeScript server; deliberately split specific components | Whether phones get native background privileges or who owns a running timer |
| Data authority/connectivity | Separately hosted online authority plus offline local capture; read caches/outbox/replication strategy still to specify | Whether a notification can fire on a disconnected phone |
| Time and delivery | Persisted timer state; OS-rendered display; local scheduled notification/alarm; remote push; daemon evaluator | Whether an alert is seen, or whether another offline device has received a Pause/Stop |

**Assessment:** Compare complete product combinations, not isolated logos. Both “Expo + FastAPI”
and “Capacitor + TypeScript” still need a separately hosted authority and a browser-capable offline
protocol. Replication or outbox design does not follow automatically from the client framework.

### Timer correctness versus OS execution

For an uncomplicated running interval, a display can be derived as
`elapsed = accumulated_closed_intervals + (reference_now - running_start)`.
Paused intervals do not accrue. This is an illustrative model, **not** a replacement for TimeTrace's
existing interval, correction, focus, idle, or receipt rules [R3], [R4], [R9].

- The UI can redraw after suspension without counting missed `setInterval` ticks. Browser timers
  can be throttled or pages unloaded; a service worker may be terminated when idle [W5], [W6].
- Reconstructing elapsed time after resume is **not** performing a break transition at its deadline.
  Current focus logic deliberately requires clock-continuity evidence for automatic transitions;
  restart/suspend catch-up is not retroactive authorization [R4].
- A local OS notification/alarm can be scheduled in advance, without keeping the UI running. Its
  cancellation or rescheduling must follow accepted Pause/Stop/change operations [A1], [A5], [D1].
- A lock-screen countdown can be rendered by the OS from dates rather than by running app JS every
  second. WidgetKit dynamic dates and Android chronometers explicitly support this [A6], [D6].
- Cross-device timestamps need a chosen authority and uncertainty treatment. Local monotonic clocks
  are useful within an execution epoch but do not establish a common clock across devices or
  reboots. UTC dates alone do not resolve clock changes; the current focus implementation already
  illustrates why those cases matter [R4]. No new clock contract is selected here.

## 3. Platform realities

### Browser and PWA

**Installation is not offline capability.** A manifest describes identity/presentation; service
workers/cache and local data storage supply offline behavior. An installed app can still show
nothing useful when its server is unreachable [W3], [W8], [W9].

| Platform | Documented capabilities | Constraints for TimeTrace |
| --- | --- | --- |
| iPhone/iPad browser tab | Ordinary responsive web access. On iOS/iPadOS 16.4+, a **Home Screen web app** can request Web Push permission following direct user interaction [W1]. | Do not promise that an ordinary tab has the installed app's push entitlement/flow. A normal web notification is not an ActivityKit timer or AlarmKit alarm. |
| iPhone/iPad Home Screen web app | Push notifications can appear on the Lock Screen, Notification Center and paired Apple Watch; Focus and badging are supported. Web Push does not require Apple Developer Program membership [W1]. | Permission, installation and a push subscription/sender are needed. Push relies on connectivity and vendor delivery; it is not an offline scheduled alarm. No native Live Activity/AlarmKit bridge was identified in the reviewed web APIs. |
| Newer Apple installation behavior | WebKit's Safari 26 announcement changes Add to Home Screen to open **any site as a web app by default**, with an “Open as Web App” toggle. A manifest remains useful metadata [W12]. | Do not make the old claim that only a manifest/Apple meta tag can produce standalone behavior on every current iPhone. Minimum OS and exact device flow remain to be verified. |
| Android browsers | Chrome with GMS and Samsung Internet on Samsung devices can install WebAPKs; other combinations may create browser-badged shortcuts. Manifest-based install promotion and browser-specific UI vary [W3], [W9]. | Home-screen presence does not prove identical install, OS integration, push, or background behavior on non-GMS/OEM browsers. Validate the selected browser/device matrix. |
| Linux browsers | Chromium browsers support desktop PWA installation. Mozilla's guide does not claim Firefox manifest-based installation [W3], [W9]. | Browser use remains possible without installation. Do not assume an installed Chromium app is available in every Linux browser or that browser-closed/sleep delivery is guaranteed. |

**Background work:** Service workers are event-driven, not always-running daemons [W5]. Background
Sync is marked limited availability; browser-controlled retry is neither an exact-time scheduler
nor an interoperable promise on all target browsers. Workbox falls back to retrying when the service
worker starts where native Background Sync is absent [W4], [W10]. Generic request replay is especially
unsafe for TimeTrace operations whose lost acknowledgement requires read-only recovery, not a fresh
mutation [R2], [R3], [R7].

**Offline storage:** IndexedDB/Cache can support meaningful offline UI, but data must actually be
modeled and stored locally. WebKit documents best-effort eviction, storage pressure, quotas, and
heuristic grants of persistent storage. Installation is not a backup or guaranteed retention of
unsynchronized work [W2], [W8]. User-cleared storage remains a recovery case.

**Secure context:** Service workers and sensitive web APIs require a secure context. Localhost and
loopback exceptions apply to the browsing device, not an arbitrary LAN IP [W5], [W9], [W11]. Merely
serving `http://192.168.…:8002` from the computer does not reproduce localhost PWA capabilities on a
phone. A trusted HTTPS access path is a deployment concern, independent of client framework.

**Wake Lock is not the workaround:** Screen Wake Lock applies to visible active documents and can
be released when hidden or under power restrictions. It is not permission to execute indefinitely
behind the lock screen [W7]. No broadly interoperable web API for a pre-scheduled **offline local
alarm at an exact deadline** was verified; do not sell Web Push as that feature.

### Optional post-release native iOS/iPadOS capabilities

| Capability | Platform fact | Product implication |
| --- | --- | --- |
| Local notification | The OS handles a scheduled notification when the app is backgrounded or not running; requests can be canceled [A1]. | A previously scheduled local reminder can work without a server connection. Notification permission/presentation settings still matter [A10]. This is not unrestricted background execution. |
| Background task | App refresh/processing and background push are system-scheduled or time-limited; refresh gets up to 30 seconds [A2]. | Neither a Capacitor runner nor Expo task can promise a precise countdown callback. Do not abuse unrelated background modes to keep a timer alive. |
| Live Activity | ActivityKit provides Lock Screen/Dynamic Island presentations through a widget extension. A Live Activity cannot itself access the network. It can be active up to **8 hours**, then remain on the Lock Screen up to **4 additional hours** [A3]. | Good candidate for glanceable elapsed/remaining time and selected controls, not an unlimited persistent process or a guarantee for an arbitrarily long running timer. Remote changes need app execution or ActivityKit push updates. |
| OS-rendered time | WidgetKit/SwiftUI can render automatically updating dates, timers and progress without continuously running the extension [A6]. | Avoid per-second network traffic/JS background loops. Pause/resume and corrections still require authoritative state changes. |
| AlarmKit | Available from **iOS/iPadOS 26**. It supports alarms/countdowns, authorization, system stop/countdown actions and App Intents. Alarms can override silent/Focus modes. Countdown presentation requires the widget extension; Apple warns missing it can cause alarms to be dismissed and fail to alert [A4], [A5]. | Material if an owner wants true timer/alarm interruption semantics on newer devices. Not equivalent to a normal reminder; requires an OS-version fallback, explicit permission, UX policy and a verified framework bridge. It is not an implied requirement. |

Native packages still need build/signing/distribution decisions. Tauri documents iOS development
requiring macOS/Xcode [T1]. Apple documents that free **Personal Team** provisioning expires after
**7 days**, requiring rebuild/reinstallation [A7]; that is not effortless permanent personal
installation. Store distribution brings review rules: Apple's 4.2 requires utility beyond a
repackaged website [A8]. This is a review risk to assess, **not** a prediction that a useful
web-based TimeTrace app would be rejected. PWA installation avoids native signing/store review.

### Optional post-release native Android capabilities

- Android notifications can expose an automatically updating stopwatch/countdown using a
  chronometer [D6]. That display is different from a continuously executing background timer.
- AlarmManager offers inexact and exact alarm paths; Doze/power restrictions affect delivery.
  Android 12+ exact alarms need the applicable special access/permission for normal durable alarm
  use. Android 14 denies `SCHEDULE_EXACT_ALARM` by default for most fresh installs targeting Android
  13+. `USE_EXACT_ALARM` is restricted to qualifying use cases/publishing policy, not a universal
  bypass. Check capability, provide denial fallback and re-establish alarms when appropriate after
  reboot; do not infer eligibility just because TimeTrace has a timer [D1], [D2].
- Notification visibility has a separate Android 13+ runtime permission. An app does not need that
  grant merely to launch a foreground service, but the service must still post its required
  notification; denial changes where the user sees it [D5]. Permission to schedule an exact alarm
  and permission to display a notification are not the same permission.
- Foreground services are for user-noticeable ongoing work and have type/start/other restrictions;
  Android lets users stop their app from Task Manager. They are not an immortal process or a
  requirement just to calculate elapsed time [D3], [D7].
- **Live Updates** can promote eligible ongoing, user-initiated, time-sensitive notifications to
  prominent surfaces. They require promotion configuration and capability checks; users can demote
  them and OEMs can add criteria. The current API reference marks the platform builder's
  `setRequestPromotedOngoing` as added in **version 36.1**; do not assume every Android version or
  framework binding exposes the same API. Android documents timer chronometers in the chip, but
  TimeTrace's use-case eligibility and actual OEM presentation remain **unverified** [D4], [D6].
  Prefer an honest ordinary-notification fallback over assuming promotion.

### Linux desktop

A browser/PWA is sufficient if the desired Linux client is a responsive app window with online API
access. Native packaging becomes more valuable for tray/global shortcuts, explicit lifecycle,
local file integration, or other OS integration. Those are product benefits, not evidence that
all desktop use needs a wrapper or a local host [W3], [T1], [T7].

Freedesktop notifications are a desktop-session service, with capabilities and server-dependent
presentation. They do not define a universal persistent lock-screen stopwatch or a guarantee that
an alert was seen [L2]. TimeTrace already uses a bounded session-bus adapter [R5]. A wrapper does
not inherently make a sleeping computer deliver on time; packaging, autostart/background lifecycle,
tray availability, distro dependencies and desktop-specific presentation need separate validation.

## 4. Candidate routes compared on product merit

All rows still require mobile-first information architecture, touch targets, keyboard/viewport
handling, accessibility, responsive navigation, and a data/connectivity contract. None is a
substitute for designing a good phone experience.

| Route | Product strengths | Important costs/constraints | Linux path | Strongest conditional fit |
| --- | --- | --- | --- | --- |
| **Responsive web + optional PWA** | URL-first access; no mandatory store; one DOM experience for mobile and large screens; browser accessibility and web components/libraries [W3], [W9]. | No verified standard native live-timer/alarm surface; closed-app reminders require push or a different native path. Offline cache/writes are deliberate engineering, not installation effects [W1], [W5], [W8]. | Browser; Chromium installed PWA. | Broad mobile web access and online control matter more than native lock-screen actions or exact offline alarms. |
| **Web UI + Capacitor mobile** | Same browser-oriented UI can be the product across web/mobile; native SDK access through plugins/Swift/Java; explicit native notification integrations [C1], [C2], [C3], [C4]. | WebView interaction/keyboard/accessibility must be polished. Native APIs need platform adapters; a web page wrapped unchanged is not automatically mobile-first, offline, or store-ready. | Keep web/PWA; use a separate desktop wrapper if justified. No first-party Linux desktop runtime was established by the reviewed Capacitor docs. | Rich DOM/web workflows are central, but mobile notification/native integration is valuable. |
| **React Native + Expo, with web** | Native mobile UI components and Expo integrations; RN Web can share React concepts/components; current widgets/Live Activity support [E1], [E2], [E3], [E4], [E5], [E6]. | Web-only DOM components do not render on native; web and native libraries/interaction patterns need deliberate divergence. A single repo is not identical UI or API parity everywhere. | Web/PWA or wrap the web export; native Linux is an out-of-tree project choice, not Expo's standard mobile target [E5]. | Mobile-native feel and mobile OS features are central, while a shared React-based web product remains valuable. |
| **Web UI + Tauri desktop; mobile evaluated separately** | Linux app packaging and native integration around a web UI; scoped native capabilities; optional external binaries [T1], [T2], [T3], [T4], [T5], [T6], [T7]. | Rust/native build and security surface; system WebView differences and distro dependencies; mobile support is not plugin parity. | First-party desktop target. | Linux integration is a real product requirement in addition to mobile web/mobile clients. |
| **Flutter across mobile/web/Linux** | Officially supports iOS, Android, web and Linux deployment; consistent app-like rendering/interaction from a Dart UI codebase [F1], [F2]. | Different web rendering model (CanvasKit/Skwasm), not reuse of a DOM application. Browser accessibility, startup/rendering, text/input and web library interop must be measured, not presumed inferior or superior. OS-specific features still need integration. | Official Linux deployment target, within documented distro/architecture support. | A unified cross-platform application UI, including a substantial Linux app, outweighs a DOM-first web strategy. |
| **Separate Swift/Kotlin mobile clients + web** | Most direct control over new platform APIs, platform-specific accessibility/interaction and native timer UX [A3], [A4], [A5], [A6], [D1], [D2], [D3], [D4], [D5], [D6]. | Multiple UI implementations and feature-parity work. No shared mobile UI with browser/Linux; still no automatic sync. | Independent web/PWA or desktop client. | Deeply platform-specific timer UX is decisive and independent client maintenance is acceptable. |

### A. Responsive web/PWA is an end-state candidate

**Assessment:** A mobile PWA can be an end-state browser product, but an online-only version would
not meet this map's minimum offline requirement. A native client is not a prerequisite for connected
timer control or reconstructing locally captured work after reopening. A persistent interactive
lock-screen surface or offline alarm at a deadline is a different capability, not a missing CSS
breakpoint; those native enhancements are optional after full release [W1], [W5], [A3], [A4], [A5].

A static shell and cached reads are useful preview increments, but do **not** satisfy the parent's
minimum offline Start/Stop and saved-work requirement. Section 6 separates those capabilities.

### B. Capacitor: web-first with native escape hatches

Capacitor is framework-agnostic native runtime infrastructure, not a requirement to adopt Ionic UI
or React [C1]. Local Notifications and Push Notifications are separate plugins. The stock push
plugin documents no iOS silent-push support; the Background Runner is a separate headless JS
context, not the WebView continuing normally [C2], [C3], [C4]. Runner limits include approximately 30 seconds
per iOS invocation and Android repeating work at least 15 minutes apart; requested timing is not
guaranteed. These are unsuitable as the focus deadline clock.

**Implication for this repo:** Capacitor's configuration expects compiled web assets; its external
`server.url` is documented for live reload, **not production** [C5]. Existing server-rendered Jinja
pages are not a self-contained offline mobile bundle [R1], [R2]. A credible route needs a deliberately
packaged web client/API boundary, not just pointing a production shell at the current development
server. That boundary can still use FastAPI. ActivityKit/AlarmKit or Android advanced surfaces need
a verified plugin/custom native adapter; stock basic notifications alone do not prove them.

### C. React Native/Expo with web: universal development, not universal behavior

Expo's web guide explains that React Native Web components wrap DOM primitives; web-only React DOM
components are also allowed but do not render natively [E1]. This offers genuine shared design and
pure logic, with platform-specific modules where appropriate. It does not establish that a dense
calendar, dashboard canvas or Markdown/editor library has identical web and native implementations.
Those library and accessibility choices need product-driven assessment against the required browser parity.

Current official docs provide:

- `expo-notifications`: scheduled local notifications and native APNs/FCM tokens; the Expo push
  service is an option, not proof that the backend must be Expo/TypeScript. Remote notifications
  on Android require a development build rather than Expo Go from SDK 53 [E3].
- `expo-widgets`: Android/iOS home widgets and **iOS Live Activities**, with a separate isolated
  widget runtime using Expo UI components. It is not available in Expo Go; normal React Native
  components, hooks, async work and app state are not available inside that widget runtime [E6].
- `expo-background-task`: deferrable WorkManager/BGTaskScheduler work. Android minimum interval is
  15 minutes; iOS chooses execution time. It is not a precise timer scheduler [E2].
- `expo-sqlite`: local persistence, including a web setup requiring WASM and headers for
  `SharedArrayBuffer` (COOP/COEP). Platform support/configuration differs; a local database does
  not synchronize itself [E4]. Expo web still needs explicit PWA configuration [E7].

**Unverified:** AlarmKit bridge availability, required widget/notification actions, SDK/version
compatibility, release-build behavior, and integration with TimeTrace's existing receipts. Do not
assume either “Expo cannot do native timers” or “Expo makes every timer feature automatic.” React
Native's own platform list treats Linux-capable alternatives such as React Native Skia as
out-of-tree; choosing them requires a separate maintenance/support evaluation [E5].

### D. Tauri: strong desktop candidate, mobile is a real but separate option

Tauri supports Android/iOS builds as well as desktop. Its system WebViews differ: WebKitGTK on
Linux, WKWebView on Apple platforms, Android's system WebView. Linux packages depend on distro
libraries, and documented packaging includes Debian, RPM, AppImage, Snap, Flatpak and AUR [T1], [T2],
[T7]. No comparable memory/startup benchmarks were performed; the old roadmap's fixed RAM claims
should not decide this choice.

The official notification plugin lists Linux, Android and iOS support; that is **not evidence** that
every advanced notification/alarm/live-timer feature has cross-platform parity [T3]. Tauri plugins
can include Swift/Kotlin implementations [T5]. Mobile Tauri is therefore a material web-UI-plus-native
alternative to Capacitor, especially if a common desktop/mobile shell is valuable, but it requires
an API-by-API proof rather than inheriting desktop capabilities by assumption.

For this map a Linux client connects to the separately hosted service, just as the browser does.
Tauri also documents external sidecars [T4], but that is a packaging capability, not a requirement
for a local daemon or another data authority on the laptop or phone.

**Security implication:** Loading remote pages and giving their scripts native permissions changes
the trust boundary. Tauri has explicit capability scoping and remote-origin rules [T6]. A wrapper
must not turn arbitrary remotely served HTML, model text, or navigation into privileged local code.

### E. Other material alternatives

Flutter is worth retaining if **native Linux plus mobile from one toolkit** becomes a primary
requirement. Its official web architecture is an application renderer, not simply the existing
HTML/DOM pages [F1], [F2]. Choosing it on product grounds would require evidence for this app's dense
web workflows, accessibility and input behavior; neither “native is always faster” nor “web
rendering is always better” was established. Direct Swift/Kotlin clients are the reference option
for the richest platform-specific behavior, not an assumption that all shared frameworks are
incapable. Neither alternative determines the server language or synchronization model.

## 5. Backend choice: evaluate independently

| Consideration | Python/FastAPI authority | TypeScript authority |
| --- | --- | --- |
| Browser/native clients | HTTP/OpenAPI contracts work with all studied clients. FastAPI documents automatic client generation in multiple languages [B1]. | Also compatible with the same clients; sharing a language is convenient, not required for HTTP interoperability. |
| Product/domain consistency | Current services already encode recording, recurrence, corrections, analytics, approvals and durable receipts [R0], [R3], [R9]. These are product semantics, not just implementation sunk cost. | Can express the same semantics, but parity must be specified and independently demonstrated. A language migration is not permission to simplify them. |
| Shared logic/tooling | Generated contracts/types and intentionally portable pure client logic remain possible. Python need not run on the phone. | Shared pure calculations, schemas and developer tooling may reduce boundary drift, especially for offline mobile behavior. OS APIs, persistence and execution still differ. |
| Validation/trust | Existing typed API/service boundaries are inspectable. Generated types do not replace wire/runtime validation. | TypeScript annotations are erased and do not change runtime behavior [B3]. Shared types do not authenticate a client or validate untrusted input by themselves. |
| Hosting, scheduling, sync | Depends on process availability, deployment, transport, persistence and protocol. | Same categories of requirements; changing to JS/TS does not bypass Apple/Android/browser scheduling policy. |

**Assessment:** Keeping FastAPI is compatible with a first-class native mobile product, not merely
a compromise to avoid rewrite effort. A TypeScript backend may have product/maintenance merit if
substantial portable client/server domain execution is genuinely required, or the chosen deployment
and team tooling favor it. That must be weighed against a fresh semantic-parity obligation. No
throughput, latency, battery, binary-size or operating-cost benchmark establishes a winner here.
No backend change is necessary merely to use Capacitor, Expo, Tauri, or Flutter.

## 6. Offline durability and reopening: what is actually documented

### 6.1 Four independent success boundaries

**Assessment:** An offline recording needs all four boundaries below. “Installed”, “cached”,
“queued”, and “synchronized” are not interchangeable success labels.

1. **Offline boot:** the app shell and necessary assets must already be stored and usable without
   the service. A service worker can intercept navigation and serve cached resources [W5]. A first
   visit while offline cannot fetch missing code/data. Ordinary HTTP cache or a manifest alone is
   not an offline-start guarantee.
2. **Local capture:** save the timer identity, task/context snapshot, Start/Stop boundaries, payload,
   operation identity and dependencies before calling the capture locally saved. This is a proposed
   protocol obligation, not a new selected schema. IndexedDB transactions provide atomic commit or
   abort; an individual request's success is not transaction completion [W16]. Storage errors must
   prevent a false saved indication, not silently fall back to memory.
3. **Reopen:** cold startup must rebuild local running/stopped state and pending work from committed
   storage, not from a surviving JS object or the number of ticks received. Persist while the user
   acts; visibility changes can add checkpoints but cannot be the sole save mechanism. Chrome says
   discard fires no events, frozen tasks do not execute, and mobile close/kill often omits
   `beforeunload`, `pagehide` and `unload` [W14]. These Chrome lifecycle details are not a claim that
   Safari implements Chrome's `freeze`/`resume` events; both targets need cold-start checks.
4. **Server acceptance:** reconnect must reconcile submitted identities, receipts and conflicts,
   retaining local work until authoritative acceptance is known. A network response, an empty
   outbox, and resulting recorded intervals must agree. A shell that reopens correctly does not
   prove the service received any work. The existing service uses server acceptance time for new
   timer cutoffs; delaying today's Start/Stop POSTs does **not** preserve offline boundaries [R3].

A locally committed running anchor can accrue a displayed duration while the page is suspended,
then accept an explicit Stop when reopened offline. This requires no background timer loop.
It does **not** observe whether the owner was working while the phone was locked, guarantee an
alarm, or authorize a missed focus/break transition. The eventual protocol must distinguish
client-captured time from service receipt time and handle wall-clock changes; a monotonic clock
from a dead process cannot resolve a reboot or cross-device clock disagreement [R4].

### 6.2 Regular tab, installed web app, packaged WebView

| Runtime | Storage and reopen facts | What installation/packaging does not guarantee |
| --- | --- | --- |
| **iPhone Safari regular tab** | WebKit's Safari 17 policy makes origin storage best-effort by default; Storage API exposes estimate, persistence request and result. Quota/storage pressure or inactivity can evict an origin's data [W2]. ITP's documented inactivity rule deletes script-writable storage after **seven days of Safari use without site interaction**, not simply seven elapsed calendar days; it includes IndexedDB, localStorage, service worker registration/cache [W13]. | No fixed survival period, final close callback, perpetual background execution, or promise that every persistence request is granted. A tab can have a service worker/offline shell without installation [W5]. |
| **iPhone Home Screen web app** | WebKit gives standalone apps the same quota class as browser apps, not non-browser WebViews. Home Screen status is a heuristic for granting persistence [W2]. The ITP note describes a separate use counter reset by using that web app; it expects first-party data not to be deleted by that inactivity rule [W13]. | Not immunity to all data loss or a backup. Do not generalize the tab's seven-day rule to every installed app, or infer that installation always grants persistent mode. Do not assume tab and installed app share pending work, authentication or storage; measure migration/reopen on each supported OS. |
| **Android Chrome regular tab** | IndexedDB/Cache can hold local data and an offline shell [W5], [W16]. Chrome automatically grants or silently denies persistent storage using heuristics including engagement, installation/bookmarking and notification permission; read the actual boolean [W15]. Chrome may freeze/discard a page [W14]. | Online access, continuous JS execution, and a persistence grant are separate. Closing a tab must not be treated as safe persistence of sessionStorage or in-memory drafts [W18]. |
| **Android Chrome installed PWA/WebAPK** | Installation changes launch/distribution and can improve persistence eligibility; it still uses web storage and service-worker lifecycles [W3], [W5], [W15]. | No native database simply because there is a home-screen icon, no universal background sync deadline, and no automatic offline support. Test tab/installed concurrent access rather than assuming separate outboxes or harmless shared writers. |
| **Packaged iOS WKWebView / Android WebView (for example Capacitor)** | WKWebView's default website data store persists to disk; a nonpersistent store is also available [A11]. WebKit documents lower quotas for non-browser apps: up to 15% origin / 20% overall disk, versus up to 60% / 80% for browser/standalone apps from Safari/iOS 17 [W2]. Both platforms explicitly expose WebView content/renderer termination handling [A12], [D8]. A package can deliberately use native storage instead [C6]. | A native shell does not keep its WebView JS alive, inherit Safari/Chrome's exact storage policy, or turn web storage into a transactional native outbox. Packaged assets can help offline boot; committed domain data, native bridge errors and restart reconstruction still need engineering. |

The quota percentages are **upper bounds, not reserved capacity or free space** [W2]. A tiny timer
journal is unlikely to need large capacity, but whole-origin eviction can still remove it with the
shell. Query `estimate()`, `persisted()` and `persist()` where supported, record actual results,
and handle `QuotaExceededError` and unavailable APIs. Never infer a grant from an icon or permission
prompt. The Storage Standard protects a persistent bucket from pressure clearing without user
consent; it does not prevent user clearing [W17]. WebKit's implementation uses heuristics [W2].

**Retention is different from commit durability.** IndexedDB offers `default`, `relaxed` and
`strict` transaction durability hints. Relaxed completion may precede verification of persistent
media; strict is a hint to favor durability, not an absolute hardware/power-loss guarantee [W16].
Transaction completion plus reopen/readback is stronger evidence than request success alone;
persistence permission protects against eviction, not a crash during an uncommitted transaction.
Do not store the only unsynchronized record in sessionStorage: it belongs to a window's session,
not a cross-session durable journal [W18].

**Packaged alternatives:** Capacitor's Preferences documentation warns that mobile OSs may clear
`localStorage`, uses UserDefaults/SharedPreferences natively and falls back to localStorage on the
web. It explicitly is not a database; uninstall clears its data [C6]. A transactional SQLite-backed
outbox can be evaluated, but plugin availability alone proves neither transactions across bridge
calls nor synchronization. Native app-specific Android files are removed on uninstall and cache
files can disappear sooner [D9]. Expo SQLite offers a native database, whereas its web support
requires a separate WASM/headers setup [E4]. Neither route strengthens Safari's browser storage
promise; both must still deliver the mandatory browser path.

**Private browsing:** do not promise durable offline work in private/incognito sessions. Chrome
explicitly removes site data when the incognito session ends [W19]. This is different from a
**private staged preview**, which means restricted product access and can use a normal browser
profile. Report storage capability/failure honestly without treating a private preview as an
incognito storage guarantee.

### 6.3 Workers, replay and recovery are bounded

- A service worker is event-driven and can be terminated when idle or for abnormal/overlong work.
  Registration can survive a restart; its global variables and running JS do not [W5].
  `waitUntil()` extends event work, not an unlimited process or a guaranteed future wakeup.
- One-shot Background Sync is not a required interoperable baseline: MDN marks limited availability
  and Safari lacks this API in its compatibility table [W10]. Workbox's fallback attempts replay
  when the worker starts, generally requiring the user to reopen the page; native support retries
  at browser-controlled intervals [W4]. **Foreground reopen/reconnect recovery is required even if
  a background path is added.** No unattended delivery deadline can be promised while the app is
  closed, disconnected, force-stopped or denied execution.
- Workbox queues failed HTTP requests in IndexedDB. Its default plugin queues thrown network
  failures, not ordinary HTTP 4xx/5xx responses; its example explicitly sets a 24-hour retention
  window [W4]. Copying such a configuration can expire valuable work. Any queue retention policy
  must retain or visibly escalate unsynchronized work, not silently delete it.
- “Fetch failed” can mean the server committed and the acknowledgement was lost. Current timer
  receipts bind a stable operation ID to a fixed payload; same ID/different payload conflicts,
  exact retries return the fixed result, and operation lookup distinguishes finalized from
  reconciliation-pending [R3]. Read-only recovery and explicit same-operation retry already exist
  in the browser; destructive discard recovery is deliberately read-only [R7]. A generic service
  worker must not replace these with new IDs, silently replay destructive commands, or retry a stale
  revision as though it were current.
- Existing browser journals are **sessionStorage**, including the current single uncertain timer
  operation and the manual-recording attempt [R2], [R7]. They are safety holds, not a durable
  multi-entry offline database. Current manual work creation does not supply the timer receipt
  protocol. Neither all mutations nor all callers can be declared replay-safe from the timer API.

**Proposed recovery obligations for specification** (not a selected merge algorithm):

| Observed state | Required distinction / candidate safe behavior |
| --- | --- |
| Start/Stop saved locally, never sent | Preserve original endpoints, context and identity; show **saved on this device, not synchronized**. Submit only through a protocol that understands those endpoints, not today's server-timed commands. |
| Sent, response lost | Retain the original immutable payload/ID; look up authoritative status. An unavailable lookup is still uncertain, not evidence of rejection. |
| Finalized receipt, response/display refresh failed | Adopt receipt result and recorded-work identity; retry reads, not a new recording. Retain enough local state to survive a crash before local acknowledgement cleanup. |
| Pending reconciliation or stale revision | Keep work and the failure reason visible; reconcile/check again or request an explicit resolution. Do not automatically rebase a Stop onto a different timer or silently overwrite accepted work. |
| Two offline devices, deleted task, overlapping work, or correction conflict | Preserve both captures as evidence; display conflicts before counting/merging. Local submission order cannot determine another device's intent. Ownership, conflict UX and accounting remain specification decisions. |
| Storage write failed or transaction aborted | Do not say “saved” or “synchronized”. Show the failure and retain whatever remains available for explicit copying/export; block unsafe sends/duplicate commands where journal safety is missing. A memory-only draft is not recovered work. |
| Local journal missing after clear/eviction/reinstall | Recover server-accepted work from the service; identify that local-only work cannot be reconstructed from server receipts. Where available, show storage reset/unknown state and offer explicit manual reconstruction. Never manufacture a completed interval from a stale display or guess that an absent outbox means everything synced. |
| Offline app cannot boot because shell was never cached or was evicted | Explain offline unavailability when a retained shell permits it. A browser error page may be unavoidable if no executable shell remains; do not promise the app can display its own recovery UI then. |

Even with an excellent protocol, **only-device unsynchronized data that has been deleted cannot be
recovered from the service**. A persistence grant cannot protect against explicit clearing,
device loss, every OS/browser defect or power failure. An application may also be unable to tell
first use from complete local erasure without an external retained identity. These are known
impossible/unpromisable cases, not reasons to silently shrink the parent's offline requirement.
The release spec must state its supported environments, retention warning/recovery behavior and
unavoidable loss boundary rather than claim unconditional “offline never loses work”.

### 6.4 Hosted authority, not a laptop dependency

The hosted service is the online authority. Cached reads, local offline recordings and eventual
submission supplement it; independent replicated databases are **not** a prerequisite or a decision
made by this report. Authentication, TLS, device revocation, backups and upgrades belong in the
hosted-service design, without choosing a provider here. A phone's localhost is the phone, not
the hosted service; ordinary LAN HTTP is not a substitute for trusted HTTPS [W11].

Current file/DB reconciliation and receipt machinery are useful server-side constraints, not a
protocol for copying SQLite plus timer JSON between devices [R3]. Host OS inactivity also cannot
establish whether the owner is working on a phone [R8]. Reusing desktop idle detection unchanged
on a headless host would silently change recording behavior. Offline clocks, pending task deletion,
recurrence/correction lineage and competing timer operations need a separate synchronization
contract consistent with [R9]. Native notification delivery is independent: a remote Pause can leave
a previously scheduled local alert stale on an unreachable device; push cannot fix that while
it is offline [A1], [W1]. Such native enhancements are optional after full release.

## 7. Platform consequences, without a stack decision

| Route | Fit with the settled destination | Evidence still required |
| --- | --- | --- |
| **Responsive web/PWA** | Directly supplies desktop and mandatory mobile browser access. Offline shell + transactional local capture + foreground reconciliation can meet ordinary suspension/reopen needs without continuous background JS. | Real Safari/Chrome retention, persistence-denied behavior, crash boundaries, updates and replay/conflict handling. No unconditional retention or closed-app sync promise. |
| **Shared web UI + Capacitor** | Keeps a mandatory web product and can add packaged assets, native storage and optional later OS integration. | Prove both web and native adapters; native storage does not solve browser durability. Verify WebView process death, native transaction acknowledgements and app upgrades. |
| **Expo web/mobile split** | Can share pure logic and selected UI while using native storage/mobile APIs. Web remains a first-class delivery target, not a preview of the native app. | Separate web persistence/offline implementation and native release-build tests, web/native library parity, reconciliation identity consistency. Expo Go success is not release evidence [E3], [E4], [E6], [E7]. |

Tauri, Flutter and direct native alternatives remain comparison context in sections 3–5, not a
reason to substitute an installed client for iPhone Safari or Android Chrome. Native widgets,
shortcuts and lock-screen improvements must not hold up the mandatory browser/offline work or be
used to claim browser capabilities that only the package has. Keeping FastAPI or choosing a
TypeScript service remains independent of these runtime differences.

## 8. Falsifiable real-phone proof matrix — all checks UNRUN

Use synthetic tasks, notes and intervals against an access-controlled HTTPS preview of the hosted
service, with the laptop powered off for the hosted-access check. No personal records are needed.
For each result record physical device/model, OS build, browser/WebView version, regular versus
installed launch mode, release/preview build, origin, storage permission result, exact steps,
local transaction completions, original payload/operation/work IDs, requests, server readbacks and
observed UI. Capture an independent expected ledger before inducing failure; an empty outbox or
an elapsed-time screenshot alone is not a pass. Measure retention and elapsed differences rather
than inventing a launch SLA from a single observation.

**Required browser lanes:** iPhone Safari regular tab; iPhone installed Home Screen web app;
Android Chrome regular tab; Android installed PWA/WebAPK (record if it is only a shortcut).
Ordinary tab lanes cannot be replaced by installed results. Include chosen oldest supported and
current OS/browser versions; versions are not selected by this research. If packages are shortlisted,
add separately signed/release-like iOS WKWebView and Android WebView lanes, plus Expo native lanes
where applicable. Private/incognito is a negative/degraded case, not a substitute for a normal lane.

| Check / controlled intervention | Falsifiable oracle (not a claim of current implementation) |
| --- | --- |
| **Hosted access, laptop off** | From both phones and desktop web, reach the separately hosted service, accept a recording and read the identical work identity from another device. No local daemon or native package dependency. |
| **Offline cold boot / first visit** | After explicitly priming the shell/data, disconnect all service paths, kill and reopen: core capture UI loads. In a fresh unprimed origin offline, do not claim readiness; distinguish missing shell from a lost recording. |
| **Offline Start → 10 minutes locked → reopen → Stop** | Start local commit completes before saved indication; after lock/background, reopen still offline and Stop. Retained endpoints/context match the captured ledger, not tick counts or reconnect time. After reconnect, the interval appears once with the same boundaries; no planned session is converted into performed work. |
| **Stopped offline → reload / close tab / reopen URL** | Start and Stop both locally commit, then reload and separately close/recreate the tab. Same pending recording survives each normal-profile cold start and is visibly unsynchronized. A surviving sessionStorage tab alone fails this test. |
| **Process loss at each local boundary** | Separately kill before commit, after commit before UI acknowledgement, and after acknowledgement. Precommit must not have claimed saved; completed records survive ordinary process kill, preserving IDs and state. Verify the process really exited; merely backgrounding is not a kill. Sudden power loss is a separate, weaker-guarantee case. |
| **Server ACK loss and cleanup crash** | Allow one server commit but drop its response; kill/reopen before local cleanup and again after receipt readback. Lookup/exact retry yields the original work IDs, exactly one set of recorded intervals, and no new Start/Stop operation. No duplicate accounting. |
| **Repeated reconnect / closed-app reconnect** | Flap connectivity with pending work; later restore it while the app stays closed. Record whether any background replay actually occurs, with no promised deadline; reopening must eventually reconcile on a reachable service. Each accepted recording remains unique. |
| **401/403, 409, 500 and service outage** | Interpose each response separately. Auth failure preserves local work for reauthentication; conflict is visible without silent rewrite; transient errors do not count as acceptance or erase the outbox. Reopen/retry only completes once validated server evidence exists. |
| **Two tabs / tab plus installed app / two phones** | Capture pending work independently, reconnect in both orders, and repeat with the same assigned task. Every captured item is accounted for as accepted or explicitly conflicted. No overwritten local journal, duplicate timer, silently merged overlap or double-counted retry. Record storage/auth sharing, not assumptions. |
| **Task deletion, correction and recurrence changes while offline** | Change/delete the referenced task or relevant plan on another device before reconnect. Preserve capture and original context; reject or explicitly resolve conflicting submission without resurrecting a plan or dropping work. Chosen resolution policy is a later spec input. |
| **Clock/timezone change, reboot, long suspension** | Change wall clock forward/back and timezone while offline; separately reboot after Start and before Stop. Preserve original evidence and flag discontinuities instead of negative/invented durations. Do not auto-credit idle gaps or retroactively take a break. Record elapsed error and required owner resolution. |
| **Persistence denied / full disk / aborted transaction** | Record API grant/denial and exercise denied/unavailable storage and failed writes. No local saved acknowledgement before successful commit; actionable degraded state, pending work retained where possible. A desktop quota mock is fault-path evidence, not real-phone eviction proof. |
| **Storage pressure / long non-use** | On disposable phone profiles, keep unsynchronized work through controlled pressure and an actual interval of non-use. For Safari tab inactivity, document seven days of Safari use without target-site interaction; compare installed lane separately. Record whether/when eviction occurs and what survives. Lack of eviction in one trial proves no indefinite guarantee. |
| **Explicit clear / uninstall / incognito end** | Deliberately clear the disposable origin or remove its app; end incognito separately. Accepted server work remains retrievable; local-only deleted work is not claimed recoverable or synchronized. Record actual storage-reset detection limits. |
| **Shell/service-worker update and local schema upgrade** | Leave unsynchronized old-version work, deploy a new preview, reopen offline/online with an older tab still open. Work survives upgrade, identities/payloads remain interpretable, no cache cleanup deletes the journal and a blocked/failed upgrade is visible. |
| **Battery saver / memory pressure / force stop / package renderer death** | Repeat committed capture through each intervention separately. Record exact action and platform (Android force stop differs from swiping a task away). Cold reopen restores committed work; no guarantee of closed-app replay or alarms. For packages, prove WebView recreation reads committed storage rather than relying on renderer memory. |

**Evidence limits and unresolved specification inputs:** no matrix cell has been executed here.
The minimum supported versions, allowable elapsed uncertainty, longest supported offline period,
conflict/ownership policy, durable offline submission schema, authenticated-device lifecycle and
storage-loss UX remain to be specified. No browser test can establish indefinite retention,
execution while force-stopped, instant agreement between disconnected devices, exact offline web
alarms, recovery of erased local-only work, or exactly-once user-visible notification delivery.
These limits need explicit release language and degraded/recovery behavior, not silent data loss
or a native-only workaround for the mandatory browser requirement.

## Sources

Official documentation/source was accessed on the research date. Bracketed source references in prose
link to the corresponding individual entries below.

### Web standards and browser vendors

- **W1:** [WebKit: Web Push for Web Apps on iOS and iPadOS][W1] — iOS 16.4 baseline, Home Screen permission, Focus, badging, Apple push service.
- **W2:** [WebKit: Updates to Storage Policy][W2] — quotas, best effort, eviction and persistence.
- **W3:** [Google/web.dev: Installation][W3] — desktop/Android distribution; older Apple subsections must be read with W1/W12.
- **W4:** [Chrome: Workbox Background Sync][W4] — browser-controlled retry and fallback.
- **W5:** [W3C Service Workers specification][W5] — secure contexts and event-driven worker lifetime.
- **W6:** [Mozilla: Window.setTimeout][W6] — inactive-tab throttling/unloading.
- **W7:** [Mozilla: Screen Wake Lock API][W7] — visible-document and power restrictions.
- **W8:** [Mozilla: Offline and background operation][W8] — cache, background work, push and restrictions.
- **W9:** [Mozilla: Making PWAs installable][W9] — secure origin and installation support by browser/platform.
- **W10:** [Mozilla: Background Synchronization API][W10] — limited availability and secure context.
- **W11:** [Mozilla: Secure contexts][W11] — HTTPS/loopback distinction.
- **W12:** [WebKit: Safari 26 announcement][W12] — changed Add to Home Screen behavior.
- **W13:** [WebKit: Full Third-Party Cookie Blocking and More][W13] — script-writable storage inactivity rule and Home Screen distinction; read with newer W2.
- **W14:** [Chrome: Page Lifecycle API][W14] — freeze/discard, missing mobile close events, persistence guidance.
- **W15:** [Google/web.dev: Persistent storage][W15] — Chromium grant heuristics and user clearing; use W2 for current Safari policy.
- **W16:** [W3C Indexed Database API][W16] — transaction completion/abort and durability hints.
- **W17:** [WHATWG Storage Standard][W17] — buckets, persistence and user consent to clearing.
- **W18:** [WHATWG HTML: Web storage][W18] — sessionStorage versus localStorage lifetime/scope.
- **W19:** [Chrome Help: Browse in Incognito mode][W19] — session-end removal of site data.

### Apple and Android

- **A1:** [Apple: Scheduling a notification locally from your app][A1].
- **A2:** [Apple: Choosing background strategies for your app][A2].
- **A3:** [Apple: Displaying live data with Live Activities][A3].
- **A4:** [Apple: AlarmKit][A4] — API availability includes iOS/iPadOS 26.
- **A5:** [Apple: Scheduling an alarm with AlarmKit][A5] — authorization, countdown, controls, extension requirement.
- **A6:** [Apple: Displaying dynamic dates][A6] — OS-rendered dates, timer and progress.
- **A7:** [Apple: About your developer account][A7] — Personal Team provisioning limits.
- **A8:** [Apple App Review Guidelines, §4.2][A8].
- **A10:** [Apple: Asking permission to use notifications][A10].
- **A11:** [Apple: WKWebsiteDataStore][A11] — default persistent versus nonpersistent store.
- **A12:** [Apple: webViewWebContentProcessDidTerminate][A12] — separate WebView content process termination.
- **D1:** [Android: Schedule alarms][D1] — alarm APIs, permissions, Doze, reboot.
- **D2:** [Android 14: Schedule exact alarms change][D2].
- **D3:** [Android: Foreground services overview][D3].
- **D4:** [Android: Live Updates][D4] — promotion/usage criteria and device/user control.
- **D5:** [Android: Notification runtime permission][D5].
- **D6:** [Android: Notification.Builder.setUsesChronometer][D6].
- **D7:** [Android: Handle user-stopped foreground services][D7].
- **D8:** [Android: WebViewClient.onRenderProcessGone][D8] — renderer exit/crash handling.
- **D9:** [Android: Access app-specific files][D9] — uninstall and cache deletion limits.

### Client frameworks and desktop protocol

- **C1:** [Capacitor introduction][C1].
- **C2:** [Capacitor Local Notifications][C2].
- **C3:** [Capacitor Push Notifications][C3].
- **C4:** [Capacitor Background Runner][C4].
- **C5:** [Capacitor official configuration source][C5] — `webDir`, `server.url`, production warnings.
- **C6:** [Capacitor Preferences official README][C6] — native storage, web fallback, uninstall and database warning.
- **E1:** [Expo: Develop websites][E1].
- **E2:** [Expo BackgroundTask][E2].
- **E3:** [Expo Notifications][E3].
- **E4:** [Expo SQLite][E4].
- **E5:** [React Native: Out-of-tree platforms][E5].
- **E6:** [Expo Widgets][E6] — current widget/Live Activity APIs and runtime limitations.
- **E7:** [Expo official PWA guide source][E7].
- **T1:** [Tauri prerequisites][T1] — desktop/mobile dependencies and iOS toolchain.
- **T2:** [Tauri WebView versions][T2].
- **T3:** [Tauri notification plugin][T3].
- **T4:** [Tauri external binaries/sidecars][T4].
- **T5:** [Tauri plugin development][T5] — platform support and mobile native code.
- **T6:** [Tauri security capabilities][T6] — native permission and remote-source boundaries.
- **T7:** [Tauri distribution][T7].
- **F1:** [Flutter supported platforms][F1].
- **F2:** [Flutter web support][F2] — Dart, renderer and application-oriented model.
- **L2:** [Freedesktop notification protocol][L2].
- **B1:** [FastAPI features][B1] — OpenAPI/JSON Schema and generated clients.
- **B3:** [TypeScript handbook: Erased Types][B3].

### Repository evidence

These are source/document observations, not claims of live-device acceptance.

- **R0:** [CLAUDE.md][R0] — architecture, settled scope and historical roadmap.
- **R1:** [Root daemon app][R1]; [API router registration](../../src/timetrace/interfaces/api/routers/__init__.py).
- **R2:** [Shared browser API client][R2]; [web routes](../../src/timetrace/interfaces/api/routers/web.py).
- **R3:** [MultipleTimerService][R3]; [TimerStore](../../src/timetrace/core/timer_store.py).
- **R4:** [FocusEvaluator][R4]; [FocusRuntime](../../src/timetrace/services/focus_runtime.py).
- **R5:** [Linux notification adapter][R5]; [#63 focus/notification maintenance record](../timer-focus-63.md).
- **R6:** [Settings][R6].
- **R7:** [Multi-timer browser controller][R7]; [device-local pins](../../src/timetrace/interfaces/api/static/js/workspace_pins.js).
- **R8:** [TimerService][R8]; [host idle detector](../../src/timetrace/core/idle_detector.py).
- **R9:** [Glossary][R9]; [recorded-work boundary ADR](../adr/0001-explicit-recorded-work-boundaries.md).

[W1]: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
[W2]: https://webkit.org/blog/14403/updates-to-storage-policy/
[W3]: https://web.dev/learn/pwa/installation/
[W4]: https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
[W5]: https://w3c.github.io/ServiceWorker/
[W6]: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
[W7]: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
[W8]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
[W9]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
[W10]: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
[W11]: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts
[W12]: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
[W13]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
[W14]: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
[W15]: https://web.dev/articles/persistent-storage
[W16]: https://w3c.github.io/IndexedDB/
[W17]: https://storage.spec.whatwg.org/
[W18]: https://html.spec.whatwg.org/multipage/webstorage.html
[W19]: https://support.google.com/chrome/answer/95464?hl=en
[A1]: https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app
[A2]: https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app
[A3]: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
[A4]: https://developer.apple.com/documentation/alarmkit
[A5]: https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit
[A6]: https://developer.apple.com/documentation/widgetkit/displaying-dynamic-dates
[A7]: https://developer.apple.com/help/account/basics/about-your-developer-account
[A8]: https://developer.apple.com/app-store/review/guidelines/#minimum-functionality
[A10]: https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications
[A11]: https://developer.apple.com/documentation/webkit/wkwebsitedatastore
[A12]: https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:)
[D1]: https://developer.android.com/develop/background-work/services/alarms
[D2]: https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
[D3]: https://developer.android.com/develop/background-work/services/fgs
[D4]: https://developer.android.com/develop/ui/views/notifications/live-update
[D5]: https://developer.android.com/develop/ui/compose/notifications/notification-permission
[D6]: https://developer.android.com/reference/android/app/Notification.Builder#setUsesChronometer(boolean)
[D7]: https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping
[D8]: https://developer.android.com/reference/android/webkit/WebViewClient#onRenderProcessGone(android.webkit.WebView,%20android.webkit.RenderProcessGoneDetail)
[D9]: https://developer.android.com/training/data-storage/app-specific
[C1]: https://capacitorjs.com/docs
[C2]: https://capacitorjs.com/docs/apis/local-notifications
[C3]: https://capacitorjs.com/docs/apis/push-notifications
[C4]: https://capacitorjs.com/docs/apis/background-runner
[C5]: https://github.com/ionic-team/capacitor/blob/main/cli/src/declarations.ts
[C6]: https://github.com/ionic-team/capacitor-plugins/blob/main/preferences/README.md
[E1]: https://docs.expo.dev/workflow/web/
[E2]: https://docs.expo.dev/versions/latest/sdk/background-task/
[E3]: https://docs.expo.dev/versions/latest/sdk/notifications/
[E4]: https://docs.expo.dev/versions/latest/sdk/sqlite/
[E5]: https://reactnative.dev/docs/out-of-tree-platforms
[E6]: https://docs.expo.dev/versions/latest/sdk/widgets/
[E7]: https://github.com/expo/expo/blob/main/docs/pages/guides/progressive-web-apps.mdx
[T1]: https://v2.tauri.app/start/prerequisites/
[T2]: https://v2.tauri.app/reference/webview-versions/
[T3]: https://v2.tauri.app/plugin/notification/
[T4]: https://v2.tauri.app/develop/sidecar/
[T5]: https://v2.tauri.app/develop/plugins/
[T6]: https://v2.tauri.app/security/capabilities/
[T7]: https://v2.tauri.app/distribute/
[F1]: https://docs.flutter.dev/reference/supported-platforms
[F2]: https://docs.flutter.dev/platform-integration/web
[L2]: https://specifications.freedesktop.org/notification/latest/protocol.html
[B1]: https://fastapi.tiangolo.com/features/
[B3]: https://www.typescriptlang.org/docs/handbook/2/basic-types.html#erased-types
[R0]: ../../CLAUDE.md
[R1]: ../../src/timetrace/main.py
[R2]: ../../src/timetrace/interfaces/api/static/js/api_client.js
[R3]: ../../src/timetrace/services/multiple_timer_service.py
[R4]: ../../src/timetrace/services/timer_focus_service.py
[R5]: ../../src/timetrace/services/notification_delivery.py
[R6]: ../../src/timetrace/config.py
[R7]: ../../src/timetrace/interfaces/api/static/js/multiple_timers.js
[R8]: ../../src/timetrace/services/timer_service.py
[R9]: ../../GLOSSARY.md
