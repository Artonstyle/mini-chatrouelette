require("dotenv").config();
const http = require("http");
const WebSocket = require("ws");
const express = require("express");
const fs = require("fs");
const path = require("path");
const auth = require("basic-auth");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 📂 Public-Folder für Client-Dateien
app.use(express.static(path.join(__dirname, "public")));

let waiting = null;
const pairs = new Map();
const reportsFile = path.join(__dirname, "reports.log");

// 🔔 Funktion zum Senden der Userzahl
function broadcastUserCount() {
  const count = wss.clients.size;
  const message = JSON.stringify({ type: "user-count", count });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

// 📝 Reports speichern
function logReport(ws) {
  const ip = ws._socket?.remoteAddress || "unknown";
  const entry = `${new Date().toISOString()} - Report gegen IP: ${ip}\n`;
  fs.appendFileSync(reportsFile, entry);
  console.log("⚠️ Report gespeichert:", entry.trim());
}

// 🟢 WebSocket-Logik
wss.on("connection", (ws) => {
  console.log("🔗 Neuer Client");
  broadcastUserCount();

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (e) {
      console.warn("⚠️ Ungültige Nachricht empfangen:", msg.toString());
      return;
    }

    if (data.type === "start") {
      if (waiting && waiting !== ws) {
        const caller = ws;
        const answerer = waiting;
        pairs.set(caller, answerer);
        pairs.set(answerer, caller);
        waiting = null;
        caller.send(JSON.stringify({ type: "matched", should_offer: true }));
        answerer.send(JSON.stringify({ type: "matched", should_offer: false }));
      } else {
        waiting = ws;
        ws.send(JSON.stringify({ type: "no-match" }));
      }
    }

    else if (data.type === "next" || data.type === "stop") {
      const partner = pairs.get(ws);
      if (partner) {
        pairs.delete(ws);
        pairs.delete(partner);
        if (partner.readyState === WebSocket.OPEN) {
          partner.send(JSON.stringify({ type: "partner-left" }));
        }
      }
      if (data.type === "stop" && waiting === ws) waiting = null;
    }

    else if (["offer", "answer", "candidate"].includes(data.type)) {
      const partner = pairs.get(ws);
      if (partner && partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify(data));
      }
    }

    else if (data.type === "report") {
      logReport(ws);
      const partner = pairs.get(ws);
      if (partner) {
        partner.send(JSON.stringify({ type: "partner-left" }));
        partner.send(JSON.stringify({ type: "system", message: "⚠️ Du wurdest gemeldet und getrennt." }));
        pairs.delete(ws);
        pairs.delete(partner);
      }
    }
  });

  ws.on("close", () => {
    console.log("🔌 Client getrennt");
    const partner = pairs.get(ws);
    if (partner) {
      pairs.delete(ws);
      pairs.delete(partner);
      if (partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "partner-left" }));
      }
    }
    if (waiting === ws) waiting = null;
    broadcastUserCount();
  });
});

// **********************************************
// 🔐 ADMIN-BEREICH
// **********************************************
const adminCredentials = {
  username: process.env.ADMIN_USER || "admin",
  password: process.env.ADMIN_PASS || "changeme"
};

// Middleware Basic Auth
app.use("/admin", (req, res, next) => {
  const user = auth(req);
  if (!user || user.name !== adminCredentials.username || user.pass !== adminCredentials.password) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Area"');
    return res.status(401).send("Zugang verweigert");
  }
  next();
});

// Dashboard
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Reports
app.get("/admin/reports", (req, res) => {
  if (fs.existsSync(reportsFile)) {
    res.sendFile(reportsFile);
  } else {
    res.type("text/plain").send("Noch keine Reports vorhanden.");
  }
});

// 🚀 Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server läuft auf Port ${PORT}`));
