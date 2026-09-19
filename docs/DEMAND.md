# Demand

**Status: no demand evidence exists yet.** No interviews, usability sessions, sign-ups, pilots or
real payments have taken place. Nothing in this repository should be read as evidence that anyone
wants this product. A testnet or fixture purchase proves mechanics, not demand.

## Hypothesis

Teams that integrate rebasing tokenised equities (lending and collateral protocols, wallets,
accounting and tax tools, index and data products, and the agents that serve them) need to know
when a multiplier changed, by how much, whether the chain agrees with the issuer, and what else
moved with it, and would rather buy a verified, machine-readable note than build the monitoring
themselves.

## Plan (before 22 September)

Five problem interviews and three usability sessions. Show two real signal cards from
`artifacts/recorded/` and one Brief. Ask, **before** showing the answer:

1. Which of these would you have paid $1 / $3 / $10 to receive, and why that one?
2. What comparable intelligence did you pay for, or spend meaningful time gathering, last month?
3. What do you use today instead? What does it cost you in time or money?
4. How quickly do you need it for it to be useful?
5. Would you consume it as JSON from software, and what would it plug into?

Evidence ladder, weakest to strongest: compliment → sign-up → asks for another example →
completes the workflow → names a paid substitute → commits to a pilot → pays real funds → buys again.

The three sections that follow expand this plan. **They are a plan, not results.** None of it
has been run, nobody has been contacted, and no answer to any question below exists. Where the
guide and the five questions above differ on price, ask the open question first and show the
$1 / $3 / $10 points only after the person has named a figure or declined to.

## Interview guide (plan, not results)

Five conversations, 25 to 30 minutes each. The subject is the person's last real problem, not
this product. Nothing about Bullseye is shown or described before question 9.

### Who to look for

People who have personally handled a reconciliation or corporate-action problem with tokenised
assets, recently enough to remember the details. Roles, not names:

- engineers on a wallet or portfolio tracker that shows balances of rebasing or multiplier-based
  tokens;
- engineers who run an indexer, a subgraph or a data pipeline that derives balances from
  `Transfer` events;
- accounting, tax, fund-administration or operations staff who close books that include
  tokenised assets;
- risk or protocol engineers at a lending or collateral venue that accepts tokenised assets;
- builders of agents, or of tooling for agents, that act on tokenised-asset data.

Aim for at least three different roles among the five. Leave out people with opinions about the
market and no such problem of their own, investors, and friends who will be polite. The owner
supplies the participants; nobody is contacted without his approval of the message.

### Opener

"I am trying to understand how people who work with tokenised assets deal with corporate actions
and reconciliation. I am not selling anything in this conversation and there are no right
answers. I would like to hear about the last time something like this actually happened to you.
May I take notes? I will write down your role, not your name, unless you tell me otherwise."

### Questions

1. Tell me about the last time a balance, a position or a record for a tokenised asset did not
   match what you expected. If that has not happened: the last corporate action (a dividend, a
   split, a rebase, a redemption) that touched something you run. What happened? And the time
   before that?
2. How did you find out? Who or what told you, and how long after the event?
3. What did you do next, step by step? Who else was involved?
4. How long was it from noticing to being confident the records were right?
5. What did it cost? Hours, money, a late close, a user complaint, a wrong price or a wrong
   liquidation. A rough figure is fine. "I do not know" is fine.
6. What do you use today to catch or check this kind of event? Tools, data vendors, scripts,
   people. What do you pay for any of it?
7. If someone handed you an answer about an event like that one, what form would you want it in?
   Let them answer before offering options.
8. What would it have to contain for you to rely on it without redoing the work yourself?

   Only now show one concrete output: one free event page and one Brief, on screen or as JSON,
   whichever matches their answer to question 7. Give them time to read. Say nothing about it.

9. Would you try this, as it is, on the next such event? What would you do with it first? Record
   their word: yes, no or unsure.
10. What would stop you? Then: what would you expect something like this to cost, who signs that
    off where you work, and how do you pay for data today?

If question 1 draws a blank on both halves, the person has no such problem. Thank them, record
a null result and stop. That is a result.

Allowed follow-ups: "what happened next?", "can you show me?", "why was that hard?", "how do you
know?". Not allowed: "would it help if…", "do you not think…", "would you pay $3 for this?",
describing the product before question 9, asking whether they like it. A compliment is the
weakest rung on the ladder: note it as a compliment and ask for the last real instance instead.

Close with: "Is there anyone else who deals with this whom I should talk to?"

## Usability session script (plan, not results)

Three observed buyers, 20 to 30 minutes each, on the public deployment. The buyer does the
tasks; the observer watches and writes.

### Before each session

- A Brief must be on sale: `GET /api/v1/catalog` lists at least one item. If none is, run tasks
  1 to 3 only and say so in the notes, or move the session.
- `GET /api/health` must show the payment rail on X Layer testnet, `eip155:1952`. If it ever
  shows anything else, do not run task 5.
- **A testnet wallet is set up beforehand** by the owner: a throwaway browser wallet with X Layer
  testnet added, holding at least 3 test USD₮0 from the X Layer faucet, used for nothing else.
  The participant uses that wallet. **Nobody is asked to use real funds**, their own wallet or
  their own keys, to install anything, or to type a seed phrase.
