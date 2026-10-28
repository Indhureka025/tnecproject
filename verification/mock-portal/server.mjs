/**
 * Mock TNREGINET portal — a stand-in for tnreginet.gov.in used to prove the
 * browser-automation worker end to end (the real portal is geo-restricted to
 * India and needs a real account). It deliberately mimics the friction:
 *
 *   - a login page with username/password + a text CAPTCHA
 *   - an EC search form with cascading Zone -> District -> SRO -> Village + dates
 *   - a CAPTCHA on the search too
 *   - an occasional OTP prompt
 *   - results as an HTML table (or a "no records" message)
 *
 * CAPTCHA answers are shown in a hidden <span id="captcha-answer"> so an automated
 * test can read them — the point here is exercising the worker's HITL handshake
 * and scraping, not defeating a CAPTCHA.
 *
 *   node verification/mock-portal/server.mjs [--port 8170]
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8170;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// A "scanned" pre-1987 EC as a PNG (rendered once via Chromium, then cached).
let scannedPng = null;
async function getScannedPng() {
  if (scannedPng) return scannedPng;
  const { chromium } = await import(pathToFileURL(path.join(HERE, "..", "..", "service", "node_modules", "playwright", "index.mjs")).href);
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 900, height: 300 } });
  await pg.setContent(`<div style="font-family:Georgia,serif;font-size:24px;line-height:1.8;padding:24px;background:#fff;color:#000;filter:grayscale(1) contrast(1.1)">
    <b>ENCUMBRANCE CERTIFICATE (scanned)</b><br>
    Village THIRUVOTTIYUR Survey No 88/2<br>
    1. Sale Deed Doc No 442 of 1979 21-06-1979 Rs 45000<br>
    2. Mortgage Doc No 771 of 1983 03-11-1983 Rs 60000
  </div>`);
  scannedPng = await pg.locator("div").first().screenshot();
  await b.close();
  return scannedPng;
}
const sessions = new Map(); // sid -> { captcha, loggedIn, otp }

const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const gen = (n) => Array.from({ length: n }, () => CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]).join("");

function captchaSvg(code) {
  const chars = code.split("").map((c, i) =>
    `<text x="${14 + i * 22}" y="${26 + (i % 2 ? 4 : -2)}" font-size="24" font-family="monospace" transform="rotate(${(i % 2 ? 1 : -1) * 8} ${20 + i * 22} 20)">${c}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="44"><rect width="150" height="44" fill="#eee"/><g fill="#333">${chars}</g><line x1="0" y1="22" x2="150" y2="18" stroke="#999"/></svg>`;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:14px system-ui;max-width:640px;margin:24px auto">${body}</body></html>`;
}

function sid(req, res) {
  const c = (req.headers.cookie ?? "").match(/sid=([^;]+)/)?.[1];
  if (c && sessions.has(c)) return c;
  const s = randomUUID();
  sessions.set(s, {});
  res.setHeader("set-cookie", `sid=${s}; Path=/`);
  return s;
}

function body(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(d))));
  });
}

const ZONES = { Chennai: { "North Chennai": ["Thiruvottiyur", "Perambur"] }, Chengalpattu: { Kancheepuram: ["Thiruporur", "Thaiyur"] } };

const server = createServer(async (req, res) => {
  const s = sid(req, res);
  const sess = sessions.get(s);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (html, code = 200) => { res.writeHead(code, { "content-type": "text/html" }); res.end(html); };

  // ---- login ----
  if (url.pathname === "/portal" || url.pathname === "/") {
    sess.captcha = gen(5);
    return send(page("Login — Mock TNREGINET", `
      <h2>Registration Department — Login</h2>
      <form method="post" action="/portal/login">
        <p>User name<br><input name="username" id="username"></p>
        <p>Password<br><input name="password" type="password" id="password"></p>
        <p>Type the code shown<br>${captchaSvg(sess.captcha)}<br>
           <input name="captcha" id="captcha">
           <span id="captcha-answer" style="position:absolute;left:-9999px">${sess.captcha}</span></p>
        <button id="login-submit">Login</button>
      </form>`));
  }

  if (url.pathname === "/portal/login" && req.method === "POST") {
    const f = await body(req);
    if (!f.username || !f.password) return send(page("Login", `<p id="err">Enter username and password.</p><a href="/portal">Back</a>`), 401);
    if ((f.captcha ?? "").toUpperCase() !== sess.captcha) return send(page("Login", `<p id="err">Wrong CAPTCHA.</p><a href="/portal">Back</a>`), 401);
    sess.loggedIn = true;
    res.writeHead(302, { location: "/portal/ec-search" });
    return res.end();
  }

  // ---- EC search ----
  if (url.pathname === "/portal/ec-search") {
    if (!sess.loggedIn) { res.writeHead(302, { location: "/portal" }); return res.end(); }
    sess.captcha = gen(5);
    const opts = (arr) => arr.map((v) => `<option>${v}</option>`).join("");
    return send(page("EC Search — Mock TNREGINET", `
      <h2>Encumbrance Certificate — Search &amp; View</h2>
      <form method="post" action="/portal/ec-result">
        <p>Zone <select name="zone" id="zone">${opts(Object.keys(ZONES))}</select></p>
        <p>District <select name="district" id="district">${opts(Object.keys(ZONES.Chennai))}</select></p>
        <p>SRO <select name="sro" id="sro">${opts(ZONES.Chennai["North Chennai"])}</select></p>
        <p>Village <input name="village" id="village" value="Thiruvottiyur"></p>
        <p>Survey no <input name="survey" id="survey"> &nbsp; Subdiv <input name="subdiv" id="subdiv" value="1"></p>
        <p>Date from <input name="from" id="from" value="01/01/2004"> &nbsp; to <input name="to" id="to" value="31/12/2024"></p>
        <p>Type the code shown<br>${captchaSvg(sess.captcha)}<br>
           <input name="captcha" id="ec-captcha">
           <span id="captcha-answer" style="position:absolute;left:-9999px">${sess.captcha}</span></p>
        <button id="ec-submit">Search</button>
      </form>`));
  }

  if (url.pathname === "/portal/scanned.png") {
    const png = await getScannedPng();
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(png);
  }

  if (url.pathname === "/portal/ec-result" && req.method === "POST") {
    if (!sess.loggedIn) { res.writeHead(302, { location: "/portal" }); return res.end(); }
    const f = await body(req);

    // survey starting "RETRY" -> simulates a real-portal CAPTCHA that expired
    // between screenshot and submission: reject the first attempt outright
    // (regardless of the answer given), re-render the search form with a fresh
    // CAPTCHA and a "Please Enter Valid Captcha" message, and accept normally
    // from the second attempt on. Exercises the automation worker's retry loop.
    if (/^RETRY/i.test(f.survey ?? "") && !sess.retryDone) {
      sess.retryDone = true;
      sess.captcha = gen(5);
      const opts = (arr) => arr.map((v) => `<option>${v}</option>`).join("");
      return send(page("EC Search — Mock TNREGINET", `
        <h2>Encumbrance Certificate — Search &amp; View</h2>
        <p style="color:red">Please Enter Valid Captcha</p>
        <form method="post" action="/portal/ec-result">
          <p>Zone <select name="zone" id="zone">${opts(Object.keys(ZONES))}</select></p>
          <p>District <select name="district" id="district">${opts(Object.keys(ZONES.Chennai))}</select></p>
          <p>SRO <select name="sro" id="sro">${opts(ZONES.Chennai["North Chennai"])}</select></p>
          <p>Village <input name="village" id="village" value="${f.village ?? "Thiruvottiyur"}"></p>
          <p>Survey no <input name="survey" id="survey" value="${f.survey ?? ""}"> &nbsp; Subdiv <input name="subdiv" id="subdiv" value="${f.subdiv ?? "1"}"></p>
          <p>Date from <input name="from" id="from" value="${f.from ?? "01/01/2004"}"> &nbsp; to <input name="to" id="to" value="${f.to ?? "31/12/2024"}"></p>
          <p>Type the code shown<br>${captchaSvg(sess.captcha)}<br>
             <input name="captcha" id="ec-captcha">
             <span id="captcha-answer" style="position:absolute;left:-9999px">${sess.captcha}</span></p>
          <button id="ec-submit">Search</button>
        </form>`));
    }

    if ((f.captcha ?? "").toUpperCase() !== sess.captcha) return send(page("EC", `<p id="err">Wrong CAPTCHA.</p>`), 401);

    // survey starting "OLD" -> pre-1987 record served as a scanned image
    if (/^OLD/i.test(f.survey ?? "")) {
      return send(page("EC Result (scanned) — Mock TNREGINET", `
        <h2>Encumbrance Certificate — Result (pre-1987, scanned)</h2>
        <p>Village ${f.village ?? ""} · Survey ${f.survey}</p>
        <img id="scanned-ec" src="/portal/scanned.png" alt="scanned EC">`));
    }

    // survey numbers ending in 7 trigger an OTP step once
    if (/7$/.test(f.survey ?? "") && !sess.otpDone) {
      sess.otp = "654321";
      sess.pendingSearch = f;
      return send(page("OTP", `
        <h3>One-time password</h3>
        <p>An OTP was sent to your registered mobile. (mock OTP: <span id="otp-value">${sess.otp}</span>)</p>
        <form method="post" action="/portal/ec-otp">
          <input name="otp" id="otp-input"><button id="otp-submit">Verify</button>
        </form>`));
    }
    return send(resultPage(f));
  }

  if (url.pathname === "/portal/ec-otp" && req.method === "POST") {
    const f = await body(req);
    if (f.otp !== sess.otp) return send(page("OTP", `<p id="err">Wrong OTP.</p>`), 401);
    sess.otpDone = true;
    return send(resultPage(sess.pendingSearch ?? {}));
  }

  res.writeHead(404); res.end("not found");
});

function resultPage(f) {
  const survey = f.survey ?? "";
  // survey contains "4" -> entries; otherwise nil
  const hasEntries = survey.includes("4");
  const rows = hasEntries
    ? `<tr><td>1</td><td>Sale Deed</td><td>1234/2016</td><td>${f.sro ?? ""}</td><td>12/03/2016</td><td>15/03/2016</td><td>2500000</td><td>2800000</td><td>R. Sundaram</td><td>A. Kumar</td><td>1200 sq.ft</td><td>28/1120</td><td></td></tr>
       <tr><td>2</td><td>Simple Mortgage</td><td>2231/2019</td><td>${f.sro ?? ""}</td><td>04/07/2019</td><td>09/07/2019</td><td>3500000</td><td>4200000</td><td>A. Kumar</td><td>XYZ Bank Ltd</td><td>1200 sq.ft</td><td>45/210</td><td>Term loan</td></tr>`
    : "";
  return page("EC Result — Mock TNREGINET", `
    <h2>Encumbrance Certificate — Result</h2>
    <p>Village ${f.village ?? ""} · Survey ${survey} · Period ${f.from ?? ""} to ${f.to ?? ""}</p>
    <table id="ecResultTable" border="1" cellpadding="4">
      <thead><tr><th>S.No</th><th>Nature</th><th>Doc No / Year</th><th>SRO</th><th>Date of Execution</th><th>Date of Registration</th><th>Consideration (Rs)</th><th>Market Value (Rs)</th><th>Executants</th><th>Claimants</th><th>Extent</th><th>Vol/Page</th><th>Remarks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${hasEntries ? "" : `<p class="ec-message" id="no-records">No Encumbrance found for the given period.</p>`}
    <a id="download-pdf" href="/portal/ec.pdf">Download PDF</a>`);
}

server.listen(PORT, () => console.log(`mock TNREGINET portal on http://localhost:${PORT}/portal`));
