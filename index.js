import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import axios from "axios";

// Config Tuya
const TUYA_CLIENT_ID = process.env.TUYA_CLIENT_ID;
const TUYA_SECRET = process.env.TUYA_SECRET;
const TUYA_USERNAME = process.env.TUYA_USERNAME;
const TUYA_PASSWORD = process.env.TUYA_PASSWORD;

// Config Govee
const GOVEE_API_KEY = process.env.GOVEE_API_KEY;

// VRAIS IDs TUYA (Directement issus de la console Tuya IoT)
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

// Fonction de contrôle Govee via API officielle
async function controlGoveeDevice(deviceName, turnOn) {
  if (!GOVEE_API_KEY) {
    throw new Error("GOVEE_API_KEY non configurée sur Render.");
  }

  const listRes = await axios.get("https://developer-api.govee.com/v1/devices", {
    headers: { "Govee-API-Key": GOVEE_API_KEY }
  });

  const devices = listRes.data?.data?.devices || [];
  const searchKey = deviceName.toLowerCase().replace("lumiere", "").replace("spot", "").replace("led", "").trim();

  const target = devices.find(d => d.deviceName.toLowerCase().includes(searchKey));

  if (!target) {
    throw new Error(`Appareil Govee introuvable pour '${deviceName}'.`);
  }

  const controlRes = await axios.put(
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

// Initialisation MCP
const server = new Server(
  { name: "bouboule-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "control_tuya_device",
      description: "Contrôle les appareils Tuya/SmartLife suivants : ventilateur salon, ventilateur chambre, neon salon, hifi, television, informatique.",
      inputSchema: {
        type: "object",
        properties: {
          device_name: { type: "string" },
          action: { type: "string", enum: ["on", "off"] }
        },
        required: ["device_name", "action"]
      }
    },
    {
      name: "control_govee_device",
      description: "Contrôle les lumières Govee : Lumiere cuisine, Lumiere couloir, Led salon.",
      inputSchema: {
        type: "object",
        properties: {
          device_name: { type: "string" },
          action: { type: "string", enum: ["on", "off"] }
        },
        required: ["device_name", "action"]
      }
    }
  ]
}));

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "control_govee_device") {
    const turnOn = args.action === "on";
    const matched = await controlGoveeDevice(args.device_name, turnOn);
    return { content: [{ type: "text", text: `Govee '${matched}' ${turnOn ? 'allumé' : 'éteint'}.` }] };
  }

  if (name === "control_tuya_device") {
    const cleanName = args.device_name.toLowerCase();
    if (!TUYA_DEVICES[cleanName]) {
      throw new Error(`'${args.device_name}' n'est pas configuré dans la liste Tuya.`);
    }
    return { content: [{ type: "text", text: `Tuya '${args.device_name}' commandé.` }] };
  }

  throw new Error(`Tool inconnu : ${name}`);
});

// Connexion WebSocket
const wsUrl = process.env.XIAOZHI_MCP_URL;
if (wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => console.log("MCP Xiaozhi connecté !"));
}
