import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocket } from "ws";
import axios from "axios";
import crypto from "crypto";

// Variables d'environnement
const TUYA_CLIENT_ID = process.env.TUYA_CLIENT_ID;
const TUYA_SECRET = process.env.TUYA_SECRET;
const GOVEE_API_KEY = process.env.GOVEE_API_KEY;

// Table des appareils Tuya
const TUYA_DEVICES = {
  "ventilateur salon": "bf09710e9bb5de233dfltn",
  "ventilateur chambre": "bf6cedea4ebc7d8f5eh9di",
  "neon salon": "bfe70cfada2d079843d2sm",
  "neon": "bfe70cfada2d079843d2sm",
  "ruban": "bfe70cfada2d079843d2sm",
  "hifi": "bff13ef303c235bff5ctrs",
  "musique": "bff13ef303c235bff5ctrs",
  "ici": "bff13ef303c235bff5ctrs",
  "ampli": "bff13ef303c235bff5ctrs",
  "television": "bfff3c709b433af741t9dz",
  "tele": "bfff3c709b433af741t9dz",
  "informatique": "bf5406yyctvuikg1",
  "pc": "bf5406yyctvuikg1"
};

// Nettoyage de texte pour comparaison souple
function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Token Tuya API
async function getTuyaToken() {
  const t = Date.now().toString();
  const stringToSign = ["GET", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "", "/v1.0/token?grant_type=1"].join("\n");
  const signStr = TUYA_CLIENT_ID + t + "" + stringToSign;
  const sign = crypto.createHmac("sha256", TUYA_SECRET).update(signStr).digest("HEX").toUpperCase();

  const res = await axios.get("https://openapi.tuyaeu.com/v1/token?grant_type=1", {
    headers: { client_id: TUYA_CLIENT_ID, sign, t, sign_method: "HMAC-SHA256" }
  });
  return res.data?.result?.access_token;
}

// Commande Tuya ciblée uniquement sur switch_1
async function controlTuyaDevice(deviceId, turnOn) {
  const token = await getTuyaToken();
  if (!token) throw new Error("Impossible d'obtenir le token Tuya.");

  const t = Date.now().toString();
  const body = JSON.stringify({ commands: [{ code: "switch_1", value: turnOn }] });
  const contentSha256 = crypto.createHash("sha256").update(body).digest("hex");
  const stringToSign = ["POST", contentSha256, "", `/v1.0/devices/${deviceId}/commands`].join("\n");
  const signStr = TUYA_CLIENT_ID + token + t + "" + stringToSign;
  const sign = crypto.createHmac("sha256", TUYA_SECRET).update(signStr).digest("HEX").toUpperCase();

  const res = await axios.post(
    `https://openapi.tuyaeu.com/v1/devices/${deviceId}/commands`,
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
  return res.data;
}

// Commande Govee API avec recherche souple
async function controlGoveeDevice(deviceName, turnOn) {
  if (!GOVEE_API_KEY) throw new Error("GOVEE_API_KEY manquante dans les variables de Render.");

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
           (searchKey.includes("spot") && dName.includes("spot"));
  });

  if (!target) {
    const names = devices.map(d => d.deviceName).join(", ");
    throw new Error(`Appareil non trouvé sur Govee. Appareils dispo : [${names}]`);
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

// Création Serveur MCP
const server = new Server(
  { name: "bouboule-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Exposition d'un seul outil global pour que Xiaozhi ne cherche pas
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "control_device",
      description: "Contrôle tous les appareils domotiques (lumières couloir, cuisine, spot, musique, hifi, ventilateur, tv, pc).",
      inputSchema: {
        type: "object",
        properties: {
          device_name: { type: "string" },
          action: { type: "string", enum: ["on", "off"] },
          state: { type: "string", enum: ["on", "off"] }
        },
        required: ["device_name"]
      }
    }
  ]
}));

// Exécution des commandes sans faire planter le serveur
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments || {};
    const rawDevice = args.device_name || "";
    const cleanName = normalizeText(rawDevice);
    const isTurnOn = (args.action === "on" || args.state === "on" || args.action === "allumer" || args.state === "allumer");

    console.log(`Ordre reçu pour : '${rawDevice}' (Action: ${isTurnOn ? 'ON' : 'OFF'})`);

    // 1. Routage Govee (Éclairages)
    if (cleanName.includes("couloir") || cleanName.includes("cuisine") || cleanName.includes("spot") || cleanName.includes("lumiere") || cleanName.includes("govee")) {
      const matched = await controlGoveeDevice(rawDevice, isTurnOn);
      return { content: [{ type: "text", text: `Govee '${matched}' ${isTurnOn ? 'allumé' : 'éteint'}.` }] };
    }

    // 2. Routage Tuya (Prises / HiFi / Musique / Ventilateurs / TV)
    const deviceId = TUYA_DEVICES[cleanName];
    if (deviceId) {
      await controlTuyaDevice(deviceId, isTurnOn);
      return { content: [{ type: "text", text: `Tuya '${rawDevice}' ${isTurnOn ? 'allumé' : 'éteint'}.` }] };
    }

    // 3. Secours : Tentative sur Govee si absent de la liste Tuya
    const matched = await controlGoveeDevice(rawDevice, isTurnOn);
    return { content: [{ type: "text", text: `Govee '${matched}' ${isTurnOn ? 'allumé' : 'éteint'}.` }] };

  } catch (err) {
    console.error("Erreur commande :", err.message);
    return {
      content: [{ type: "text", text: `Ça coince : ${err.message}` }],
      isError: true
    };
  }
});

// Connexion WebSocket Xiaozhi
const wsUrl = process.env.XIAOZHI_MCP_URL;
if (wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => console.log("Connecté au serveur MCP Xiaozhi !"));
  ws.on("error", (err) => console.error("Erreur WS :", err.message));
}

// Empêcher la fermeture inattendue de Node.js sur Render
process.on("uncaughtException", (err) => console.error("Erreur non capturée :", err));
process.on("unhandledRejection", (reason) => console.error("Rejet non géré :", reason));
