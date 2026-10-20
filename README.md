# Living Aquarium: A Biodiversity Awareness Dashboard
 
An interactive 3D aquarium that turns the decline of threatened fish species into something people can see, touch and help fix. It is built for a large public screen at Retort House, with a companion web app that lets visitors take part from their own phones.
 
The project has three goals:
 
1. **Inform**: show people, in a way they feel rather than read, that species are disappearing.
2. **Involve**: turn visitors into citizen scientists who spot, collect and customise fish.
3. **Fund**: show organisations exactly how big the biodiversity gap is, in percentages and dollars, and invite them to close it.
---
 
## The big idea
 
Most biodiversity data lives in reports and spreadsheets. This project puts it inside a tank. The fish on screen are real species, their numbers come from real population data, and the community's contributions visibly change the tank. When an organisation pledges money, the tank updates, so a contribution is something you can see.
 
The experience is two connected screens plus a phone app.
 
| Screen | What it shows | What it's for |
| --- | --- | --- |
| **Past / Present** | Threatened species swimming in a wilted tank, with historical population data | Awareness and education |
| **Future Goals** | The tank we could have, filled with community-contributed fish and the current top threatened species | Participation and funding |
| **Web app** (via QR code) | A personal Fish Dex, live camera feed, fish collection and customisation | Citizen science |
 
---
 
## User journey
 
```
Visitor enters Retort House
        │
        ▼
Giant screen / dashboard ──► Click a fish: species name, fun fact, "why you should care"
        │                    Scrub a one-year timeline: past, present, future goals
        ▼
Future Goals screen ──► Scan QR code ──► Web app
                                          │
                       ┌──────────────────┴──────────────────┐
                 Nothing collected yet                 Already collected
                       │                                      │
              Go near the buoy                                │
              Camera unlocks (live feed)                      │
              Collect a fish ──► added to Fish Dex            │
                       └──────────────────┬──────────────────┘
                                          ▼
                              Customise fish (colour, look)
                                          ▼
                              Upload to the Future Goals screen
                                          ▼
                     Tank updates: the visitor sees their fish on the big screen
                                          ▼
                       Organisations see the gap and pledge funding
```
 
---
 
## How it highlights biodiversity
 
### 1. Past / Present: an interactive species dashboard
 
Each fish in the tank is a real endangered species loaded from the database.
 
- **Click a fish** to dim the scene, spotlight the animal with a glow, and open a callout with the **species name**, a **fun fact**, and a **"why should you care"** line explaining the species' link to ecosystems and people.
- **Scrub the population chart** at the bottom of the screen. Dragging across the timeline highlights a month, shows the **percentage change from the first reading**, and **changes the spotlighted fish's opacity** in proportion to where that month's count sits in the species' historical range. As the population drops, the fish literally fades. A decline you can see lands harder than one you read.
- The tank itself tells the story. The kelp is **wilted and drooping** (a deliberately sparse, unhealthy habitat), so the mood of the scene matches the data.

### 2. Future Goals: the tank we could have
 
The Future Goals tank is a healthy, thriving environment: golden swaying kelp, rising bubbles, and a school of fish that grows as the community contributes. It also drives the dashboard's headline numbers:
 
- **Total Fish** and **Unique Species** currently in the tank.
- **Top 3 most threatened species**, each with a **▼ percentage** showing how far its current quantity falls short of the target population.
- A **restoration budget summary** (for example, "$X needed for restoration") with an ⓘ tooltip explaining how the number is calculated.
New fish appear in the tank **in real time** (Supabase realtime). Nobody needs to refresh the page. When a visitor uploads a fish from their phone, it swims in from the edge of the tank.
 
---
 
## How it prompts action
 
### Citizen scientists
 
The companion web app (opened by scanning a QR code on the Future Goals screen) turns visitors into contributors:
 
- **Fish Dex**: a personal collection of species the visitor has found.
- **Spot fish**: near the buoy, a **live camera feed** unlocks so visitors can find and collect fish.
- **Collect and customise**: collected fish can be given their own colours and look.
- **Upload to the dashboard**: the customised fish is added to the Future Goals tank and shows up on the big screen.
This creates a loop of repeated participation (collect, customise, upload, see your fish) and builds a community around the data. The contribution counts show **community participation as proof of momentum**, which also helps persuade funders.
 
### Companies and organisations
 
The dashboard is designed so a decision-maker can read the funding case in a few seconds:
 
1. **Quantity gap**: the difference between the *present* population and the *future goal* for the top 3 threatened species, shown as a **biodiversity deficit (%)**.
2. **Convert the gap into dollars**: deficit × cost per fish (breeding, habitat restoration, protection) gives the funding needed to bridge it.
3. **Pledge**: organisations are invited to pledge an amount toward closing the gap.
4. **Visible impact**: the tank updates after a contribution, so sponsors can see their effect on screen.
> **Demo note:** the prototype uses a flat target of 10 fish per species and a flat cost per fish. In a production system, each species would have its own restoration cost, set by marine scientists and informed by published recovery spending (government conservation budgets, species recovery programmes, and biodiversity-offset pricing).
 
---
 
## Tech overview
 
- **p5.js (WEBGL, instance mode)**: the 3D aquarium, with orbit camera, front/orbit view toggle, scroll-to-zoom, billboarded fish sprites, kelp and bubbles.
- **TypeScript**: the sketches and shared rendering utilities.
- **Supabase**: fish and species data, plus a realtime channel for newly uploaded fish.
- **Chart.js**: the draggable population-history chart (loaded globally as `window.Chart`).
- **Glass UI components**: frosted and holographic cards for the stat strip, callout and chart panel.

### Project structure (key files)
 
| File | Purpose |
| --- | --- |
| Future Goals sketch | Thriving tank, realtime fish arrivals, stat cards, restoration budget |
| Endangered Fish sketch | Past/Present tank, clickable fish, spotlight, callout, population chart |
| `common-functions.ts` | Shared camera, projection, kelp, fish, bubble and texture rendering |
| `aquarium-stats.css` | Layout and holographic styling for the stat strip |
| `../lib/supabase` | Data access and realtime subscription |
| `../components/glass-ui` | Shared frosted-glass styling helpers |
 
### Data model (as used by the sketches)
 
- **Endangered fish rows**: `id`, `species`, `fun_fact`, `why_care`, `image_url`, `population_history` (array of `{ month, count }`).
- **Community fish rows**: `id`, `image_url`, `outline` (the species name, used to group fish and calculate deficits).
---
 
## Controls
 
| Action | Result |
| --- | --- |
| Drag | Orbit the camera |
| Scroll | Zoom in and out |
| **FRONT VIEW / ORBIT VIEW** button | Switch between flat 2D and 3D |
| **FISH CLICK: ON / OFF** button | Toggle between selecting fish and orbiting |
| Click a fish | Spotlight it and open the callout and chart |
| Drag across the chart | Scrub through time and fade the fish with the population |
| Click anywhere outside the panels | Close the callout and chart |
 
---
 
## Running it
 
```bash
npm install
npm run dev
```
 
You'll need your Supabase project URL and anon key in your environment config (refer to .env.example), and Chart.js must be loaded globally in the layout.
 
---
 
## Why this matters
 
Threatened species rarely get attention until it's too late, partly because the problem feels abstract and the solution feels like someone else's job. This project tries to close both gaps:
 
- **For the public**, it makes the loss visible and gives them a small, real way to contribute.
- **For organisations**, it turns an abstract crisis into a clear number with a clear action: here is the gap, here is what it costs, and here is a tank that changes when you fund it.
 

