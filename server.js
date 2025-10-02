const http = require("http");
const WebSocket = require("ws");
const express = require("express");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public')); 

let waiting = null; 
const pairs = new Map(); 
const reportsFile = "reports.log";

// Funktion zum Senden der Userzahl
function broadcastUserCount() {
    const count = wss.clients.size;
    const message = JSON.stringify({ type: "user-count", count });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
}

// Reports speichern
function logReport(ws) {
    const ip = ws._socket.remoteAddress;
    const entry = `${new Date().toISOString()} - Report gegen IP: ${ip}\n`;
    fs.appendFileSync(reportsFile, entry);
    console.log("⚠️ Report gespeichert:", entry.trim());
}

wss.on("connection", (ws) => {
    console.log("🔗 Neuer Client");
    broadcastUserCount();

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

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
                partner.send(JSON.stringify({ type: "partner-left" }));
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
                partner.send(JSON.stringify({ type: "system", message: "⚠️ Du wurdest gemeldet." }));
            }
        }
    });

    ws.on("close", () => {
        console.log("🔗 Client getrennt");
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server läuft auf Port ${PORT}`));

const path = require("path");

const auth = require('basic-auth');

const adminCredentials = {
  username: 'admin',
  password: 'Arton.190388' // Ersetze dies durch ein sicheres Passwort
};

app.use('/admin', (req, res, next) => {
  const user = auth(req);
  if (!user || user.name !== adminCredentials.username || user.pass !== adminCredentials.password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Zugang verweigert');
  }
  next();
});
