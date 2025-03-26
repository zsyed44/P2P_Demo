const net = require("net");

const RESPONSE_TIMEOUT = 5000; // 5 seconds

function buildHeartbeatMessage() {
  return Buffer.from("HEARTBEAT");
}

function isHeartbeatResponse(data) {
  return data.toString().includes("RESPONSE");
}

// Send a heartbeat message to a specific peer and handle response tracking.
function sendHeartbeatToPeer(peer, missedHeartbeats, removePeerCallback) {
  // Guard: Ensure the peer object has valid IP and port.
  if (!peer || !peer.ip || !peer.port) {
    console.error(`Skipping heartbeat for peer ${peer ? peer.peerID : 'unknown'} due to missing IP or port.`);
    return;
  }

  const client = new net.Socket();

  // Attempt connection using peer's port and IP.
  client.connect(peer.port, peer.ip, () => {
    const heartbeatMsg = buildHeartbeatMessage();
    client.write(heartbeatMsg);
    console.log(`Sent heartbeat to ${peer.peerID} at ${peer.ip}:${peer.port}`);
  });

  // Set a timeout waiting for a response.
  const responseTimeout = setTimeout(() => {
    missedHeartbeats[peer.peerID] = (missedHeartbeats[peer.peerID] || 0) + 1;
    console.log(`No heartbeat response from ${peer.peerID}. Missed count: ${missedHeartbeats[peer.peerID]}`);
    if (missedHeartbeats[peer.peerID] >= 3) {
      console.log(`Peer ${peer.peerID} removed due to missed heartbeats.`);
      removePeerCallback(peer);
    }
    client.destroy();
  }, RESPONSE_TIMEOUT);

  client.on("data", (data) => {
    if (isHeartbeatResponse(data)) {
      clearTimeout(responseTimeout);
      missedHeartbeats[peer.peerID] = 0; // Reset missed heartbeat count on response
      console.log(`Received heartbeat response from ${peer.peerID}`);
      client.destroy();
    }
  });

  client.on("error", (err) => {
    console.error(`Error with heartbeat to ${peer.peerID}: ${err.message}`);
    client.destroy();
  });
}

// Iterate over all peers in the routing table (assumed to be an array of buckets)
// and send a heartbeat to each peer.
function sendHeartbeats(routingTable, missedHeartbeats, removePeerCallback) {
  console.log("Sending heartbeat messages...");
  // If routingTable is structured as buckets (each bucket is an array), iterate over each bucket.
  routingTable.forEach(bucket => {
    bucket.forEach(peer => {
      if (peer) {
        sendHeartbeatToPeer(peer, missedHeartbeats, removePeerCallback);
      }
    });
  });
}

module.exports = {
  sendHeartbeats
};