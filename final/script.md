# AI-Kwau — Final Presentation Script
**Duration:** 10 minutes · **Language:** English · **Presenter:** Solo

---

## SLIDE 1 — Tunnel Vision `[0:00–0:15]`

*(aerial photo, dark vignette fills the frame — let it sit for 3 seconds before speaking)*

> "Ever looked through binoculars?
> That small circle of clarity.
> Everything else — just black.
>
> For most of us, it's a choice.
> We pick it up. We put it down."

---

## SLIDE 2 — Article (normal reading) `[0:15–0:28]`

> "One of our team members doesn't get that choice.
>
> He has glaucoma in one eye.
> And when he sits down to read — this is his screen."

---

## SLIDE 3 — Glaucoma Simulation `[0:28–0:55]`

*(advance to glaucoma overlay — pause 2 seconds)*

> "This simulation wasn't made by a designer.
> It was drawn from his own experience."

*(pause 2 seconds — let the image land)*

> "That's why we built AI-Kwau."

---

## SLIDE 4 — Low Vision in Taiwan `[0:55–1:15]`

> "According to Taiwan's Ministry of Health and Welfare —
> about 2 million people in Taiwan have low vision. That's 8% of the population.
> And 21% of them are under 50."

---

## SLIDE 5 — Top 5 Pain Points `[1:15–1:40]`

> "We surveyed Facebook groups for vision-impaired users.
> Eye strain. Small text. Low contrast. Lost cursor. Hidden links.
> Five problems. Every single day."

---

## SLIDE 6 — 60% Never Used Assistive Tools `[1:40–2:00]`

> "60% of vision-impaired PC users have never used assistive tools.
> Not high contrast. Not screen magnifiers.
> The tools exist — but people aren't using them."

---

## SLIDE 7 — Browser-Centric PC Usage `[2:05–2:20]`

> "70% of PC time happens in a browser.
> News, email, video, calls — all of it.
> That's where the problem lives. And that's where AI-Kwau works."

---

## SLIDE 8 — PC-Centric Usage `[2:20–2:35]`

> "And this happens on the device people use most.
> Reading, research, video calls — it all lives on the PC.
>
> The gap between what users need
> and what today's tools deliver is real — and it's wide."

---

## SLIDE 9 — Solution Concept `[2:35–2:55]`

> "AI-Kwau closes that gap with one core idea:
> track where the user is looking,
> understand what they need,
> and act — automatically.
>
> No buttons. No menus.
> The user just reads."

---

## SLIDE 10 — Active Perception Loop `[2:55–3:25]`

> "Under the hood, this runs as a three-stage perception loop.
>
> **Sense** — we capture gaze position and build a live heatmap
> of where the user has and hasn't looked.
>
> **Decide** — we detect a Focus Hold on a paragraph,
> or identify cold zones — areas the user has missed entirely.
>
> **Act** — we enhance text in the reading area,
> or surface a notification for overlooked content.
>
> This loop runs continuously, invisibly, entirely on-device —
> powered by the NPU in Intel Panther Lake."

---

## SLIDE 11 — User Journey `[3:25–3:50]`

> "The user journey is designed to be frictionless.
>
> Font Slider for immediate size control.
> High Contrast Themes — five options, live-applied with no page reload.
> Mouse-hover Mode for users who aren't ready for eye tracking.
> And then AI-Kwau's full gaze intelligence on top.
>
> Each layer adds value independently.
> Together, they adapt to how each individual user reads."

---

## SLIDE 12 — Capabilities Overview `[3:50–4:05]`

> "Three core capabilities:
> Mode Switcher — seamlessly toggle between mouse and webcam tracking.
> AI Summary — on-demand paragraph comprehension, one click.
> Blind-Area Notify — proactive alerts for content the user hasn't seen.
>
> Let's see them work."

---

## SLIDE 13 — Section Header: Reading Enhancements `[4:05–4:12]`

> "AI-Kwau — in action."

---

## SLIDE 14 — Eye Tracking Calibration `[4:12–4:45]`

> "First, calibration. Nine points, about 15 seconds.
>
> The webcam maps where your eyes land on screen.
> Once complete, the system tracks gaze to within roughly 50 pixels —
> precise enough for paragraph-level targeting.
>
> This is the only setup the user ever does."

---

## SLIDE 15 — Text Enhancement + AI Summary Demo `[4:45–6:00]`

*(play Video 1 — 15 seconds: L1 text enhancement)*

> "What you just saw:
> the user hovered over a paragraph for two seconds.
> AI-Kwau automatically bolded and darkened the text — that's L1 enhancement.
> No click, no shortcut.
> The paragraph they're reading becomes easier to read, instantly."

*(play Video 2 — 15 seconds: AI Summary click-to-reveal)*

> "When the AI summary is ready,
> a small tag appears at the top-right corner of the paragraph.
> One click — the full paragraph is replaced by three key bullet points,
> generated on-device by our language model in under a second.
>
> Click again — the original text is restored, exactly as it was.
>
> No cloud. No latency. No data leaving the device."

---

## SLIDE 16 — Transition `[6:00–6:05]`

*(brief pause — advance slide)*

---

## SLIDE 17 — Gaze Heatmap Verification `[6:05–6:50]`

