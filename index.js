import WebSocket from "ws";
import axios from "axios";
import crypto from "crypto";
import http from "http";

// --- 1. Serveur HTTP pour maintenir Render actif ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("MCP Server OK\n");
}).listen(PORT, () => console.log(`Serveur HTTP actif sur le port ${PORT}`));

// --- 2. Variables d'environnement ---
const TUYA_CLIENT_ID = process.env.TUYA_CLIENT_ID;
const TUYA_SECRET = process.env.TUYA_SECRET;
const GOVEE_API_KEY = process.env.GOVEE_API_KEY;

// --- 3. Dictionnaire & Alias des appareils SmartLife / Tuya ---
const TUYA_DEVICES = {
  "musique": "bff13ef303c235bff5ctrs",
  "hifi": "bff13ef303c235bff5ctrs",
  "neon salon": "bfe70cfada2d079843d2sm",
  "neon": "bfe70cfada2d079843d2sm",
  "ruban": "bfe70cfada2d079843d2sm",
  
  // Prise Lumière Chambre / Chevet (ID mis à jour)
  "chevet": "bf9df2xf0qxxpxmj",
  "lumiere chambre": "bf9df2xf0qxxpxmj",
  "lumière chambre": "bf9df2xf0qxxpxmj",
  "prise chambre": "bf9df2xf0qxxpxmj",
  "prise lumiere chambre": "bf9df2xf0qxxpxmj",
  "prise lumière chambre": "bf9df2xf0qxxpxmj",
  "lampe chambre": "bf9df2xf0qxxpxmj",

  // Télévision & Audio
  "tele": "bfff3c709b433af741t9dz",
  "télé": "bfff3c709b433af741t9dz",
  "tv": "bfff3c709b433af741t9dz",
  "television": "bfff3c709b433af741t9dz",
  "télévision": "bfff3c709b433af741t9dz",
  "ampli": "bf82a30da98f6ed985xy80",

  // Ventilateurs
  "ventilateur chambre": "bf6cedea4ebc7d8f5eh9di",
  "ventilateur salon": "bf09710e9bb5de233dfltn",
  "ventilateur": "bf09710e9bb5de233dfltn",

  // Prise Informatique / PC
  "informatique": "bf5406yyctvuikg1",
  "pc": "bf5406yyctvuikg1",
  "ordinateur": "bf5406yyctvuikg1",
  "prise informatique": "bf5406yyctvuikg1"
};

