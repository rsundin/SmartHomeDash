# Dashboard research, November 2026

Background for [plan.md](plan.md): what popular smart home dashboards do, what stands out and what people complain about, compared with SmartHomeDash 0.8.5. Sources are listed at the end, numbered like [1].

## The landscape

**Home Assistant's own direction.** Home Assistant has moved toward automatic, area-driven dashboards. Since 2026.1 the Home dashboard shows summaries for lights, climate, security, media, weather and energy, then favourites and areas [1]. Since 2026.2 it is the default for new installations, together with a power distribution card [2]. 2026.6 added a card picker by entity, with an opt-in for custom cards (`getEntitySuggestion`) [3]. 2026.11 added automatic sections and scoping by area or floor. It also changed entity naming: cards without a name now show "device name + entity name", and `friendly_name` in templates is headed for deprecation [4]. The core is getting good at lists of controls. It has no picture of the home.

**Floor plans in 2D and 3D.** This is the closest group to SmartHomeDash:
- **ha-floorplan (SVG):** the long-standing 2D option. Its own docs warn that it "will require a good amount of your time": draw in another tool, trace in Inkscape, give every element an id, then write config per room [5].
- **3D cards (Floorplan 3D, Floor3DX, the "ready-made 3D floorplan"):** look impressive but need a model from Sweet Home 3D or similar. Users report slow loading of large models, phones that crash or lag, and around 30 lights being enough to bog down a laptop [6]. Floor3DX answers this with compressed models and a separate 2D "snapshot" card for tablets and guests, with a guest mode that limits locks, garage doors and alarms [7]. The ready-made card is praised for being smooth on an old tablet, but its layout was saved only in the editing browser [8].
- **NeonPlan 3D:** the most complete competitor. It has an in-HA editor (rooms, walls, doors, roofs, furniture) and links each room to an HA area so devices drop in with one tap. Lights show true colour, and there are covers, open windows, cameras with field of view, media that glows, appliances, people per room, a temperature and humidity heatmap, sun and shadow, and weather. It works as both card and panel, with kiosk idle, night dimming, a voice button, quality settings for weak tablets, floors from HA, several homes, restore points and 19 languages [9][10].
- **Outside Home Assistant:** SmartThings Map View is valued for seeing where devices are, but setup stalls and devices must be dragged into place by hand [11]. Homey's Space Homey floor plan widget swaps images when lights change; users ask for colour lights, temperature, several lights per room and image resolution guidance, and report Android slowness [12].

**Energy.** Flow cards are among the most-used custom cards: Power Flow Card Plus, Tesla-style, Power Nexus, Sunsynk, Sankey [13]. A recent wall-tablet card pairs live flow with an hourly or quarter-hour price chart and a "now" marker [14]. Nord Pool moved to 15-minute day-ahead prices in October 2025. The HA integrations followed, and users hit hourly assumptions in cards and templates [15][16].

**Wall screens.** Recurring patterns:
- screensavers with clock, weather or photos
- wake on motion, dim at night
- a doorbell camera that pops up on ring
- large touch targets and per-tablet layouts

Projects in this space include WallMode, SeHomeWall, WallPanel, Fully Kiosk setups and View Assist for voice [17][18][19][20]. A well-documented floorplan home found the floorplan "the only part of the UI used daily". Guests use it without instruction, each tablet shows only its own floor, and screens stay off until motion [21].

**Pain points across forums.**
- **Slow dashboards on tablets and phones** is the most repeated complaint: huge DOM counts from card-mod and custom cards, video cards, weak hardware [22][23].
- **Setup effort and YAML** come next ("WTH do I still need to be a rocket scientist") [24].
- **Fragile per-device setups** where something saved in one browser is missing in another [8].

## What stands out, and where SmartHomeDash is

| Theme | Best in class | SmartHomeDash 0.8.5 | Gap |
| --- | --- | --- | --- |
| Picture of the home | 3D cards, NeonPlan | Real photo/render, lamps glow in true colour and temperature, dusk, weather | Ahead on realism with no modelling; keep it |
| Setup effort | NeonPlan editor, HA auto-dashboards | UI guide, draw rooms, areas link, auto-placement | No undo, no vertex editing or snapping, no quick start without pictures |
| Rooms and areas | NeonPlan, HA Home | Areas, floors, buildings, auto-placement | Good |
| Doors, windows, alarms | NeonPlan, Seán's plan | Badges per room, warnings | Openings not shown at their real position |
| People | NeonPlan figures, Person Location Card | Presence outline only | Who is where |
| Media, appliances, cameras | NeonPlan, Floor3DX | Doorbell only | Missing |
| Energy | Flow cards, power distribution | Flow on the picture with labels, price, cheapest hours | Per-room power; quarter-hour price resolution |
| Wall screens | WallMode, SeHomeWall, NeonPlan kiosk | Kiosk, idle, night dim, doorbell, light mode | Ambient screensaver, per-screen profiles, guest mode |
| Speed on old tablets | Ready-made 3D, NeonPlan quality setting | Light mode, auto-detect | No measured budget, no automated tests |
| Reach | NeonPlan card + 19 languages | Panel only, sv/en | Card mode, languages, export/import |

