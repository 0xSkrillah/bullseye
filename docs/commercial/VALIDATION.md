# Validation kit

Scripts to run, and a results section that stays empty until real people have been observed.

> **RESULTS: NOT RUN.** No interview, usability session or outreach in this file has taken place.
> Nobody has been contacted. No participant has been recruited. My own judgement, and any
> role-play, simulation or persona exercise, is **not** demand evidence and must never be recorded
> below as though it were. `docs/DEMAND.md` remains correct: no demand evidence exists.

---

## 1. Problem interview — 15 minutes

Shorter than the 25–30 minute guide in `DEMAND.md`, for a first pass where the owner only has a
short slot. The long guide stays authoritative; this is the compressed version.

**Recruit:** anyone who closes books, reconciles positions or answers auditors for a portfolio that
includes tokenised equities or any rebasing token. Roles, not names. Exclude people with opinions
about tokenisation and no operational responsibility of their own.

**Opener.** "I am trying to understand how people handle corporate actions on tokenised assets. I
am not selling anything in this conversation. I would like to hear about the last time this
actually happened to you. May I take notes? I will record your role, not your name."

**Do not describe Bullseye before question 7.**

1. Walk me through your last close that included a tokenised asset. What did you have to reconcile?
2. Tell me about the last time a position changed and the transaction history did not explain it.
   What happened, and when was the time before that?
3. What did you do, step by step? Who else got involved?
4. How long did it take from noticing to being confident the number was right?
   *(This answer is the one input the value model needs and does not have.)*
5. What did you end up putting in the file as support? Who checks that file, and what have they
   asked you for?
6. What do you use today to catch or explain these — tools, vendors, scripts, people? What do you
   pay for any of it?
7. *(Now show one real Brief.)* Here is a document about one such event. Take a minute. What is it?
8. What would you do with it — and would it have saved you anything in the story you just told me?
9. What is missing that would stop you relying on it?
10. If you wanted this, would you want one per event, or everything that touched your book this
    quarter in one go?
    *(The per-event vs period-pack question. It decides the price unit.)*
11. Who in your organisation would decide to pay for something like this, and what do they usually
    say no to?

**Close.** "Anything I should have asked and did not?"

**Record all four outcomes, not just the good one:** wants it · indifferent · already solved ·
refuses. An "already solved" is the most valuable answer in the set.

---

## 2. Usability script — 10 minutes, no help given

Hand over `/market` on the deployed service. Say only: "Think aloud. I cannot help you."

**Unaided comprehension — ask before any prompting, and do not lead:**

1. Who is this for?
2. What happened here?
3. What exactly would you get if you paid?
4. Where would you use that?
5. What does it cost, and what are you paying with?
6. What can this *not* tell you?

**Then the task:** "Get to the point where you could buy the report, but do not pay."

Watch for, and write down verbatim:

- do they read the line naming who the screen is for, or scroll past it;
- do they understand the two error figures, or read them as the event size;
- does *No transactable opportunity* read as "this product found nothing" — **the specific
  regression this sprint set out to fix**, so it is the first thing to check;
- do they find the price and the network before clicking;
- at the quote, do they know what happens if payment fails;
- does anyone say "testnet" unprompted.

**Acceptance criterion, not a result:** 4 of 6 comprehension questions answered correctly and
unaided by 3 of 3 participants. **This has not been measured.**

---

## 3. Outreach draft — one role, not a blast

**Do not send without the owner's approval.** No list has been built and no address collected.

**To:** a fund accountant / reconciliation lead at a digital-asset fund administrator
**Subject:** the dividend that arrives with no transaction

> Hello [name],
>
> I am building a small thing for a specific irritation and I would rather be told it is not a real
> problem than keep guessing.
>
> Tokenised stocks pay dividends by changing a multiplier, so every holder's balance grows and no
> transaction is emitted. If you reconcile a book that holds any, the units move and there is
> nothing in the history to point at.
>
> I am not asking you to look at a product. I would like fifteen minutes on how you handled the last
> one — what you put in the file, and who asked you about it afterwards. If your subledger already
> does this properly, that is genuinely the most useful answer you could give me and I will say
> thank you and go away.
>
> [name], [role], [one line of context]

**Rules.** One role at a time. No attachment. No link on the first message. No "quick call to show
you". If they say it is already solved, ask who solves it and stop.

---

## 4. What was and was not tested tonight

| | |
|---|---|
| **Run, and green** | Typecheck (api + web); API suite **293 passed, 1 skipped (294)**; web suite **222 passed**; production build; Playwright browser suite — see `CHANGELOG.md` for the exact figure recorded after the change |
| **Run** | Live read of the deployed service: `/market`, `/api/signals` (15 events), `/api/market/sig_9045bfe981e2e6a0`; full read of delivered Brief `brf_7e0e3aabb79768ca` |
| **NOT run** | Any interview. Any usability session. Any outreach. Any screen-reader or axe pass. Any second browser engine. Any purchase against the changed build (the changed build is not deployed) |
| **NOT run** | Mobile-width check of the changed screens on a real device — the browser pane cannot emulate phone width in this environment; widths were checked by resizing only |
| **Cannot be tested here** | Whether anybody wants this |

---

## 5. Results

**NOT RUN.** Nothing to report. This section stays empty until a named human being has been in a
conversation, and it is filled in by whoever ran it — not by an agent.