function normalizeText(text) {
  if (!text) return "";
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findTuyaDeviceId(cleanName) {
  if (TUYA_DEVICES[cleanName]) return TUYA_DEVICES[cleanName];

  if (cleanName.includes("chambre") && (cleanName.includes("lumiere") || cleanName.includes("prise") || cleanName.includes("chevet") || cleanName.includes("lampe"))) {
    return TUYA_DEVICES["chevet"];
  }

  if (cleanName.includes("informatique") || cleanName.includes("pc") || cleanName.includes("ordinateur")) {
    return TUYA_DEVICES["informatique"];
  }

  return null;
}

// --- 4. Fonctions Tuya & Govee ---
async function getTuyaToken() {
  if (!TUYA_CLIENT_ID || !TUYA_SECRET) {
    throw new Error("Clés TUYA_CLIENT_ID ou TUYA_SECRET manquantes.");
  }

  const t = Date.now().toString();
  const stringToSign = ["GET", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "", "/v1.0/token?grant_type=1"].join("\n");
  const signStr = TUYA_CLIENT_ID + t + stringToSign;
  const sign = crypto.createHmac("sha256", TUYA_SECRET).update(signStr).digest("HEX").toUpperCase();

  const res = await axios.get("https://openapi.tuyaeu.com/v1.0/token?grant_type=1", {
    headers: { client_id: TUYA_CLIENT_ID, sign, t, sign_method: "HMAC-SHA256" }
  });

  if (!res.data?.success) {
    throw new Error(`Tuya Token Error [code ${res.data?.code}] : ${res.data?.msg}`);
  }

  return res.data?.result?.access_token;
}

async function controlTuyaDevice(deviceId, turnOn) {
  const token = await getTuyaToken();
  if (!token) throw new Error("Impossible d'obtenir le token Tuya.");

  const possibleCodes = ["switch_1", "switch", "switch_p", "power", "power_1", "switch_led", "switch_2"];
  let lastError = null;

  for (const code of possibleCodes) {
    const t = Date.now().toString();
    const body = JSON.stringify({ commands: [{ code: code, value: turnOn }] });
    const contentSha256 = crypto.createHash("sha256").update(body).digest("hex");
    const stringToSign = ["POST", contentSha256, "", `/v1.0/devices/${deviceId}/commands`].join("\n");
    const signStr = TUYA_CLIENT_ID + token + t + stringToSign;
    const sign = crypto.createHmac("sha256", TUYA_SECRET).update(signStr).digest("HEX").toUpperCase();

    try {
      const res = await axios.post(
        `https://openapi.tuyaeu.com/v1.0/devices/${deviceId}/commands`,
        body,
        {
          headers: {
            client_id: TUYA_CLIENT_ID,
            access_token: token,
            sign,
            t,
            sign_method: "HMAC-SHA256",
            "Content-Type": "application/json"
          }
        }
      );

      if (res.data?.success) {
        console.log(`Commande Tuya réussie ('${code}') pour ${deviceId}`);
        return res.data;
      }
      console.log(`Code Tuya '${code}' rejeté pour ${deviceId} : [code ${res.data?.code}] ${res.data?.msg}`);
      lastError = new Error(`Tuya [code ${res.data?.code}] : ${res.data?.msg}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Aucun code compatible pour l'appareil ${deviceId}`);
}

async function controlGoveeDevice(deviceName, turnOn) {
  if (!GOVEE_API_KEY) throw new Error("GOVEE_API_KEY manquante.");

  const listRes = await axios.get("https://developer-api.govee.com/v1/devices", {
    headers: { "Govee-API-Key": GOVEE_API_KEY }
  });

  const devices = listRes.data?.data?.devices || [];
  const searchKey = normalizeText(deviceName);

  const target = devices.find(d => {
    const dName = normalizeText(d.deviceName);
    return dName.includes(searchKey) || searchKey.includes(dName) ||
           (searchKey.includes("couloir") && dName.includes("couloir")) ||
           (searchKey.includes("cuisine") && dName.includes("cuisine")) ||
           (searchKey.includes("spot") && dName.includes("spot")) ||
           (searchKey.includes("led") && dName.includes("led"));
  });

  if (!target) {
    const names = devices.map(d => d.deviceName).join(", ");
    throw new Error(`Non trouvé sur Govee. Dispo: [${names}]`);
  }

  await axios.put(
    "https://developer-api.govee.com/v1/devices/control",
    {
      device: target.device,
      model: target.model,
      cmd: { name: "turn", value: turnOn ? "on" : "off" }
    },
    { headers: { "Govee-API-Key": GOVEE_API_KEY } }
  );

  return target.deviceName;
}

// --- 5. Connexion WebSocket avec Xiaozhi ---
function connectWebSocket() {
  const wsUrl = process.env.XIAOZHI_MCP_URL;
  if (!wsUrl) return;

  const ws = new WebSocket(wsUrl);
  let heartbeatInterval;

  ws.on("open", () => {
    console.log("Connecté au serveur MCP Xiaozhi !");
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (!msg.method) return;

      if (msg.method === "ping") {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
        return;
      }

      if (msg.method === "initialize") {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "bouboule-mcp", version: "1.0.0" }
          }
        }));
        return;
      }

      if (msg.method === "tools/list") {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              {
                name: "control_device",
                description: "Contrôle les appareils domotiques (ex: neon salon, led salon, lumiere couloir, spot cuisine, musique, ventilateur, tele, chevet, prise lumiere chambre, informatique, pc, reveille, dodo). Indiquer l'appareil et 'on' ou 'off'.",
                inputSchema: {
                  type: "object",
                  properties: {
                    device_name: { type: "string", description: "Nom de l'appareil ou routine à contrôler" },
                    state: { type: "string", enum: ["on", "off"], description: "État souhaité: 'on' pour allumer, 'off' pour éteindre" }
                  },
                  required: ["device_name", "state"]
                }
              }
            ]
          }
        }));
        return;
      }

      if (msg.method === "tools/call") {
        const args = msg.params?.arguments || {};
        const rawDevice = args.device_name || args.device || "";
        const cleanName = normalizeText(rawDevice);

        const rawState = String(args.state ?? args.action ?? args.power ?? args.status ?? args.value ?? "").toLowerCase().trim();

        let isTurnOn = true;
        if (rawState) {
          isTurnOn = ["on", "allumer", "true", "1", "open", "active", "marche"].includes(rawState) || args.state === true || args.power === true;
        } else {
          if (cleanName.includes("eteind") || cleanName.includes("stop") || cleanName.includes("off")) {
            isTurnOn = false;
          }
        }

        console.log(`Ordre reçu pour '${rawDevice}' -> ${isTurnOn ? 'ON' : 'OFF'}`);

        try {
          // ROUTINE 1 : RÉVEIL (Allume TV & Cuisine, éteint la prise lumière chambre)
          if (cleanName.includes("reveil") || cleanName.includes("reveille")) {
            try { await controlTuyaDevice(TUYA_DEVICES["tele"], true); } catch(e){ console.error("Erreur Télé réveil :", e.message); }
            try { await controlGoveeDevice("cuisine", true); } catch(e){ console.error("Erreur Cuisine réveil :", e.message); }
            try { await controlTuyaDevice(TUYA_DEVICES["chevet"], false); } catch(e){ console.error("Erreur Prise lumière chambre réveil :", e.message); }
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Routine réveil exécutée" }] } }));
            return;
          }

          // ROUTINE 2 : DODO (Éteint TV, Néon, Spot, Cuisine et allume la prise lumière chambre)
          if (cleanName.includes("dodo") || cleanName.includes("bonne nuit")) {
            try { await controlTuyaDevice(TUYA_DEVICES["tele"], false); } catch(e){ console.error("Erreur Télé dodo :", e.message); }
            try { await controlTuyaDevice(TUYA_DEVICES["neon"], false); } catch(e){ console.error("Erreur Néon dodo :", e.message); }
            try { await controlGoveeDevice("spot", false); } catch(e){ console.error("Erreur Spot dodo :", e.message); }
            try { await controlGoveeDevice("cuisine", false); } catch(e){ console.error("Erreur Cuisine dodo :", e.message); }
            try { await controlTuyaDevice(TUYA_DEVICES["chevet"], true); } catch(e){ console.error("Erreur Prise lumière chambre dodo :", e.message); }

            ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Routine dodo exécutée" }] } }));
            return;
          }

          let matched = "";

          // Routage vers GOVEE
          if (cleanName.includes("couloir") || cleanName.includes("cuisine") || cleanName.includes("spot") || cleanName.includes("led") || cleanName.includes("govee")) {
            matched = await controlGoveeDevice(rawDevice, isTurnOn);
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Govee '${matched}' OK` }] } }));
            return;
          }

          // Routage vers TUYA / SmartLife
          const tuyaId = findTuyaDeviceId(cleanName);
          if (tuyaId) {
            await controlTuyaDevice(tuyaId, isTurnOn);
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Tuya '${rawDevice}' OK` }] } }));
            return;
          }

          // Fallback Govee
          matched = await controlGoveeDevice(rawDevice, isTurnOn);
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Govee '${matched}' OK` }] } }));

        } catch (err) {
          console.error("Erreur commande globale :", err.message);
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Erreur: ${err.message}` }], isError: true } }));
        }
      }
    } catch (e) {
      console.error("Erreur de traitement WS :", e.message);
    }
  });

  ws.on("error", (err) => {
    clearInterval(heartbeatInterval);
    console.error("Erreur WS :", err.message);
  });

  ws.on("close", () => {
    clearInterval(heartbeatInterval);
    console.log("WebSocket fermé. Reconnexion dans 5 secondes...");
    setTimeout(connectWebSocket, 5000);
  });
}

connectWebSocket();

process.on("uncaughtException", (err) => console.error("Erreur non capturée :", err));
process.on("unhandledRejection", (reason) => console.error("Rejet non géré :", reason));
