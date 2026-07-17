/* Headless verification harness — no-op unless the page is opened with ?verify.
 * Forces all pieces live, seeks videos to fixed times, renders deterministic
 * frames and POSTs them to the local capture server on :8408. */
(() => {
  if (!new URLSearchParams(location.search).has("verify")) return;
  const UP = "http://localhost:8408/";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (name, canvas, q = 0.85) =>
    fetch(UP, { method: "POST", body: JSON.stringify({ name, data: canvas.toDataURL("image/jpeg", q) }) });

  window.addEventListener("load", async () => {
    const status = {};
    try {
      pieces.forEach((p) => { p.visible = true; p.start(); });
      for (let i = 0; i < 100 && !pieces.every((p) => p.gl); i++) await sleep(100);
      status.gl = pieces.map((p) => p.fig.dataset.piece + ":" + !!p.gl).join(",");

      for (let i = 0; i < 50 && !pieces.every((p) => (!p.cfg.skyMask && !p.cfg.waterMask) || p.maskReady); i++) await sleep(100);

      const vids = [];
      pieces.forEach((p) => { if (p.skyVid) vids.push(p.skyVid); if (p.birdVid) vids.push(p.birdVid); });
      vids.forEach((v) => { v.play().catch(() => {}); });
      for (let i = 0; i < 200 && !vids.every((v) => v.readyState >= 2); i++) await sleep(100);
      status.vids = vids.map((v) => v.readyState).join(",");
      vids.forEach((v) => v.pause());

      const seekAll = async (tSky, tBird) => {
        for (const p of pieces) {
          if (p.skyVid) p.skyVid.currentTime = Math.min(tSky, (p.skyVid.duration || 10) - 0.1);
          if (p.birdVid) p.birdVid.currentTime = tBird;
        }
        for (let i = 0; i < 80 && vids.some((v) => v.seeking); i++) await sleep(50);
        await sleep(200);
      };

      const fixSize = (p) => {
        const iw = p.poster.naturalWidth, ih = p.poster.naturalHeight;
        const w = 1600, h = Math.round(1600 * ih / iw);
        if (p.glCanvas.width !== w) {
          p.glCanvas.width = w; p.glCanvas.height = h;
          p.gl.viewport(0, 0, w, h);
        }
      };

      const shipAll = async (tag, phase) => {
        for (const p of pieces) {
          if (!p.gl) continue;
          fixSize(p);
          p.draw(LOOP_MS * phase);
          const t = document.createElement("canvas");
          t.width = 1100; t.height = Math.round(1100 * p.glCanvas.height / p.glCanvas.width);
          t.getContext("2d").drawImage(p.glCanvas, 0, 0, t.width, t.height);
          await post(p.fig.dataset.piece + "_" + tag + ".jpg", t);
        }
      };

      const get = (id) => pieces.find((p) => p.fig.dataset.piece === id);
      const crop = (p, x0, y0, x1, y1, phase) => {
        fixSize(p);
        p.draw(LOOP_MS * phase);
        const g = p.glCanvas;
        const w = Math.round((x1 - x0) * g.width), h = Math.round((y1 - y0) * g.height);
        const t = document.createElement("canvas"); t.width = w; t.height = h;
        t.getContext("2d").drawImage(g, x0 * g.width, y0 * g.height, w, h, 0, 0, w, h);
        return t;
      };

      await seekAll(2.0, 6.0);
      /* bird-path probe: uniform readback + raw video element frame */
      const ch = pieces.find((p) => p.fig.dataset.piece === "charyn");
      if (ch && ch.gl && ch.prog) {
        const gg = ch.gl, pr = ch.prog;
        const gu = (n) => { const l = gg.getUniformLocation(pr, n); return l ? gg.getUniform(pr, l) : "no-loc"; };
        status.bird = JSON.stringify({
          has: gu("uHasBird"), op: gu("uBirdOpacity"), rect: Array.from(gu("uBirdRect") || []),
          curve: Array.from(gu("uMaskCurve") || []),
          vidTime: ch.birdVid && ch.birdVid.currentTime, vidW: ch.birdVid && ch.birdVid.videoWidth,
          vidState: ch.birdVid && ch.birdVid.readyState,
        });
        if (ch.birdVid) {
          const t = document.createElement("canvas");
          t.width = 672; t.height = 378;
          t.getContext("2d").drawImage(ch.birdVid, 0, 0, t.width, t.height);
          await post("birdvid_direct.jpg", t);
        }
      }
      await shipAll("va", 0.23);
      await seekAll(6.5, 9.0);
      await shipAll("vb", 0.61);

      await post("kolsai_people_a.jpg", crop(get("kolsai"), 0.35, 0.50, 0.95, 0.85, 0.06), 0.92);
      await post("kolsai_people_b.jpg", crop(get("kolsai"), 0.35, 0.50, 0.95, 0.85, 0.42), 0.92);
      await post("charyn_edge.jpg", crop(get("charyn"), 0.05, 0.16, 0.95, 0.45, 0.23), 0.92);
      await post("bao_ridge.jpg", crop(get("bao"), 0.35, 0.25, 1.0, 0.60, 0.23), 0.92);
      await post("bozzhyra_rim.jpg", crop(get("bozzhyra"), 0.10, 0.05, 0.75, 0.55, 0.23), 0.92);
      await post("birds_zone.jpg", crop(get("charyn"), 0.28, 0.0, 0.66, 0.33, 0.23), 0.92);

      /* grain: same phase, two seeds -> sky-region diff should be ~grain level */
      const chp = get("charyn");
      const grab = (now, x, y, w, h) => {
        chp.draw(now);
        const buf = new Uint8Array(w * h * 4);
        chp.gl.readPixels(x, y, w, h, chp.gl.RGBA, chp.gl.UNSIGNED_BYTE, buf);
        return buf;
      };
      const A = grab(5000, 400, chp.glCanvas.height - 300, 300, 200);
      const B = grab(5100, 400, chp.glCanvas.height - 300, 300, 200);
      let gsum = 0;
      for (let i = 0; i < A.length; i += 4) gsum += Math.abs(A[i] - B[i]);
      status.grainDiff = +(gsum / (A.length / 4)).toFixed(2);
      await post("grain_zoom.jpg", crop(chp, 0.25, 0.02, 0.55, 0.22, 0.31), 0.95);

      /* lightbox: click to expand, Escape to close */
      chp.fig.querySelector(".frame").click();
      await sleep(350);
      const st = chp.stack.getBoundingClientRect();
      status.lightbox = JSON.stringify({
        expanded: chp.fig.classList.contains("expanded"),
        scrollLocked: document.documentElement.classList.contains("lightbox"),
        stack: [Math.round(st.width), Math.round(st.height)],
        win: [innerWidth, innerHeight],
        canvasPx: [chp.glCanvas.width, chp.glCanvas.height],
      });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(100);
      status.lightboxClosed = !chp.fig.classList.contains("expanded") &&
        !document.documentElement.classList.contains("lightbox");
      status.ok = true;
    } catch (e) {
      status.err = String((e && e.stack) || e);
    }
    await fetch(UP, {
      method: "POST",
      body: JSON.stringify({ name: "status.txt", data: "data:text/plain;base64," + btoa(JSON.stringify(status)) }),
    });
    document.title = "VERIFY-DONE";
  });
})();