## Conclusions for the plan

1. **Protect the differentiator:** a real picture of *your* home, set up in the UI in an hour, fast on an old tablet. Every 3D project fights setup effort and speed, so a 3D editor would be the wrong race to join.
2. **Before more features:** automated tests and a performance budget. The community's top complaint is speed, and development now runs through Claude Code, which needs tests to work safely.
3. **Make setup nearly zero:** a quick start from Home Assistant floors and areas, and editor comforts (undo, vertex editing, snapping).
4. **Show more of the home where it is:** openings at their position, people, media, appliances, cameras, per-room power.
5. **Wall screens as an ambient display:** the house picture is a natural screensaver. Add per-screen profiles with a guest mode.
6. **Reach:** a card for any dashboard, more languages, export and import, the default HACS list.

## Sources

1. [Home Assistant 2026.1: Home is where the dashboard is](https://www.home-assistant.io/blog/2026/01/07/release-20261/)
2. [Home Assistant 2026.2 arrives with new power distribution card (Notebookcheck)](https://www.notebookcheck.net/Home-Assistant-2026-2-arrives-with-new-power-distribution-card.1222360.0.html)
3. [Home Assistant 2026.6: Pick a card, any card](https://www.home-assistant.io/blog/2026/06/03/release-20266/)
4. [Home Assistant 2026.11: A lot in store!](https://www.home-assistant.io/blog/2026/11/04/release-202611/) and [Naming things in Home Assistant](https://www.home-assistant.io/blog/2026/11/03/naming-things-in-home-assistant/)
5. [ha-floorplan: Important notice before you begin](https://experiencelovelace.github.io/ha-floorplan/docs/quick-start)
6. [Floorplan 3D – a Home Assistant 3D floorplan card (community thread)](https://community.home-assistant.io/t/floorplan-3d-a-home-assistant-3d-floorplan-card/902878)
7. [Floor3DX card, 2D snapshot card and learning scheduler (community thread)](https://community.home-assistant.io/t/floor3dx-card-the-3d-floor-plan-card-plus-two-optional-companions-a-2d-snapshot-card-and-a-learning-enabled-scheduler/1029922)
8. [Ready-made 3D floorplan with physics-based lighting (community thread)](https://community.home-assistant.io/t/ready-made-3d-floorplan-for-home-assistant-physics-based-lighting-fully-offline-no-extra-tools/1012715)
9. [NeonPlan 3D on GitHub](https://github.com/Mastershort/neonplan3d)
10. [NeonPlan 3D (community thread)](https://community.home-assistant.io/t/neonplan-3d-draw-your-home-in-home-assistant-and-control-it-in-a-live-3d-floor-plan-free-hacs-online-demo/1027224)
11. [SmartThings Map View (community thread)](https://community.smartthings.com/t/new-map-view-feature-to-visualize-where-devices-are-located-in-your-home/272366?page=8)
12. [Space Homey floor plan widget (Homey community)](https://community.homey.app/t/space-homey-new-floor-plan-widget-in-the-works/130757?page=2)
13. [Power Flow Card Plus (community thread)](https://community.home-assistant.io/t/power-flow-card-plus/552326?page=16), [Tesla-style energy flow card](https://community.home-assistant.io/t/tesla-style-energy-flow-card/997714), [Power Nexus card](https://community.home-assistant.io/t/lovelace-power-nexus-card-another-better-power-flowing-card/1014617), [energy-sankey](https://github.com/davet2001/energy-sankey)
14. [Energy Flow & Price card, built for a wall tablet](https://community.home-assistant.io/t/energy-flow-price-card-live-power-flow-hourly-quarter-hour-price-built-for-a-wall-tablet/1017068)
15. [Nordpool integration with 15-minute data (community thread)](https://community.home-assistant.io/t/nordpool-ha-integration-with-15min-data-apexcharts-and-more-updated/935651)
16. [Optimizing HVAC energy savings with Nord Pool 15-minute pricing](https://community.home-assistant.io/t/optimizing-hvac-energy-savings-with-nordpool-15-min-pricing-part-1-3-theory-implementation-and-examples/936741)
17. [WallMode: open-source Android kiosk app](https://community.home-assistant.io/t/wallmode-a-free-open-source-android-kiosk-app-for-home-assistant/1024625)
18. [SeHomeWall for Home Assistant](https://community.home-assistant.io/t/sehomewall-for-home-assistant/1022170)
19. [WallPanel add-on (community thread)](https://community.home-assistant.io/t/wallpanel-addon-wall-panel-mode-for-your-home-assistant-dashboards/449857?page=14)
20. [View Assist: visual feedback for Assist on a tablet](https://community.home-assistant.io/t/view-assist-visual-feedback-for-assist-voice-assistant-on-an-android-tablet-install-info-provided-on-wiki/699659)
21. [Seán Blanchfield: My smart home dashboard](https://seanblanchfield-blog.pages.dev/2024/05/my-smart-home-dashboard)
22. [WTH dashboards are so slow?](https://community.home-assistant.io/t/wth-dashboards-are-so-slow/803120)
23. [Terrible performance on seemingly most Android tablets](https://community.home-assistant.io/t/terrible-performance-on-seemingly-most-android-tablets/760318)
24. [WTH do I still need to be a rocket scientist to get things done in HA](https://community.home-assistant.io/t/wth-do-i-still-need-to-be-a-rocket-scientist-to-get-things-done-in-ha/809898?page=10)
25. [Home Assistant dashboard examples (HomeShift)](https://joinhomeshift.com/home-assistant-dashboard-examples)
26. [Person Location Card – room-level and general location](https://community.home-assistant.io/t/person-location-card-room-level-general-location/1001105)

## Second pass, 13 November 2026

New since the first pass, with SmartHomeDash at 0.8.16 (see [status-2026-11.md](status-2026-11.md)):

- **HACS became the Home Assistant Marketplace in 2026.11.** It sits under Settings → Marketplace and lists integrations, cards, themes and templates. A separate HACS install is blocked. A custom repository is added with "Add from link" after a GitHub device sign-in. Project pages show installs, stars, the minimum Home Assistant version and brand images, and installing goes straight into the integration's setup [R27][R4].
- **Home Assistant's dashboards aim at the whole family:** a calmer default Overview, areas driving climate and energy, personal themes per user profile [R28][R29]. 2026.11 added community sections, an alert badge with a pulse and copy-paste of sections [R4].
- **Ready-made apps over DIY cards:** GlassHome, Magic Frame (photo frame mode), Tunet (energy and EV). The review notes guest access is missing in most of them. It is written by GlassHome's maker [R30].
- **AI on the dashboard:** LLM Vision's timeline and preview cards summarise camera events, and people show LLM-written weather and daily briefings [R31][R32]. Home Assistant ships an MCP server for AI assistants [R41].
- **Low-power displays:** TRMNL and other e-ink boards show the family calendar and home status, refreshed on a schedule [R33][R34].
- **Swedish capacity fees:** the requirement for all grid companies to introduce capacity tariffs from 2027 was stopped in March 2026. About 30–50 companies that already have them are unaffected [R35].
- **Energy planning:** solar forecast cards and battery planners such as Predbat and EMHASS sit next to live flow [R36][R37].
- **Summer houses:** frost near pipes, heat, humidity, intrusion and an event history are the core of holiday-home monitoring [R38].
- **Accessibility:** requests for bigger text, keyboard navigation and screen-reader-readable graphs [R39][R40].

### Sources, second pass

27. [HACS is now the Home Assistant Marketplace (Frenck)](https://frenck.dev/hacs-is-now-the-home-assistant-marketplace/)
28. [Home Assistant 2026.2: Home, sweet overview](https://www.home-assistant.io/blog/2026/02/04/release-20262/)
29. [Home Assistant's new dashboard finally makes sense for the whole family (XDA)](https://www.xda-developers.com/home-assistant-february-update-2026/)
30. [Best Home Assistant Dashboards (2026), GlassHome](https://glasshome.app/blog/best-home-assistant-dashboards/)
31. [LLM Vision timeline and preview cards](https://llmvision.org/card/)
32. [A weather report on the dashboard with a local LLM (XDA)](https://www.xda-developers.com/weather-report-on-home-assistant-dashboard-with-local-llm/)
33. [TRMNL e-ink dashboard review (HomeTechHacker)](https://hometechhacker.com/trmnl-og-e-ink-dashboard-review-a-focused-battery-powered-family-status-board/)
34. [Best e-ink displays for Home Assistant (ComputingForGeeks)](https://computingforgeeks.com/best-e-ink-display-home-assistant/)
35. [Regeringen stoppar kritiserad effektavgift på el (TV4/TT, 13 March 2026)](https://www.tv4.se/artikel/tt-260313-elkostnader1-a11d2879/regeringen-stoppar-kritiserad-effektavgift-pa-el)
36. [Solar Weather Card (community thread)](https://community.home-assistant.io/t/solar-weather-card/1005846)
37. [Predbat documentation](https://springfall2008.github.io/batpred)
38. [Tryggt fritidshus, Telldus](https://telldus.com/en/blogs/news/trygg-sommarberedskap)
39. [WTH: bigger text sizes in Lovelace (community thread)](https://community.home-assistant.io/t/wth-old-people-50ish-need-bigger-text-sizes-in-lovelace/477181)
40. [Accessibility in Home Assistant (community thread)](https://community.home-assistant.io/t/accessibility-in-home-assistant/795460)
41. [Model Context Protocol Server integration](https://www.home-assistant.io/integrations/mcp_server/)
