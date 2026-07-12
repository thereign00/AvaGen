# How to update the app (2 minutes)

> ✅ Don't worry: your **API keys, avatars, channels and finished videos are NOT
> deleted** by an update. They live in a separate folder (`~/.faceless-studio`),
> not inside the app folder.

---

## If you installed from the ZIP (most people)

1. **Stop the app** — close the black Terminal/CMD window.
2. Go to the GitHub page → green **«Code»** button → **«Download ZIP»**:
   https://github.com/Bander4ik/Conveyer-Patrice
3. Unzip it and **replace your old app folder** with the new one
   (or just use the new folder from now on — either is fine).
4. Run the installer once:
   - **Mac:** double-click **`install.command`** *(if macOS blocks it: right-click → Open → Open)*
   - **Windows:** double-click **`install.bat`**
5. Start the app:
   - **Mac:** **`start.command`** · **Windows:** **`start.bat`**

## If you installed with git

```bash
cd <app folder>
git pull
```
Then start the app as usual (`start.command` / `start.bat`).

---

## How to check the update worked

Create any video, open its page and look at the **first line of the logs**:

```
Pipeline started (v0.2.0) · ...
```

If you see **`(v0.2.0)`** (or newer) — you're up to date. ✅
If the line has **no version number** — you are still on the old build; redo the steps above.
