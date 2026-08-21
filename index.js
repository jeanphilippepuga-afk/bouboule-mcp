import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocket } from "ws";
import axios from "axios";
import crypto from "crypto";

// Config Tuya
const TUYA_CLIENT_ID = process.env.TUYA_CLIENT_ID;
const TUYA_SECRET = process.env.TUYA_SECRET;

// Config Govee
const GOVEE_API_KEY = process.env.GOVEE_API_KEY;

// Table des appareils Tuya autorisés
const TUYA_DEVICES = {
  "ventilateur salon": "bf09710e9bb5de233dfltn",
  "ventilateur chambre": "bf6cedea4ebc7d8f5eh9di",
  "neon salon": "bfe70cfada2d079843d2sm",
  "neon": "bfe70cfada2d079843d2sm",
  "ruban": "bfe70cfada2d079843d2sm",
  "hifi": "bff13ef303c235bff5ctrs",
  "ampli": "bff13ef303c235bff5ctrs",
  "television": "bfff3c709b433af741t9dz",
  "tele": "bfff3c709b433af741t9dz",
  "informatique": "bf5406yyctvuikg1",
  "pc": "bf5406yyctvuikg1"
};

// Helper Tuya API
async function getTuyaToken() {
  const t = Date.now().toString();
  const nonce = "";
  const stringToSign = ["GET", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "", "/v1.0/token?grant_type=1"].join("\n");
  const signStr = TUYA_CLIENT_ID + t + nonce + stringToSign;
  const sign = crypto.createHmac("sha256", TUYA_SECRET).update(signStr).digest("HEX").toUpperCase();

  const res = await axios.get("https://openapi.tuyaeu.com/v1/token?grant_type=1", {
    headers: { client_id: TUYA_CLIENT_ID, sign, t, sign_method: "HMAC-SHA256" }
  });
  return res.data?.result?.access_token;
}

async function controlTuyaDevice(deviceId, turnOn) {
  const token = await getTuyaToken();
  const t = Date.now().toString();
  const body = JSON.stringify({ commands: [{ code: "switch_led", value: turnOn }, { code: "switch_1", value: turnOn }] });
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

// Normalisation texte
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Control Govee
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
           (searchKey.includes("salon") && dName.includes("salon"));
  });

  if (!target) {
    const listNames = devices.map(d => d.deviceName).join(", ");
    throw new Error(`Appareil Govee non trouvé pour '${deviceName}'. Appareils Govee disponibles : [${listNames}]`);
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

// Serveur MCP
const server = new Server(
  { name: "bouboule-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "control_tuya_device",
      description: "Contrôle EXCLUSIVEMENT : ventilateur salon, ventilateur chambre, neon salon, hifi, television, informatique. INTERDIT pour les lumières Govee.",
      inputSchema: {
        type: "object",
        properties: {
          device_name: { type: "string" },
          action: { type: "string", enum: ["on", "off"] },
          state: { type: "string", enum: ["on", "off"] }
        },
        required: ["device_name"]
      }
    },
    {
      name: "control_govee_device",
      description: "Contrôle TOUS les éclairages Govee : Lumière Cuisine, Lumière Couloir, Led salon.",
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const cleanName = normalizeText(args.device_name || "");
  const isTurnOn = (args.action === "on" || args.state === "on");

  // Sécurité : Refus strict des lumières Govee envoyées sur Tuya
  if (name === "control_tuya_device") {
    if (cleanName.includes("couloir") || cleanName.includes("cuisine") || cleanName.includes("lumiere")) {
      throw new Error(`REFUS : '${args.device_name}' est une lumière Govee ! Tu DOIS obligatoirement appeler l'outil control_govee_device.`);
    }

    const deviceId = TUYA_DEVICES[cleanName];
    if (!deviceId) {
      throw new Error(`ERREUR : '${args.device_name}' n'est pas un appareil Tuya. Utilise control_govee_device pour les lumières.`);
    }

    await controlTuyaDevice(deviceId, isTurnOn);
    return { content: [{ type: "text", text: `Tuya '${args.device_name}' commandé.` }] };
  }

  if (name === "control_govee_device") {
    const matched = await controlGoveeDevice(args.device_name, isTurnOn);
    return { content: [{ type: "text", text: `Govee '${matched}' ${isTurnOn ? 'allumé' : 'éteint'}.` }] };
  }

  throw new Error(`Tool inconnu : ${name}`);
});

// WebSocket
const wsUrl = process.env.XIAOZHI_MCP_URL;
if (wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => console.log("MCP Xiaozhi connecté !"));
}
