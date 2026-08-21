const http = require('http');
const WebSocket = require('ws');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// Mini serveur HTTP pour maintenir Render actif
const port = process.env.PORT || 10000;
http.createServer((req, res) => res.end('OK')).listen(port);

// Connexion API Tuya Cloud (Region Central Europe)
const tuya = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: process.env.TUYA_CLIENT_ID?.trim(),
  secretKey: process.env.TUYA_SECRET?.trim(),
});

// Table des appareils actuellement EN LIGNE
const DEVICE_IDS = {
  'Ventilateur salon': 'bf09710e9bb5de233dfltn',
  'Neon salon': 'bfe70cfada2d079843d2sm',
  'Ruban': 'bfe70cfada2d079843d2sm',
  'Hi-fi': 'bff13ef303c235bff5ctrs',
  'Ventilateur chambre': 'bf6cedea4ebc7d8f5eh9di'
};

const url = process.env.XIAOZHI_MCP_URL;

function connect() {
  if (!url) {
    console.error("Variable XIAOZHI_MCP_URL manquante !");
    return;
  }

  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('Connecté en continu au serveur MCP Xiaozhi !');
  });

  ws.on('message', async (data) => {
    console.log('Message reçu de Xiaozhi :', data.toString());

    try {
      const msg = JSON.parse(data.toString());

      // Handshake MCP
      if (msg.method === 'initialize') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'bouboule-mcp-bridge', version: '1.0.0' }
          }
        }));
      } 
      else if (msg.method === 'notifications/initialized') {
        // Handshake OK
      }
      else if (msg.method === 'ping') {
        if (msg.id !== undefined) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        }
      }
      // Déclaration des outils
      else if (msg.method === 'tools/list') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{
              name: 'control_tuya_device',
              description: 'Pilote les équipements domotiques de l\'appartement',
              inputSchema: {
                type: 'object',
                properties: {
                  device_name: {
                    type: 'string',
                    description: 'Nom exact de l\'appareil'
                  },
                  state: { type: 'string', enum: ['on', 'off'] }
                },
                required: ['device_name', 'state']
              }
            }]
          }
        }));
      } 
      // Exécution des commandes
      else if (msg.method === 'tools/call' && msg.params?.name === 'control_tuya_device') {
        const { device_name, state } = msg.params.arguments;
        
        const matchedKey = Object.keys(DEVICE_IDS).find(
          k => k.toLowerCase() === device_name?.toLowerCase()
        ) || device_name;

        const deviceId = DEVICE_IDS[matchedKey];
        const isTurnOn = state === 'on';

        console.log(`Ordre exécuté : ${matchedKey} -> ${state} (ID: ${deviceId})`);

        let resultText = '';

        if (!deviceId) {
          resultText = `Erreur : l'appareil ${matchedKey} n'est pas reconnu ou est hors ligne.`;
        } else {
          try {
            const possibleCodes = ['switch_led', 'switch', 'switch_1', 'light'];
            let success = false;
            let response = null;

            for (const code of possibleCodes) {
              response = await tuya.request({
                path: `/v1.0/devices/${deviceId}/commands`,
                method: 'POST',
                body: { commands: [{ code: code, value: isTurnOn }] }
              });

              console.log(`Essai Tuya (${code}) :`, JSON.stringify(response));

              if (response && response.success) {
                success = true;
                break;
              }
            }

            if (success) {
              resultText = `C'est fait, le ${matchedKey} est ${isTurnOn ? 'allumé' : 'éteint'}.`;
            } else {
              resultText = `Impossible d'actionner le ${matchedKey}.`;
            }
          } catch (tuyaErr) {
            console.error('Erreur Tuya catch :', tuyaErr);
            resultText = `Erreur lors de la commande du ${matchedKey}.`;
          }
        }

        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: resultText }]
          }
        }));
      }
    } catch (e) {
      console.error('Erreur parsing JSON :', e);
    }
  });

  ws.on('close', () => {
    console.log('Connexion perdue. Reconnexion dans 5 secondes...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('Erreur WebSocket :', err.message);
  });
}

connect();
