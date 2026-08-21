// WebSocket avec Keep-Alive (Ping toutes les 15s pour éviter la coupure des 30s)
let pingInterval = null;

function connectWebSocket() {
  const wsUrl = process.env.XIAOZHI_MCP_URL;
  if (!wsUrl) return;

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("Connecté au serveur MCP Xiaozhi !");
    if (pingInterval) clearInterval(pingInterval);
    
    // Envoi d'un ping toutes les 15 secondes
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 15000);
  });

  ws.on("error", (err) => console.error("Erreur WS :", err.message));

  ws.on("close", () => {
    console.log("WebSocket fermé. Reconnexion dans 5 secondes...");
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(connectWebSocket, 5000);
  });
}

connectWebSocket();
