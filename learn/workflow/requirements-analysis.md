---
name: requirements-analysis
description: How to analyze workflow requirements before build — uncover true intent, then validate feasibility
---

## Requirements Analysis

Before building a workflow, understand what the user truly needs. Stated requirements often differ from the actual goal.

### Step 1: Uncover Intent

The most important step. Before checking any numbers, understand **why** the user wants this.

Ask questions like:
- What is the end goal? (e.g., "find investment opportunities" vs "produce a report for a client")
- Why these specific constraints? (e.g., "PER <= 15" — is this from research, a rule of thumb, or hearsay?)
- What would you do with the output? (reveals what actually matters)
- Are there constraints you haven't mentioned? (budget, timeline, geography)

Common patterns where stated requirements miss the real goal:
- **Wrong market**: user wants semiconductor value investing → Japanese market has no PER <= 15, but US market does
- **Wrong metric**: user heard "low PER is good" but their real concern is growth potential
- **Wrong scope**: user asks for 20 companies but only needs the top 3 for a presentation
- **Inherited spec**: user is repeating someone else's requirements without understanding the reasoning

The goal is to reconstruct the user's decision context — once you understand their situation, you can propose alternatives they haven't considered.

### Step 2: Validate Feasibility

With intent understood, check whether the specific criteria are achievable.

| Category | Example | Resolution |
|---|---|---|
| **Data mismatch** | "PER <= 15" but current market has no matches | Propose adjusted threshold OR different market/sector based on user's intent |
| **Tool limitation** | "Real-time stock prices" but only WebSearch available | Suggest library/API as programmatic step |
| **Logical contradiction** | "20+ companies" from a niche with 5 total | Reduce count or broaden scope |
| **Scope mismatch** | One step covers 3 days of expert work | Split into multiple steps |

Procedure:
1. Extract quantitative criteria — thresholds, counts, filters, constraints
2. Verify against real data — use WebSearch to spot-check whether criteria produce results
3. Identify tool requirements — does the task need APIs, libraries, or specific data sources?
4. Check logical consistency — do constraints conflict with each other?
5. **Define parameter ranges** — if a value will be parameterized, ask the user for the realistic range (e.g., "min_companies: usually 10-20, sometimes 100+"). This determines design choices (e.g., recursive `call` for very large collections vs a single agentic step with a strict schema) and test-run scenarios

### Step 3: Present and Confirm

For each concern, present:
- What the problem is (with evidence)
- Why it matters in the context of their intent
- Concrete alternatives (with trade-offs, informed by Step 1)

The user confirms, adjusts, or overrides → produce finalized requirements.

### When to Skip

If the user's intent is clear and requirements are purely structural (e.g., "build a pipeline that transforms CSV to JSON"), skip Step 1 and go straight to feasibility.
