const http = require('http');
const WebSocket = require('ws');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// Petit serveur HTTP pour Render
const port = process.env.PORT || 10000;
http.createServer((req, res) => res.end('OK')).listen(port);

// Initialisation du client Tuya (Région EU par défaut)
const tuya = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: process.env.TUYA_CLIENT_ID,
  secretKey: process.env.TUYA_SECRET,
});

// Table de correspondance Noms <-> ID d'appareils Tuya
// (Remplace les 'ID_...' par les vrais IDs de ton app Smart Life / Tuya IoT)
const DEVICE_IDS = {
  'Télé': 'ID_TELE',
  'Ampli': 'ID_AMPLI',
  'Ruban': 'ID_RUBAN',
  'Ventilateur salon': 'ID_VENTILATEUR_SALON',
  'Ventilateur chambre': 'ID_VENTILATEUR_CHAMBRE',
  'Spot cuisine': 'ID_SPOT_CUISINE',
  'Spot couloir': 'ID_SPOT_COULOIR'
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
    try {
      const msg = JSON.parse(data.toString());

      if (msg.method === 'tools/list') {
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
                    enum: Object.keys(DEVICE_IDS)
                  },
                  state: { type: 'string', enum: ['on', 'off'] }
                },
                required: ['device_name', 'state']
              }
            }]
          }
        }));
      } else if (msg.method === 'tools/call' && msg.params?.name === 'control_tuya_device') {
        const { device_name, state } = msg.params.arguments;
        const deviceId = DEVICE_IDS[device_name];

        let resultText = '';

        if (!deviceId || deviceId.startsWith('ID_')) {
          resultText = `Erreur : l'ID Tuya pour ${device_name} n'est pas renseigné dans le code.`;
        } else {
          try {
            // Envoi de la commande réelle à l'API Tuya
            await tuya.request({
              path: `/v1.0/devices/${deviceId}/commands`,
              method: 'POST',
              body: {
                commands: [{ code: 'switch_1', value: state === 'on' }]
              }
            });
            resultText = `C'est fait, le ${device_name} est ${state === 'on' ? 'allumé' : 'éteint'}.`;
          } catch (tuyaErr) {
            console.error('Erreur Tuya :', tuyaErr);
            resultText = `Problème lors du contrôle du ${device_name}.`;
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