- The owner has completed one browser purchase on the deployment himself first. Until that has
  worked once, a failure in task 5 says nothing about the participant.
- Check that the deployed build has what the tasks need: an event page that shows both times
  (task 3), a delivered Brief with a JSON download (task 7), and a purchase that comes back after
  a reload (task 8). If one is missing, the deployment is behind the code. Deploy first, or drop
  that task and say so in the notes.
- Ask for consent to take notes, and separately for any screen recording. Record the role, not
  the name.

Say at the start: "I am testing the page, not you. Please think aloud. I will mostly not answer
questions, because I need to see where the page fails. This uses test tokens on a test network.
No real money is involved at any point."

### Tasks

1. **Understand one event from the free page.** "Here is a page. Take a minute, then tell me what
   happened to this asset."
2. **Say what is being sold.** "In your own words: what is being sold here, and to whom?"
3. **Happened versus detected.** "When did this event happen? When did this service first see
   it?"
4. **Get a quote.** "Find out what the full document would cost you and what you would get."
5. **Pay on testnet, or stop and say why.** "Go ahead with the test wallet, or stop and tell me
   why you would stop here." Stopping is a valid outcome. Record the reason in their words.
6. **Find the evidence behind one sentence.** "Pick one sentence in the Brief. Show me what it is
   based on."
7. **Download the JSON.** "Get this as a file your software could read."
8. **Recover after a reload.** "Reload the page. Get your Brief back without paying again."

### What to observe

The first thing they click. Time per task. The words they use for the product, the event and the
payment. Where they hesitate, scroll back or ask for help. Whether they notice the data-mode
label, the testnet label and "not revenue". Any moment they believe real money is at risk. Any
error the page shows and what they make of it. At the end, ask once: "At what point, if any,
would you have given up if I were not here?"

Observer rules: do not explain, do not point, do not defend the page. Answer a question with
"what would you expect?". Help only after the task has been written down as failed.

### What counts as a failure

- The task is not completed unaided within 3 minutes (5 minutes for task 5).
- The task is completed with the wrong understanding. Task 2: they describe a chatbot, trading
  signals or investment advice, or cannot say. Task 3: they give one time for both, or swap them.
  Task 6: they end somewhere that names no source, URL or fetch time.
- The observer had to step in.
- They say they would have given up.
- Critical, whatever else went well: they believe they have paid when they have not, or the
  reverse; they are offered a second payment in task 8 and would take it; they believe real
  funds are involved; they sign without being able to say the amount and the asset.

In task 5, a considered "I would stop here, because…" is not a failure of the participant. It
is the finding. A task failed by all three buyers is a fault in the page until shown otherwise.

## Recording template (plan, not results)

One block per conversation or session, filled in the same day, then one row in the results table
below. Keep the blocks in a private file, not in this repository, unless the person has agreed
to what is published.

```
Date:
Kind:                      interview | usability session
Role and segment:          (no name and no employer unless they consented to it; say which)
Consent:                   notes yes/no · recording yes/no · publication of role yes/no
What they do today:        (tools, vendors, scripts, people; what it costs them)
Last real instance:        (what happened, how they found out, how long, what it cost;
                            or "none": null result)
Verbatim quotes:           (only words actually said, in quotation marks, written down at the
                            time; otherwise leave empty)
Would try:                 yes | no | unsure   (their word, not an inference)
Price reaction:            (the figure they named before seeing a price; reaction to $1/$3/$10;
                            who signs off; how they pay for data today)
Blockers:                  (their words where possible)
Strongest rung reached:    (from the evidence ladder)
Usability only, per task:  1–8: done unaided | done with help | failed | stopped by choice |
                            not run; time; what was observed
Would have given up at:
Follow-up agreed:          (only if they offered)
```

## Rules for recording

- Record negative and null results. "No such problem", "would not try it" and "session did not
  happen" each get a row. An empty table is more honest than a selective one.
- Never paraphrase into a quote. Quotation marks are for words that were said and written down
  at the time. Everything else is a note, and reads as one.
- Never count a self-funded or testnet payment as a customer. A participant paying test tokens
  from a wallet the owner funded is a usability result. It is not revenue, not a customer and
  not demand. The ladder's "pays real funds" rung means their own real funds, by their own choice.
- "Would try" is a statement, not a behaviour. The rung is the behaviour that was observed.
- Do not count or average. Five conversations are five conversations: no percentages.
- Change the copy and the presentation before changing the product category. If people cannot
  say what is sold, fix the words first. The pivot rule below applies only when people who
  understood the offer valued a different event.
- Outreach needs the owner's approval, message by message, and the owner supplies the
  participants. Nobody is contacted on the project's behalf without it.
- No name, employer or contact detail goes into this repository without that person's consent.
- If the plan was not carried out, or only in part, say so here and in the submission, with the
  count that was done.

## Results

| Date | Who (role, segment) | Strongest rung reached | Signal type they valued | Substitute today | Notes |
| --- | --- | --- | --- | --- | --- |
| – | – | – | – | – | none recorded |

## Pivot rule

If interviews consistently value a different RWA event (reserve shortfall, oracle divergence,
trading halts, supply changes), replace the detector and the evidence toolbox. The signal schema,
budget governor, publication gate, order ledger, checkout and economics stay as they are.
