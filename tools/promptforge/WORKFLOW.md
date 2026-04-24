# PromptForge — Workflow Discipline

The rules below live OUTSIDE the script. They are non-negotiable. The script is a tool; this is the process.

---

## Per-task workflow

For every Claude Code task, run these steps in order. Do not skip. Do not stack two tasks into one Claude Code session.

### 1. Forge the prompt

```
forge "rough idea here"
```

The script prints three things:
- A git checkpoint command (top)
- The final prompt (middle, also on clipboard)
- A rollback command (bottom)

If you see a `⚠️ UNRESOLVED BLOCKERS` block above everything, stop. Read the blockers. Decide whether to proceed or re-forge with more context.

### 2. Git checkpoint

Run the git checkpoint command the script printed. Exactly as printed. Do not improvise.

### 3. Paste into Claude Code

Open Claude Code. Paste the prompt (already on your clipboard). Let it run.

### 4. When Claude Code finishes

It will print a 9-section final report. Do NOT commit yet.

Copy three things into separate clipboard buffers or notes:
- The ORIGINAL prompt you pasted in step 3
- Claude Code's FINAL 9-SECTION REPORT
- The output of `git diff HEAD~1`

### 5. Audit

```
forge --audit
```

Paste each of the three inputs when prompted. End each with Ctrl-D on a blank line.

### 6. Act on the verdict

- **PASS** → run the exact commit command the audit printed. Move on.
- **REVISE** → run `git reset --hard HEAD~1` (the audit prints the exact command). Re-forge or fix the prompt, then repeat from step 1.

### 7. Manual test

After commit, manually test:
- The flow you changed
- One or two adjacent flows the prompt's "regression surface" section called out

If anything is broken, roll back:

```
git reset --hard HEAD~1
```

---

## Validation commands to run after every Claude Code task

These are the five commands the prompt requires Claude Code to run. If Claude Code skipped any of them, the audit will catch it. You can also run them yourself to double-check:

```
cd ~/Life-Maintained
npx tsc --noEmit
npm run lint
npx expo-doctor
git diff --stat
git diff --check
```

---

## Handling a request to expand the file allowlist

If Claude Code stops and says "I need to edit files outside the allowlist," read its reasoning. Either:
- Approve the expanded list (type a response telling it to proceed with the new list), or
- Tell it to stop, re-forge the prompt with the correct scope.

Do NOT let Claude Code broaden scope silently.

---

## Handling the native/config flag

If Claude Code's final report says "Native/config flag: YES," that means it modified `app.json`, `eas.json`, `ios/`, or an Expo plugin config. You must:

1. Finish the normal audit + commit.
2. In a NEW Claude Code session with a fresh git checkpoint, run:

```
npx expo prebuild --no-install --platform ios
```

3. Commit the resulting ios/ diff as a separate commit.

Do NOT run prebuild as part of the same task. It touches too many files and will blow up the audit.

---

## One task = one Claude Code session

Do not stack multiple tasks in one Claude Code context window. Each task gets:
- Its own forge run
- Its own git checkpoint
- Its own Claude Code session
- Its own audit
- Its own commit

Stacked tasks defeat the audit and multiply regression risk.

---

## If `forge` or `forge-audit` fails

- **Anthropic API down** → check https://status.anthropic.com. If up, check credits at https://console.anthropic.com/settings/billing.
- **OpenAI API down** → check https://status.openai.com. If up, check credits at https://platform.openai.com/account/billing.
- **Script crashes with malformed output** → run with `--verbose` to see the raw API responses. Paste the error to Claude in a new chat for diagnosis.

---

## Model swap (when GPT-5.5 hits API, or a new Claude ships)

Open `promptforge.py` in a text editor. Edit the two lines at the top:

```
CLAUDE_MODEL = "claude-opus-4-7"
GPT_MODEL = "gpt-5.4"
```

Save. No other changes needed.
