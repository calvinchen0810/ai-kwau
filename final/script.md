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

## SLIDE 8 — Market Opportunity `[2:20–2:35]`

> "That's the opportunity —
> build for the browser, where users already are.
> Simple. Intuitive. Accessible."

---

## SLIDE 9 — User Feedback Leads to AI-Kwau `[2:40–3:00]`

> "Users said text wasn't clear enough.
> Font slider. High contrast.
> Then we asked: what if there were fewer words?
> AI summary.
> And for meetings: mouse-hover mode.
> Four features. All from user feedback."

---

## SLIDE 10 — Four Capabilities Overview `[3:00–3:15]`

> "Four capabilities. One clearer web.
> Text Enhancement. AI Summary. Blind-Area Notify. Mode Switcher.
> Let's see them in action."
>
> **Act** — we enhance text in the reading area,
> or surface a notification for overlooked content.
>
> This loop runs continuously, invisibly, entirely on-device —
> powered by the NPU in Intel Panther Lake."

---

## SLIDE 11 — Text Enhancement + AI Summary `[3:15–3:20]`

> "Starting with the first two — Text Enhancement and AI Summary."
>
> Each layer adds value independently.
> Together, they adapt to how each individual user reads."

---

## SLIDE 12 — One-time Gaze Calibration `[3:45–4:10]`

> "This happens once.
> 25 dots — look, click.
> 30 seconds later, AI-Kwau knows where your eyes are."

---

## SLIDE 13 — Eye Tracking Activation + Demo `[4:10–5:10]`

> "Start camera. AI-Kwau is watching."

*(play video)*

> "Two seconds on a paragraph — text enhances automatically.
> Summary ready — click the tag.
> Three bullet points. Under a second. Click again to go back."

---

## SLIDE 14 — Blind-Area Notify Section Intro `[5:10–5:15]`

> "Next — Blind-Area Notify."

---

## SLIDE 15 — Blind-Area Notify Demo `[5:15–5:45]`

*(play video)*

> "The user is reading — focused on the first paragraph.
> A menu button just outside their gaze goes unnoticed.
> AI-Kwau detects it's in a blind zone and highlights it with a pulse.
> The user sees it. Clicks. Menu opens."

---

## SLIDE 16 — Gaze Heatmap `[5:45–6:15]`

> "This is the gaze heatmap — it builds in real time as the user reads.
> Warm colors mark where their eyes actually went. Cold zones are areas they never saw.
> AI-Kwau finds interactive elements in cold zones and highlights them."

---

## SLIDE 17 — Transition `[6:50–6:55]`

*(advance — brief pause)*

---

## SLIDE 18 — Reading Time Results `[6:55–7:45]`

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

## SLIDE 19 — Curb-Cut Effect `[7:45–8:40]`

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

## SLIDE 20 — Roadmap `[8:40–9:20]`

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

## SLIDE 21 — Closing `[9:20–10:00]`

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
| 14 | Demo Videos 1 + 2 | 4:45 | 75s |
| 15 | Transition | 6:00 | 5s |
| 16 | Gaze Heatmap | 6:05 | 45s |
| 17 | Transition | 6:50 | 5s |
| 18 | Reading Results | 6:55 | 50s |
| 19 | Curb-Cut Effect | 7:45 | 55s |
| 20 | Roadmap | 8:40 | 40s |
| 21 | Closing | 9:20 | 40s |
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
