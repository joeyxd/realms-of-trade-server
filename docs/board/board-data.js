window.MN_BOARD = {
  "meta": {
    "title": "Marea Negra Board",
    "branch": "origin/claude/loving-lovelace-ptbif7",
    "where_we_are": "M2.5 to M4.7 are done. M4.8 (Perlas negras) is a release candidate waiting for physical acceptance and publication. M5, M6 and M7 are partial. M8 is not started.",
    "roadmap_updated": "2026-10-15",
    "live_version": "0.6.0-alpha.70",
    "protocol": 62,
    "live_raw": {
      "game": "MAREA NEGRA",
      "version": "0.6.0-alpha.70",
      "players": 0,
      "max": 4,
      "sockets": 0,
      "tick": 4973664,
      "uptime": 83075,
      "stepMs": 1.152,
      "bots": 3,
      "names": [],
      "errors": 0,
      "content": {
        "generation": 8,
        "revisionId": null,
        "switching": false
      },
      "storage": {
        "kind": "supabase",
        "durable": true,
        "accounts": true,
        "playerCharacters": {
          "ready": true,
          "limit": 3
        },
        "errors": 0,
        "unsaved": 0,
        "profileWrites": 0,
        "worldWriting": false,
        "economic": {
          "enabled": true,
          "pending": 0,
          "failed": false,
          "completed": 0,
          "replays": 0
        },
        "groundTransactions": null,
        "groundPearls": null,
        "groundDeaths": null,
        "groundPearlMints": null,
        "tickBlocked": false,
        "staging": null,
        "deathStaging": null,
        "deathDrops": null,
        "pearlGround": null,
        "combatDeaths": null,
        "startup": null,
        "resources": {
          "enabled": true,
          "ready": true,
          "logging": true
        },
        "fire": {
          "enabled": true,
          "ready": true,
          "torchRules": 2
        },
        "foraging": {
          "enabled": true,
          "ready": true
        },
        "freshwater": {
          "enabled": true,
          "ready": true,
          "canteen": true,
          "meals": true
        },
        "artisan": {
          "enabled": true,
          "ready": true
        },
        "workshop": {
          "enabled": true,
          "ready": true
        },
        "attributes": {
          "enabled": true,
          "ready": true
        },
        "companionCreation": {
          "enabled": true,
          "ready": true,
          "pending": 0
        },
        "companionPairing": {
          "enabled": true,
          "ready": true
        },
        "companionPresence": {
          "enabled": false,
          "ready": false,
          "bodies": 0,
          "pending": 0
        },
        "world": {
          "id": "marea-negra",
          "ready": true,
          "failed": false,
          "version": 9233,
          "errors": 0
        }
      },
      "net": {
        "fill": 0,
        "late": 0,
        "trimmed": 0,
        "clamped": 0,
        "kbOut": 0,
        "kbIn": 0,
        "dropped": 0
      }
    },
    "live_ok": true,
    "generated": "2026-10-16T00:43:22.460Z",
    "sources": {
      "roadmap": "C:/DEV/real of trade/ROADMAP.md",
      "now_files": [
        "C:/DEV/real of trade/area15-resource-live/context/NOW.md"
      ],
      "status_url": "https://marea.62.171.136.148.sslip.io/status"
    }
  },
  "milestones": [
    {
      "id": "m2-5",
      "label": "M2.5",
      "order": 1,
      "goal": "Prueba de Fuego: bullet hell in La Caldera, boss",
      "status": "done",
      "status_text": "done",
      "evidence": "PLAN-M3.md:5"
    },
    {
      "id": "m3",
      "label": "M3",
      "order": 2,
      "goal": "5 waves, Cangrejo mortero, HELLFIRE 3 phases",
      "status": "done",
      "status_text": "done",
      "evidence": "PLAN-M3.5.md:5"
    },
    {
      "id": "m3-5",
      "label": "M3.5",
      "order": 3,
      "goal": "Combate V2 (cursor, reflejo, guardia, armas); Bucanero extension 2026-10-11",
      "status": "done",
      "status_text": "done, extension live",
      "evidence": "PLAN-M3.6.md:5; HANDOFF 248-259"
    },
    {
      "id": "m3-6",
      "label": "M3.6",
      "order": 4,
      "goal": "Real Node server, 2 to 4 pirates",
      "status": "done",
      "status_text": "done",
      "evidence": "PLAN-M4.md:5"
    },
    {
      "id": "m4",
      "label": "M4",
      "order": 5,
      "goal": "El botín: equipment, loot, mastery, missions, saves, Mareas",
      "status": "done",
      "status_text": "done",
      "evidence": "PLAN-M4.5.md:5"
    },
    {
      "id": "m4-5",
      "label": "M4.5",
      "order": 6,
      "goal": "Sin ley: Cala Calavera, PvP",
      "status": "done",
      "status_text": "done",
      "evidence": "PLAN-M4.6.md:5"
    },
    {
      "id": "m4-6",
      "label": "M4.6",
      "order": 7,
      "goal": "Tinta: horizontal mobile, comic pass",
      "status": "done",
      "status_text": "done",
      "evidence": "PLAN-M4.7.md:5"
    },
    {
      "id": "m4-7",
      "label": "M4.7",
      "order": 8,
      "goal": "Tatuajes: Tromba, Abordaje, Timón",
      "status": "done",
      "status_text": "done, P1 author review open",
      "evidence": "HANDOFF 1723-1736"
    },
    {
      "id": "m4-8",
      "label": "M4.8",
      "order": 9,
      "goal": "Perlas negras",
      "status": "partial",
      "status_text": "partial: rc.1, physical acceptance and publication pending",
      "evidence": "PLAN-M4.8.md:3-4; PLAN-DELIVERY 1119"
    },
    {
      "id": "m5",
      "label": "M5",
      "order": 10,
      "goal": "Mundo persistente: storage, accounts, ground, pearls",
      "status": "partial",
      "status_text": "partial: D07/D09 base real; AREA15 public mount off",
      "evidence": "PLAN-DELIVERY 1123, 1125; HANDOFF 138-153"
    },
    {
      "id": "m6",
      "label": "M6",
      "order": 11,
      "goal": "La Balsa: the ship is the home (raft, deck, editor, handling, refuge)",
      "status": "partial",
      "status_text": "partial: D04-D05 local; RNV01-08a live",
      "evidence": "PLAN-DELIVERY 1120-1121, 1124; HANDOFF 436-445"
    },
    {
      "id": "m7",
      "label": "M7",
      "order": 12,
      "goal": "Mercaderes: trade between towns",
      "status": "partial",
      "status_text": "partial: D06a accepted locally",
      "evidence": "PLAN-M7.md:6-8; PLAN-DELIVERY 1122"
    },
    {
      "id": "m8",
      "label": "M8",
      "order": 13,
      "goal": "Ladrillo y brea: building",
      "status": "not-started",
      "status_text": "not started",
      "evidence": "PLAN-DELIVERY 1129-1130; PLAN-M8.md:8"
    }
  ],
  "areas": [
    {
      "id": "area15-resource-live",
      "code": "AREA15",
      "name": "Ground and pearls",
      "milestone": "M5",
      "roadmap_row": "AREA15",
      "image": "img/area15-ground-pearls.webp",
      "purpose": "What the player picks up from the ground, crafts, drops and loses on death, and the pearls that circulate as money. The persistent world: the server owns resources and crafting.",
      "first_message": "area15, continue",
      "order": 1,
      "title": "ground and pearls (M5)",
      "worktree": "area15-resource-live",
      "branch": "codex/area15-resource-live",
      "last_commit": "2026-10-13",
      "plan_docs": [
        "PLAN-M5.md",
        "docs/CONTINUITY-MATRIX.md"
      ],
      "objective": "resource and crafting authority, SQL018/019, pearl start and circulation, death and loot, drop/give with receipt, swallow (46902fe)",
      "state": "code published, public common mount off",
      "next": "full kill/chest candidate; composition with GM, companions, bots, torches; VPS canary (HANDOFF 150-153)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "T-1015-19",
      "updated": "2026-10-15",
      "now": {
        "ticket": "T-1015-19",
        "updated": "2026-10-15",
        "goal": [
          "Complete the candidate full kill/cofre operation, including reward, XP/missions, and RNG before durable intent.",
          "Then compose active features and close stopped adoption plus authenticated VPS canary in the documented order."
        ],
        "state": [
          "Ground swallow code was published in 46902fe, alpha.67/protocol 60; the later VPS revision is 5ad1029, alpha.68/protocol 61, with integration checks recorded. (HANDOFF:46-51)",
          "Common Ground mounts remain off; presence is also off, so published code and checks do not mean public gameplay activation. (HANDOFF:48-51)",
          "Resource/crafting M5 is live on a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98, alpha.23/protocol 36, with SQL015 and its economic/resource flags active. (HANDOFF:789-794)"
        ],
        "next": [
          "Complete the full kill/cofre candidate, covering reward, XP/missions, RNG, and the interval before durable intent. (HANDOFF:49-50; docs/delivery/m5-ground-pearl-swallow.md:130-134)",
          "Compose active GM resources/pointer, companion pairing/control/budget, bots, autonomous routes, and torches/resin/coconut; retain guards and resolve bot admission/configuration. (CONTINUITY-MATRIX:53-65; HANDOFF:49-51)",
          "Run stopped transition/adoption with the legacy writer and updater excluded; preflight legacy ground and define a separate contract if SQL023 v1 rejects non-empty ground. (CONTINUITY-MATRIX:66-68)",
          "Perform the authenticated VPS canary for one authority, restart/failure, and re-entry without duplicates. (CONTINUITY-MATRIX:66-70; HANDOFF:49-50)"
        ],
        "open": [
          "Which explicit bot admission policy and configuration should the transition use, given the zero-bot pilot and three bots on the observed VPS? (CONTINUITY-MATRIX:64-65)",
          "What price, payment, and UI contract should govern a future player-to-player pearl sale? (CONTINUITY-MATRIX:34; HANDOFF:242-243)"
        ]
      },
      "tasks": [
        {
          "id": "area15-resource-live__01",
          "area": "area15-resource-live",
          "n": 1,
          "title": "Complete the full kill/cofre candidate, covering reward, XP/missions, RNG, and the interval before durable intent. (HANDOFF:49-50; docs/delivery/m5-ground-pearl-swallow.md:130-134)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "area15-resource-live__02",
          "area": "area15-resource-live",
          "n": 2,
          "title": "Compose active GM resources/pointer, companion pairing/control/budget, bots, autonomous routes, and torches/resin/coconut; retain guards and resolve bot admission/configuration. (CONTINUITY-MATRIX:53-65; HANDOFF:49-51)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "area15-resource-live__03",
          "area": "area15-resource-live",
          "n": 3,
          "title": "Run stopped transition/adoption with the legacy writer and updater excluded; preflight legacy ground and define a separate contract if SQL023 v1 rejects non-empty ground. (CONTINUITY-MATRIX:66-68)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "area15-resource-live__04",
          "area": "area15-resource-live",
          "n": 4,
          "title": "Perform the authenticated VPS canary for one authority, restart/failure, and re-entry without duplicates. (CONTINUITY-MATRIX:66-70; HANDOFF:49-50)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "area17-market",
      "code": "AREA17",
      "name": "Agents and companions",
      "milestone": "",
      "roadmap_row": "AREA17",
      "image": "img/area17-agents-companions.webp",
      "purpose": "Non-player characters with a mind of their own: the agent market, the durable companions that pair with you, and the safe presence of their mind in the world.",
      "first_message": "area17, continue",
      "order": 2,
      "title": "agents and companions",
      "worktree": "area17-market",
      "branch": "codex/area17-market",
      "last_commit": "2026-10-13",
      "plan_docs": [
        "PLAN-EXTRA-LLM.md",
        "briefs/l03g-companion-presence.md"
      ],
      "objective": "L06b agent market and trade (SQL017), L03d inference center, L03e durable companions, L03f pairing, L03g-a safe presence (SQL039)",
      "state": "in progress, presence off",
      "next": "SQL039 canary and flag; L03g-b mind in the same body (HANDOFF 120-122)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "area17-market__01",
          "area": "area17-market",
          "n": 1,
          "title": "SQL039 canary and flag",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "area17-market__02",
          "area": "area17-market",
          "n": 2,
          "title": "L03g-b mind in the same body (HANDOFF 120-122)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "area07-pilot",
      "code": "AREA07",
      "name": "Naval refuge and A0 region",
      "milestone": "M6",
      "roadmap_row": "AREA07",
      "image": "img/area07-naval-refuge.webp",
      "purpose": "The raft as home: sailing, pilotage, anchoring in a refuge, and the first region of the world (A0) with Puerto Sol as its physical anchor.",
      "first_message": "area07, continue",
      "order": 3,
      "title": "naval refuge and A0 region",
      "worktree": "area07-pilot",
      "branch": "codex/area07-pilot",
      "last_commit": "2026-10-13",
      "plan_docs": [
        "PLAN-M6.md (Continuidad AREA07)",
        "briefs/area07-naval-action-plan.md",
        "PLAN-REGION-INICIAL.md"
      ],
      "objective": "RNV01-RNV08a (alpha.50), PRG02a/b pilotage, A0-G1 survey",
      "state": "live to RNV08a",
      "next": "GM06a contract and prototype, then A0-G2/A3; Puerto Sol physical anchors (HANDOFF 78-80)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "area07-pilot__01",
          "area": "area07-pilot",
          "n": 1,
          "title": "GM06a contract and prototype, then A0-G2/A3",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "area07-pilot__02",
          "area": "area07-pilot",
          "n": 2,
          "title": "Puerto Sol physical anchors (HANDOFF 78-80)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "prg01c-artisan",
      "code": "AREA03",
      "name": "Progression and inventory",
      "milestone": "",
      "roadmap_row": "AREA03",
      "image": "img/area03-progression-inventory.webp",
      "purpose": "How the character grows and what it carries: logging, load, backpacks, food and grog, artisan recipes and the teaching of trades.",
      "first_message": "area03, continue",
      "order": 4,
      "title": "progression and inventory",
      "worktree": "prg01c-artisan",
      "branch": "codex/prg01c-artisan",
      "last_commit": "2026-10-13",
      "plan_docs": [
        "PLAN-PROGRESSION.md",
        "briefs/plant-fiber-thatch-leather.md"
      ],
      "objective": "PRG01b2 logging, PRG01d (SQL026), INV02b-d carga, food and INV03 backpacks (a21c47f), SRV02 grog (SQL035)",
      "state": "live; PRG01c artisan teaching off",
      "next": "backpacks; lime and herbs; fibre, thatch and leather recipes undefined (HANDOFF 133-137)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "prg01c-artisan__01",
          "area": "prg01c-artisan",
          "n": 1,
          "title": "backpacks",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "prg01c-artisan__02",
          "area": "prg01c-artisan",
          "n": 2,
          "title": "lime and herbs",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "prg01c-artisan__03",
          "area": "prg01c-artisan",
          "n": 3,
          "title": "fibre, thatch and leather recipes undefined (HANDOFF 133-137)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "gm-editor-first",
      "code": "AREA01",
      "name": "GM editor",
      "milestone": "",
      "roadmap_row": "AREA01",
      "image": "img/area01-gm-editor.webp",
      "purpose": "The game master's table: sculpt and paint terrain, place and publish resources, templates and scatter, and the coming Skill Studio for authoring skills.",
      "first_message": "area01, continue",
      "order": 5,
      "title": "GM editor",
      "worktree": "gm-editor-first",
      "branch": "codex/gm-editor-first",
      "last_commit": "2026-10-12",
      "plan_docs": [
        "PLAN-GM-EDITOR.md"
      ],
      "objective": "GM03a to GM05b: remote drafts, publish, multiselect, templates, scatter, functional resources (SQL036), sculpt, paint",
      "state": "live through GM05b",
      "next": "Skill Studio (briefs/skill-studio-vision.md); GM06a coast and bounds",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "gm-editor-first__01",
          "area": "gm-editor-first",
          "n": 1,
          "title": "Skill Studio (briefs/skill-studio-vision.md)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "gm-editor-first__02",
          "area": "gm-editor-first",
          "n": 2,
          "title": "GM06a coast and bounds",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "character-slots",
      "code": "CH01",
      "name": "Character slots",
      "milestone": "",
      "roadmap_row": "CH01",
      "image": "img/ch01-character-slots.webp",
      "purpose": "Three characters per account: the account owner split from the profile, and a presence lock so one account cannot enter twice.",
      "first_message": "ch01, continue",
      "order": 6,
      "title": "character slots",
      "worktree": "character-slots",
      "branch": "codex/character-slots",
      "last_commit": "2026-10-13",
      "plan_docs": [
        "briefs/CH01-character-slots.md"
      ],
      "objective": "three slots per account, auth owner split from profile, presence lock on the account",
      "state": "live (alpha.70), needs SQL038 ready",
      "next": "none stated",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "character-slots__01",
          "area": "character-slots",
          "n": 1,
          "title": "none stated",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "buccaneer-character",
      "code": "BUCANERO",
      "name": "Bucanero",
      "milestone": "M3.5",
      "roadmap_row": "Bucanero",
      "image": "img/bucanero.webp",
      "purpose": "The game's own playable fighter: the model, the hit reaction and the recoil. Balance and real-machine FPS are still to be accepted.",
      "first_message": "bucanero, continue",
      "order": 7,
      "title": "",
      "worktree": "buccaneer-character",
      "branch": "codex/buccaneer-character",
      "last_commit": "2026-10-11",
      "plan_docs": [
        "PLAN-M3.5.md extension",
        "briefs/buccaneer-combat-reaction.md"
      ],
      "objective": "own Bucanero (alpha.52) to hit reaction and recoil (alpha.62)",
      "state": "live",
      "next": "balance, physical FPS (HANDOFF 259)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "buccaneer-character__01",
          "area": "buccaneer-character",
          "n": 1,
          "title": "balance, physical FPS (HANDOFF 259)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "st01b-niagara",
      "code": "ST01B",
      "name": "Niagara library",
      "milestone": "",
      "roadmap_row": "ST01b",
      "image": "img/st01b-niagara-library.webp",
      "purpose": "A catalogue of the Niagara particle effects (fire, smoke, sparks) censused from the Unreal sources: components and views to choose what to port into the game.",
      "first_message": "st01b, continue",
      "order": 8,
      "title": "Niagara library",
      "worktree": "st01b-niagara",
      "branch": "codex/st01b-niagara",
      "last_commit": "2026-10-12",
      "plan_docs": [
        "briefs/st01b-niagara-library.md"
      ],
      "objective": "census 993 sources, 15 components, 17 views; alpha.66, protocol 60",
      "state": "live",
      "next": "ST01c adaptation; Workshop UI",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "st01b-niagara__01",
          "area": "st01b-niagara",
          "n": 1,
          "title": "ST01c adaptation",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "st01b-niagara__02",
          "area": "st01b-niagara",
          "n": 2,
          "title": "Workshop UI",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "st01c-native",
      "code": "ST01C",
      "name": "Niagara native",
      "milestone": "",
      "roadmap_row": "ST01c",
      "image": "img/st01c-niagara-native.webp",
      "purpose": "The lab that extracts one Niagara effect into native sprite sheets for the web engine, with measured fidelity (material, DepthFade, Filmic) and a lossless WebP atlas.",
      "first_message": "st01c, continue",
      "order": 9,
      "title": "Niagara native",
      "worktree": "st01c-native",
      "branch": "codex/st01c-native",
      "last_commit": "2026-10-14",
      "plan_docs": [
        "briefs/st01c-niagara-native-fidelity.md",
        "briefs/niagara-reusable-pipeline.md"
      ],
      "objective": "extraction pilot NS_Flame_Single; material, DepthFade and Filmic labs; lossless WebP atlas -59.64%",
      "state": "in progress, lab only, no runtime",
      "next": "GPU texture compression; physical FPS, compositor and Workshop UI not accepted (HANDOFF 8-10)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "st01c-native__01",
          "area": "st01c-native",
          "n": 1,
          "title": "GPU texture compression",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        },
        {
          "id": "st01c-native__02",
          "area": "st01c-native",
          "n": 2,
          "title": "physical FPS, compositor and Workshop UI not accepted (HANDOFF 8-10)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "item-models-release",
      "code": "ITEMS",
      "name": "Items art",
      "milestone": "",
      "roadmap_row": "Items art",
      "image": "img/items-art.webp",
      "purpose": "The 3D models of the world's objects (torch, logs, crates) as author GLBs with WebP derivatives, ready to be picked up in the game.",
      "first_message": "items, continue",
      "order": 10,
      "title": "",
      "worktree": "item-models-release",
      "branch": "codex/item-models-release",
      "last_commit": "2026-10-13",
      "plan_docs": [
        "delivery/item-models-v1",
        "delivery/pickup-wood-uv"
      ],
      "objective": "12 author GLBs and 24 WebP derivatives, torch, collectible logs UV (alpha.69)",
      "state": "live",
      "next": "none stated",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "item-models-release__01",
          "area": "item-models-release",
          "n": 1,
          "title": "none stated",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "asset-index",
      "code": "ASSETS",
      "name": "Asset protocol",
      "milestone": "",
      "roadmap_row": "Asset protocol",
      "image": "img/asset-protocol.webp",
      "purpose": "The rules for naming, placing and registering every art asset, the generated ARTE-Y-MODELOS index, and the ratchet that stops the mess from growing back.",
      "first_message": "assets, continue",
      "order": 11,
      "title": "",
      "worktree": "asset-index",
      "branch": "claude/asset-index",
      "last_commit": "2026-10-14 (equals the integrated tip 32d8ecd)",
      "plan_docs": [
        "docs/art/PROTOCOLO.md"
      ],
      "objective": "protocol, generated index, ratchet baseline",
      "state": "merged, no HANDOFF entry",
      "next": "confirm live after the push (context/ops/push.md)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "asset-index__01",
          "area": "asset-index",
          "n": 1,
          "title": "confirm live after the push (context/ops/push.md)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "area12-i18n",
      "code": "AREA12",
      "name": "I18N",
      "milestone": "",
      "roadmap_row": "AREA12",
      "image": "img/area12-i18n.webp",
      "purpose": "The game's texts in Spanish and English: the language selector and the promotion of pending keys to both languages.",
      "first_message": "area12, continue",
      "order": 12,
      "title": "I18N (no worktree)",
      "worktree": "",
      "branch": "",
      "last_commit": "",
      "plan_docs": [
        "PLAN-I18N.md"
      ],
      "objective": "selector, I18N04b (alpha.35)",
      "state": "live",
      "next": "I18N04c ES/EN promotion (HANDOFF 748)",
      "status": "not-started",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "area12-i18n__01",
          "area": "area12-i18n",
          "n": 1,
          "title": "I18N04c ES/EN promotion (HANDOFF 748)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "web3-w0x",
      "code": "WEB3",
      "name": "Web3 W0x",
      "milestone": "",
      "roadmap_row": "Web3",
      "image": "img/web3.webp",
      "purpose": "An on-chain asset registry (Polygon Amoy) and the equipment rules tied to it. Nothing is live; it is a direction for the modular workshop.",
      "first_message": "web3, continue",
      "order": 13,
      "title": "W0x (no worktree)",
      "worktree": "",
      "branch": "",
      "last_commit": "",
      "plan_docs": [
        "PLAN-WEB3.md"
      ],
      "objective": "W01 asset registry local, Polygon PoS Amoy chosen, W00a equipment rules",
      "state": "nothing live",
      "next": "W05 modular workshop direction",
      "status": "not-started",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "web3-w0x__01",
          "area": "web3-w0x",
          "n": 1,
          "title": "W05 modular workshop direction",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "region-a0-a8",
      "code": "REGION",
      "name": "A0 to A8 region",
      "milestone": "",
      "roadmap_row": "A0 to A8",
      "image": "img/region-a0-a8.webp",
      "purpose": "The plan for the initial world: regions A0 to A8, of which only the A0 survey exists. No code yet; it waits for the GM editor (GM06a).",
      "first_message": "region, continue",
      "order": 14,
      "title": "region (no worktree)",
      "worktree": "",
      "branch": "",
      "last_commit": "",
      "plan_docs": [
        "PLAN-REGION-INICIAL.md",
        "PLAN-ALFA-MUNDO.md"
      ],
      "objective": "plan and A0-G1 survey only",
      "state": "no code",
      "next": "A0-G2 after GM06a",
      "status": "not-started",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "region-a0-a8__01",
          "area": "region-a0-a8",
          "n": 1,
          "title": "A0-G2 after GM06a",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "inv02-baseline",
      "code": "INV02",
      "name": "inv02 baseline",
      "milestone": "",
      "roadmap_row": "inv02-baseline",
      "image": "img/inv02-baseline.webp",
      "purpose": "An old snapshot of the code kept as the baseline for comparing test failures. Nobody works here; it is only compared against.",
      "first_message": "inv02, continue",
      "order": 15,
      "title": "",
      "worktree": "inv02-baseline",
      "branch": "",
      "last_commit": "2026-10-11",
      "plan_docs": [],
      "objective": "old snapshot",
      "state": "baseline for test comparisons",
      "next": "retire or keep as baseline (author)",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": [
        {
          "id": "inv02-baseline__01",
          "area": "inv02-baseline",
          "n": 1,
          "title": "retire or keep as baseline (author)",
          "status": "open",
          "ticket": "",
          "started": "",
          "finished": "",
          "note": ""
        }
      ]
    },
    {
      "id": "realms-of-trade-server",
      "code": "DESK",
      "name": "Main desk",
      "milestone": "",
      "roadmap_row": "realms-of-trade-server",
      "image": "img/server-desk.webp",
      "purpose": "The main checkout on loving-lovelace: a shared desk hundreds of commits behind. Never commit from it; the work lives in the worktrees.",
      "first_message": "desk, continue",
      "order": 16,
      "title": "",
      "worktree": "realms-of-trade-server",
      "branch": "claude/loving-lovelace-ptbif7",
      "last_commit": "2026-10-13",
      "plan_docs": [],
      "objective": "stale desk",
      "state": "never commit from it",
      "next": "",
      "status": "idle",
      "today": false,
      "images": [],
      "last_ticket": "",
      "updated": "",
      "now": null,
      "tasks": []
    }
  ],
  "tasks": [
    {
      "id": "area15-resource-live__01",
      "area": "area15-resource-live",
      "n": 1,
      "title": "Complete the full kill/cofre candidate, covering reward, XP/missions, RNG, and the interval before durable intent. (HANDOFF:49-50; docs/delivery/m5-ground-pearl-swallow.md:130-134)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area15-resource-live__02",
      "area": "area15-resource-live",
      "n": 2,
      "title": "Compose active GM resources/pointer, companion pairing/control/budget, bots, autonomous routes, and torches/resin/coconut; retain guards and resolve bot admission/configuration. (CONTINUITY-MATRIX:53-65; HANDOFF:49-51)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area15-resource-live__03",
      "area": "area15-resource-live",
      "n": 3,
      "title": "Run stopped transition/adoption with the legacy writer and updater excluded; preflight legacy ground and define a separate contract if SQL023 v1 rejects non-empty ground. (CONTINUITY-MATRIX:66-68)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area15-resource-live__04",
      "area": "area15-resource-live",
      "n": 4,
      "title": "Perform the authenticated VPS canary for one authority, restart/failure, and re-entry without duplicates. (CONTINUITY-MATRIX:66-70; HANDOFF:49-50)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area17-market__01",
      "area": "area17-market",
      "n": 1,
      "title": "SQL039 canary and flag",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area17-market__02",
      "area": "area17-market",
      "n": 2,
      "title": "L03g-b mind in the same body (HANDOFF 120-122)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area07-pilot__01",
      "area": "area07-pilot",
      "n": 1,
      "title": "GM06a contract and prototype, then A0-G2/A3",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area07-pilot__02",
      "area": "area07-pilot",
      "n": 2,
      "title": "Puerto Sol physical anchors (HANDOFF 78-80)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "prg01c-artisan__01",
      "area": "prg01c-artisan",
      "n": 1,
      "title": "backpacks",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "prg01c-artisan__02",
      "area": "prg01c-artisan",
      "n": 2,
      "title": "lime and herbs",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "prg01c-artisan__03",
      "area": "prg01c-artisan",
      "n": 3,
      "title": "fibre, thatch and leather recipes undefined (HANDOFF 133-137)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "gm-editor-first__01",
      "area": "gm-editor-first",
      "n": 1,
      "title": "Skill Studio (briefs/skill-studio-vision.md)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "gm-editor-first__02",
      "area": "gm-editor-first",
      "n": 2,
      "title": "GM06a coast and bounds",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "character-slots__01",
      "area": "character-slots",
      "n": 1,
      "title": "none stated",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "buccaneer-character__01",
      "area": "buccaneer-character",
      "n": 1,
      "title": "balance, physical FPS (HANDOFF 259)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "st01b-niagara__01",
      "area": "st01b-niagara",
      "n": 1,
      "title": "ST01c adaptation",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "st01b-niagara__02",
      "area": "st01b-niagara",
      "n": 2,
      "title": "Workshop UI",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "st01c-native__01",
      "area": "st01c-native",
      "n": 1,
      "title": "GPU texture compression",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "st01c-native__02",
      "area": "st01c-native",
      "n": 2,
      "title": "physical FPS, compositor and Workshop UI not accepted (HANDOFF 8-10)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "item-models-release__01",
      "area": "item-models-release",
      "n": 1,
      "title": "none stated",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "asset-index__01",
      "area": "asset-index",
      "n": 1,
      "title": "confirm live after the push (context/ops/push.md)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "area12-i18n__01",
      "area": "area12-i18n",
      "n": 1,
      "title": "I18N04c ES/EN promotion (HANDOFF 748)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "web3-w0x__01",
      "area": "web3-w0x",
      "n": 1,
      "title": "W05 modular workshop direction",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "region-a0-a8__01",
      "area": "region-a0-a8",
      "n": 1,
      "title": "A0-G2 after GM06a",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    },
    {
      "id": "inv02-baseline__01",
      "area": "inv02-baseline",
      "n": 1,
      "title": "retire or keep as baseline (author)",
      "status": "open",
      "ticket": "",
      "started": "",
      "finished": "",
      "note": ""
    }
  ]
};