> "This is the gaze heatmap in real time.
>
> Warm colors show where the user spent the most attention.
> Cold zones — these dark areas — are content they haven't physically seen.
>
> AI-Kwau detects interactive elements sitting inside those cold zones
> and highlights them with a subtle pulse —
> bringing missed content back into the user's awareness,
> without interrupting their reading flow.
>
> It's not just assistive. It's perceptive."

---

## SLIDE 18 — Transition `[6:50–6:55]`

*(advance — brief pause)*

---

## SLIDE 19 — Reading Time Results `[6:55–7:45]`

> "Does it actually help? We measured it.
>
> Same 1,000-word article. Same user. Three conditions.
>
> Baseline — no assistance: 4 minutes 12 seconds.
>
> With Bold and High Contrast: 2 minutes 37 seconds.
> That's 38% faster.
>
> With AI Summary: 1 minute 21 seconds.
> That's 68% faster.
>
> This isn't a marginal gain.
> This is reading a Wikipedia article in the time it used to take
> to read the first two paragraphs.
>
> And it runs on hardware that already ships in the laptop."

---

## SLIDE 20 — Curb-Cut Effect `[7:45–8:40]`

> "Here's where this becomes a platform opportunity, not just an accessibility feature.
>
> The Curb-Cut Effect — a principle from urban design.
> When cities built ramps for wheelchair users,
> cyclists, parents with strollers, and delivery workers all benefited.
>
> AI-Kwau is the same story.
>
> Screen glare on a sunny afternoon.
> Eye strain after four hours of back-to-back meetings.
> Skimming a 40-page report under a deadline.
>
> These are everyday situations for every PC user —
> not just the 20% with diagnosed vision impairment.
>
> We designed for the edge case.
> We built something every user will want."

---

## SLIDE 21 — Roadmap `[8:40–9:20]`

> "Where do we go from here?
>
> Immediate: native messaging host registration
> and end-to-end browser testing on Panther Lake hardware.
>
> Next: streaming inference for word-by-word summaries —
> so the user sees results as the model thinks,
> not after it finishes.
>
> Phase 2: Windows Accessibility API integration —
> moving AI-Kwau beyond the browser
> into the full desktop experience.
>
> The architecture is already designed for this.
> Panther Lake's NPU gives us the headroom to scale."

---

## SLIDE 22 — Closing `[9:20–10:00]`

> "We came into this project because one of us lives with this every day.
>
> We're leaving it with a working prototype —
> on-device, no cloud dependency, no special hardware —
> and results that speak for themselves."

*(pause — measured, deliberate)*

> "Most people get to choose when to look through a narrow lens.
> We built AI-Kwau for the millions who don't get that choice —
> and for the one teammate who does."

*(final beat)*

> **"See clearly. Understand instantly."**

---

## Timing Summary

| Slide | Topic | Time | Duration |
|-------|-------|------|----------|
| 1 | Tunnel Vision | 0:00 | 15s |
| 2 | Article (normal) | 0:15 | 13s |
| 3 | Glaucoma Simulation | 0:28 | 27s |
| 4 | AI-Kwau Cover | 0:55 | 20s |
| 5 | Prevalence Data | 1:15 | 25s |
| 6 | Pain Points Chart | 1:40 | 20s |
| 7 | Browser-Centric PC Usage | 2:05 | 15s |
| 8 | PC-Centric | 2:20 | 15s |
| 9 | Solution Concept | 2:35 | 20s |
| 10 | Perception Loop | 2:55 | 30s |
| 11 | User Journey | 3:25 | 25s |
| 12 | Capabilities | 3:50 | 15s |
| 13 | Section Header | 4:05 | 7s |
| 14 | Eye Calibration | 4:12 | 33s |
| 15 | Demo Videos 1 + 2 | 4:45 | 75s |
| 16 | Transition | 6:00 | 5s |
| 17 | Gaze Heatmap | 6:05 | 45s |
| 18 | Transition | 6:50 | 5s |
| 19 | Reading Results | 6:55 | 50s |
| 20 | Curb-Cut Effect | 7:45 | 55s |
| 21 | Roadmap | 8:40 | 40s |
| 22 | Closing | 9:20 | 40s |
| **Total** | | | **~10:00** |

---

## Key Numbers to Memorise

- **52.5M** — global glaucoma patients (2024)
- **25%** — under 50 years old
- **71%** — vision-impaired PC users report eye strain
- **38%** faster with Bold + High Contrast
- **68%** faster with AI Summary
- **< 1 second** — on-device inference latency (GPU: 0.85s)
- **1,000 words** — article length used in the test

---

## Delivery Notes

- **Slide 1–3:** Slow down deliberately. Silence before speaking on S1 lands harder than rushing in.
- **Slide 10 (Perception Loop):** Say "Sense, Decide, Act" with slight emphasis — it's the technical architecture in three words.
- **Slide 15 (Demo):** Don't narrate over the video while it plays. Let it run, then explain.
- **Slide 19 (Results):** Pause after each number. "4:12… 2:37… 1:21." The drops speak for themselves.
- **Slide 22 (Closing):** Drop pace to about 60% for the final three lines. Make every word count.
