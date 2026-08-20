const WebSocket = require('ws');
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
                    enum: ['Télé', 'Ampli', 'Ruban', 'Ventilateur salon', 'Ventilateur chambre', 'Spot cuisine', 'Spot couloir']
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
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `C'est fait, le ${device_name} est ${state === 'on' ? 'allumé' : 'éteint'}.` }]
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
