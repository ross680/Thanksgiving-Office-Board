# 3R Thanksgiving Office TV

Static GitHub Pages slideshow for the office TV. Eight silent 15-second clips play in order, each through to the end, then the loop starts over.

The TV opens <https://ross680.github.io/Thanksgiving-Office-Board/>.

It follows the same full-screen board as the [Christmas Board](https://github.com/ross680/Christmas-Office-Board), the [Motivational Board](https://github.com/ross680/Motivational-Board), and the [Halloween Board](https://github.com/ross680/Halloween-Board): one stage, one reused `<video>` element, a thin progress bar, hover controls, a screen wake lock, and a reload so a TV left on overnight picks up changes. Clips live in `assets/clips/`.

## Publish on GitHub Pages

The page is a normal static site. It does not call the GitHub API.

1. Push this folder to `main`.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Branch: **main**. Folder: **/** (root).
5. Open <https://ross680.github.io/Thanksgiving-Office-Board/> on the TV browser.

Pages can take a minute after the push. The TV may keep the previous `index.html` for about 10 minutes. The board also reloads itself every 4 hours, after the current clip finishes, so a new playlist shows up on its own.

`.nojekyll` is in the repo so Pages serves the files as they are.

## Controls

Right arrow or Space: next · Left arrow: previous · P: pause · M: sound on/off · F: fullscreen

Clips start muted so Chrome and TV browsers allow autoplay. M, or the sound button, turns sound on. The clips in this set are silent.

Hover the picture to see the controls and the clip count (`3 / 8`). The Thanksgiving chip stays in the corner. It counts calendar days to Thursday, November 26, 2026 in America/New_York, the same clock as the other boards. The day before it reads `1 DAY UNTIL THANKSGIVING`. On November 26 it reads `HAPPY THANKSGIVING FROM 3R`. After that it reads `THANK YOU FOR A GREAT YEAR`. A light falling-leaves effect sits over the picture. `?leaves=0` turns the leaves off.

## URL options

- `?reload=4` reloads every 4 hours (the default), after the current clip ends. `?reload=0` turns that off. The board checks once a minute, because some TV browsers drop one long timer.
- `?maxclip=60` is a hard cap per video, in seconds (default 60). A normal clip ends itself first.
- `?stall=20` skips a clip with no playback progress for 20 seconds.
- `?watchdog=90` if the reel makes no progress for 90 seconds, the page reloads once. If it just reloaded and is still stuck, it waits a minute instead of reboot-looping.
- `?shuffle=1` randomizes the order when the page loads.
- `?slide=3` starts on that clip (1 is the first).
- `?date=2026-11-26` previews the countdown for that calendar day. `?date=2026-11-27` previews the message after Thanksgiving.
- `?leaves=0` turns the falling leaves off. Leaves are also hidden when the browser asks for reduced motion.
- `?fresh=1` loads a new page for every clip. Last resort for a TV that still leaks memory.
- `?debug=1` shows the clip name, uptime, page loads, and the last problem.

A clip that errors, or never produces a picture, is skipped. One bad file does not stop the board.

## Add or remove a clip

`clips.js` is the only playlist. The board plays that list from top to bottom. It does not scan the folder.

1. Put a 16:9 file in `assets/clips/` (MP4, WebM, or MOV). 1920×1080 is what the current clips are. Number the name (`tg09-your-title.mp4`) so the order stays obvious.
2. Add a line to `window.CLIPS` where that clip should play. To take a clip off the board, delete that line. The file can stay in the folder or go with it.
3. Commit and push to `main`.

Renaming a file does not change the order. The list does.

When you replace a file and keep the same name, change the `?v=` text on that line (any new string). That is the cache buster, same idea as the Christmas board. Leave `?v=` alone when the bytes did not change, or the TV downloads the clip again for no reason. The `?v=` values shipped here are the first 10 characters of each file's SHA-256.

`app.js` and `styles.css` are linked with `?v=20261027a`. Bump that text in `index.html` when you change those files so the TV does not keep an old copy. You do not need to touch it when you only edit `clips.js`.

## Keeping the picture moving

One `<video>` element is reused. Each clip is detached (`pause`, clear `src`, `load()`) before the next one so the TV can free the decoder. While a clip plays, the next file is preloaded with `<link rel="preload" as="video">` so the following cut does not wait on the network. The leaves are a fixed set of shapes, created once, animated with CSS only.

After the scheduled reload the page resumes on the next clip, rather than jumping back to the first one. Saved resume state uses its own `tg_` keys so it does not collide with the Christmas board on the same `github.io` origin.

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
