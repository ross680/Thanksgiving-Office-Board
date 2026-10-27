# 3R Thanksgiving Office TV

Static GitHub Pages slideshow for the office TV. Eight silent 15-second clips play in order, each through to the end, then the loop starts over.

The TV opens <https://ross680.github.io/Thanksgiving-Office-Board/>.

It follows the same full-screen board as the [Christmas Board](https://github.com/ross680/Christmas-Office-Board), the [Motivational Board](https://github.com/ross680/Motivational-Board), and the [Halloween Board](https://github.com/ross680/Halloween-Board): one stage, one reused `<video>` element, a thin progress bar, a screen wake lock, and a reload so a TV left on for weeks picks up changes. Clips live in `assets/clips/`.

## Publish on GitHub Pages

The page is a normal static site. It does not call the GitHub API.

1. Push this folder to `main`.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Branch: **main**. Folder: **/** (root).
5. Open <https://ross680.github.io/Thanksgiving-Office-Board/> on the TV browser.

Pages can take a minute after the push. The TV may keep the previous `index.html` for about 10 minutes. The board reloads itself 4 hours after it was opened, after the current clip finishes, and the reload URL carries a `bust` query so the TV fetches a fresh copy. If a clip never ends, a second timer reloads at about 4 hours 15 minutes anyway.

`.nojekyll` is in the repo so Pages serves the files as they are.

## Controls

Right arrow or Space: next · Left arrow: previous · P: pause · M: sound on/off · F: fullscreen

Clips start muted so Chrome and TV browsers allow autoplay. M, or the sound button, turns sound on. The clips in this set are silent.

Move the pointer to see the controls and the clip count (`3 / 8`). The pointer hides again after a few seconds still. The Thanksgiving chip stays in the corner. It counts calendar days to Thursday, November 26, 2026 in America/New_York, the same clock as the other boards, and it refreshes once a minute so the day flips at midnight Eastern. The day before it reads `1 DAY UNTIL THANKSGIVING`. On November 26 it reads `HAPPY THANKSGIVING FROM 3R`. After that it reads `THANK YOU FOR A GREAT YEAR`. A light falling-leaves effect sits over the picture. `?leaves=0` turns the leaves off.

## URL options

- `?reload=4` reloads 4 hours after the page opened (the default), after the current clip ends. `?reload=0` turns that scheduled reload, and the 4 hour 15 minute fallback, off. The board checks on a short timer, because some TV browsers drop one long timer.
- `?maxclip=60` is a hard cap per video, in seconds (default 60). A normal clip ends itself first.
- `?stall=8` skips a clip when playback time has not moved for 8 seconds (the default). The same skip happens on a media error, or on abort, emptied, or stalled once that clip is actually stuck.
- `?shuffle=1` randomizes the order when the page loads.
- `?slide=3` starts on that clip (1 is the first).
- `?date=2026-11-26` previews the countdown for that calendar day. `?date=2026-11-27` previews the message after Thanksgiving.
- `?leaves=0` turns the falling leaves off. Leaves are also hidden when the browser asks for reduced motion.
- `?fresh=1` loads a new page for every clip. Last resort for a TV that still leaks memory.
- `?debug=1` shows the clip name, uptime, page loads, and the last problem.

A clip that errors, or never produces a picture, is skipped. One bad file does not stop the board. Three failures in a row reload the page. If the network is down, the board keeps cycling whatever is already cached and does not reload into a dead page. When the network comes back it tries the current clip again. A failure reload will not repeat for 3 minutes, so a bad file cannot reboot the TV in a loop.

## Add or remove a clip

`clips.js` is the only playlist. The board plays that list from top to bottom. It does not scan the folder.

1. Put a 16:9 file in `assets/clips/` (MP4, WebM, or MOV). 1920×1080 is what the current clips are. Number the name (`tg09-your-title.mp4`) so the order stays obvious.
2. Add a line to `window.CLIPS` where that clip should play. To take a clip off the board, delete that line. The file can stay in the folder or go with it.
3. Commit and push to `main`.

Renaming a file does not change the order. The list does.

When you replace a file and keep the same name, change the `?v=` text on that line (any new string). That is the cache buster, same idea as the Christmas board. Leave `?v=` alone when the bytes did not change, or the TV downloads the clip again for no reason. The `?v=` values shipped here are the first 10 characters of each file's SHA-256.

`app.js` and `styles.css` are linked with `?v=20261027b`. Bump that text in `index.html` when you change those files so the TV does not keep an old copy. You do not need to touch it when you only edit `clips.js`.

## Keeping the picture moving

One `<video>` element in the page is reused. Each clip is detached (`pause`, clear `src`, `load()`) before the next one so the TV can free the decoder. The next file is warmed on a single off-screen video that is never added to the page. That warmer is aborted the same way (`src` cleared, then `load()`) before it takes another file, so preload elements do not pile up.

If `play()` is rejected, the board mutes and tries once more, then skips. Listeners and timers are registered once for the life of the page, not once per clip.

The leaves are a fixed set of 12 shapes, created once. One animation frame loop moves them. That loop stops while the document is hidden. The screen wake lock is requested where the browser allows it, and requested again when the page becomes visible.

After a scheduled reload the page resumes on the next clip, rather than jumping back to the first one. Saved resume state uses its own `tg_` keys so it does not collide with the Christmas board on the same `github.io` origin.

## Encoding

Every shipped clip is the same shape: 1920×1080, 24 fps, 15.0 seconds, H.264 High profile level 4.1, about 1.5–3.6 Mbps, faststart, plus a silent AAC track. The set is about 32 MB. Desktop Chrome plays that.

A lot of TVs only hardware-decode Baseline or Main. High profile with B-frames can stay black, which is what the Halloween board ran into. If this TV does that, re-encode on a computer, put the new file in place of the old one, change `?v=`, and push:

```bash
ffmpeg -y -i "INPUT.mp4" \
  -c:v libx264 -profile:v main -level:v 4.0 -pix_fmt yuv420p \
  -r 24 -b:v 1800k -maxrate 2200k -bufsize 3600k -bf 0 \
  -an \
  -movflags +faststart \
  "OUTPUT.mp4"
```

If the picture is still black, use `-profile:v baseline -level:v 4.0 -bf 0` in place of the Main profile line.
