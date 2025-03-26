const net = require("net");
const os = require("os");
const crypto = require("crypto");
const singleton = require("./Singleton");
const heartbeat = require("./Heartbeat");

const HEARTBEAT_INTERVAL = 20000; // 20 seconds for heartbeat messages
const NUM_BUCKETS = 16;           // 16 k-buckets

let peerName = "";
let targetPeer = null;  // flag for -p in terminal interface
let peerID = "";
let myIP = "";
let myPort = 0;
let routingTable = createRoutingTable(NUM_BUCKETS);
let missedHeartbeats = {}; // key: peerID, value: count of missed heartbeats



// Create an empty routing table with NUM_BUCKETS buckets, where each bucket is an array (to hold up to 2 peers).
function createRoutingTable(numBuckets) {
  let table = [];
  for (let i = 0; i < numBuckets; i++) {
    table.push([]); // each bucket is an array
  }
  return table;
}

// Helper: Calculate bucket index based on shared prefix (matching hex digits).
function getBucketIndex(id1, id2) {
  let match = 0;
  for (let i = 0; i < Math.min(id1.length, id2.length); i++) {
    if (id1[i] === id2[i]) {
      match++;
    } else {
      break;
    }
  }
  return Math.min(match, NUM_BUCKETS - 1);
}

// Helper: Compute XOR distance between two peer IDs (given as hex strings).
function computeXORDistance(id1, id2) {
  const int1 = parseInt(id1, 16);
  const int2 = parseInt(id2, 16);
  return int1 ^ int2;
}

// pushBucket: Used when handling a join request on the server side.
// For k=1, we allow only one peer per bucket.
function pushBucket(newPeer) {
  // Record the lastSeen time using the singleton's timer.
  newPeer.lastSeen = singleton.getTimestamp();
  
  let bucketIndex = getBucketIndex(peerID, newPeer.peerID);
  let bucket = routingTable[bucketIndex];

  if (bucket.length < 1) {
    bucket.push(newPeer);
    console.log(`Bucket ${bucketIndex} was empty. Added new peer ${newPeer.peerID} (${newPeer.ip}:${newPeer.port}).`);
  } else {
    console.log(`Bucket ${bucketIndex} is full. Evaluating new peer ${newPeer.peerID} vs existing peer ${bucket[0].peerID}.`);
    let existingPeer = bucket[0];
    let distanceExisting = computeXORDistance(peerID, existingPeer.peerID);
    let distanceNew = computeXORDistance(peerID, newPeer.peerID);

    if (distanceNew < distanceExisting) {
      bucket[0] = newPeer;
      console.log(`Replaced peer ${existingPeer.peerID} with new peer ${newPeer.peerID} (distance: ${distanceNew} < ${distanceExisting}).`);
    } else if (distanceNew === distanceExisting) {
      if (existingPeer.lastSeen < newPeer.lastSeen) {
        bucket[0] = newPeer;
        console.log(`Replaced older peer ${existingPeer.peerID} with new peer ${newPeer.peerID} (equal distance; lastSeen: ${existingPeer.lastSeen} < ${newPeer.lastSeen}).`);
      } else {
        console.log(`Kept existing peer ${existingPeer.peerID} (equal distance and more recently seen).`);
      }
    } else {
      console.log(`Kept existing peer ${existingPeer.peerID} (closer: ${distanceExisting} < ${distanceNew}).`);
    }
  }
  
}

// refreshBuckets: Used on the client side when a welcome message is received.
// Allows up to 2 peers per bucket.
function refreshBuckets(routingTable, peerList) {
  peerList.forEach(peer => {
    peer.lastSeen = singleton.getTimestamp();
    let bucketIndex = getBucketIndex(peerID, peer.peerID);
    let bucket = routingTable[bucketIndex];

    if (bucket.length < 2) {
      bucket.push(peer);
      console.log(`Bucket ${bucketIndex} was not full. Added peer ${peer.peerID}.`);
    } else {
      let replaced = false;
      for (let i = 0; i < bucket.length; i++) {
        let existingPeer = bucket[i];
        let distanceExisting = computeXORDistance(peerID, existingPeer.peerID);
        let distanceNew = computeXORDistance(peerID, peer.peerID);

        if (distanceNew < distanceExisting) {
          console.log(`Bucket ${bucketIndex}: Replacing peer ${existingPeer.peerID} with new peer ${peer.peerID} because ${distanceNew} < ${distanceExisting}.`);
          bucket[i] = peer;
          replaced = true;
          break;
        } else if (distanceNew === distanceExisting) {
          if (peer.lastSeen > existingPeer.lastSeen) {
            console.log(`Bucket ${bucketIndex}: Replacing older peer ${existingPeer.peerID} with new peer ${peer.peerID} (newer lastSeen).`);
            bucket[i] = peer;
            replaced = true;
            break;
          }
        }
      }
      if (!replaced) {
        console.log(`Bucket ${bucketIndex}: Kept existing peers; new peer ${peer.peerID} not added.`);
      }
    }
  });
}


/**
 * parseJoinRequest:
 * A stub parser that extracts the joining peer's name and peerID from the received data.
 * Expected format: "Join request from <peerName> [<peerID>]"
 */
function parseJoinRequest(data, socket) {
  const str = data.toString();
  let nameMatch = str.match(/from\s+(\S+)/);
  let idMatch = str.match(/\[(\w+)\]/);
  const newPeerName = nameMatch ? nameMatch[1] : "unknown";
  const newPeerID = idMatch ? idMatch[1] : "xxxx";
  return {
    peerName: newPeerName,
    peerID: newPeerID,
    ip: socket.remoteAddress,
    port: socket.remotePort
  };
}

// function to build a welcome message to send to a new peer joining the network. Includes version, name, number of known peers, and message type
function buildWelcomeMessage(routingTable, myName) {
  const version = 18;
  const msgType = 2;
  // Flatten the routing table buckets into a single array.
  const knownPeers = routingTable.reduce((acc, bucket) => acc.concat(bucket), []);
  const numPeers = knownPeers.length;
  const senderNameLength = Buffer.byteLength(myName, "utf-8");

  let header = Buffer.alloc(5);
  header.writeUInt8(version, 0);
  header.writeUInt8(msgType, 1);
  header.writeUInt8(numPeers, 2);
  header.writeUInt16BE(senderNameLength, 3);

  let senderNameBuffer = Buffer.from(myName, "utf-8");

  return Buffer.concat([header, senderNameBuffer]);
}

// Parse the welcome message received from a peer.
function parseWelcomeMessage(data) {
  // Header is 5 bytes: version (1), msgType (1), numPeers (1), senderNameLength (2)
  const version = data.readUInt8(0);
  const msgType = data.readUInt8(1);
  const numPeers = data.readUInt8(2);
  const senderNameLength = data.readUInt16BE(3);
  const senderName = data.slice(5, 5 + senderNameLength).toString("utf-8");
  return { version, msgType, numPeers, senderName };
}

// Parse request, send welcome, and add to routing table.
function handleClientJoining(socket, data, context, pushBucketCallback) {
  const newPeerInfo = parseJoinRequest(data, socket);
  console.log(`New join request from: name=${newPeerInfo.peerName}, ID=${newPeerInfo.peerID}`);
  
  const welcomeMsg = buildWelcomeMessage(context.routingTable, context.myName);
  socket.write(welcomeMsg);
  console.log(`Sent welcome message to ${newPeerInfo.peerName}`);
  
  pushBucketCallback(newPeerInfo);
}

// Generate a peer ID (2-byte, 4 hex characters) using our IP and port.
function generatePeerID(ip, port) {
  const data = `${ip}:${port}`;
  return crypto.createHash("blake2s256").update(data).digest("hex").slice(0, 4);
}

// Determine the local IPv4 address.
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}


function removePeerFromRoutingTable(peer) {
  for (let i = 0; i < routingTable.length; i++) {
    let bucket = routingTable[i];
    for (let j = 0; j < bucket.length; j++) {
      if (bucket[j].peerID === peer.peerID) {
        console.log(`Removing peer ${peer.peerID} from bucket ${i}.`);
        bucket.splice(j, 1);
        break;
      }
    }
  }
}

// Starts server on a given port and IP address
function startServer() {
  const server = net.createServer((socket) => {
    console.log(`Incoming connection from ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on("data", (data) => {
      handleClientJoining(socket, data, { myName: peerName, myID: peerID, routingTable }, pushBucket);
    });

    socket.on("end", () => {
      console.log(`Connection ended from ${socket.remoteAddress}:${socket.remotePort}`);
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err.message);
    });
  });

  server.listen(0, () => {
    myPort = server.address().port;
    myIP = getLocalIPAddress();
    peerID = generatePeerID(myIP, myPort);

    console.log(`DHTPeer '${peerName}' is listening on ${myIP}:${myPort}`);
    console.log(`Assigned Peer ID: [${peerID}]`);
  });
}

// Code to join the network by connecting to a target peer.
function joinNetwork() {
  if (!targetPeer) return;

  const client = new net.Socket();
  client.connect(targetPeer.port, targetPeer.ip, () => {
    console.log(`Connected to target peer at ${targetPeer.ip}:${targetPeer.port}`);
    client.write(`Join request from ${peerName} [${peerID}]`);
  });

  client.on("data", (data) => {
    // Parse the welcome message received from the target peer.
    const welcome = parseWelcomeMessage(data);
    console.log("Received welcome from target peer:");
    console.log(`Version: ${welcome.version}`);
    console.log(`Message Type: ${welcome.msgType}`);
    console.log(`Number of known peers: ${welcome.numPeers}`);
    console.log(`Sender Name: ${welcome.senderName}`);

  });

  client.on("close", () => {
    console.log("Connection closed by target peer.");
  });
}
// Parse command line arguments to get peer name and target peer IP/port.
function parseArguments() {
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf("-n");
  const peerIndex = args.indexOf("-p");

  if (nameIndex < 0 || !args[nameIndex + 1]) {
    console.error("Usage: node DHTPeer -n <peerName> [-p <peerIP>:<port>]");
    process.exit(1);
  }

  peerName = args[nameIndex + 1];
  if (peerIndex >= 0 && args[peerIndex + 1]) {
    const [ip, port] = args[peerIndex + 1].split(":");
    targetPeer = { ip, port: parseInt(port) };
  }
}

function main() {
  parseArguments();
  singleton.init(); // Initialize timer and sequence number
  startServer();

  if (targetPeer) {
    setTimeout(joinNetwork, 1000);
  }

  // COMMENT OUT TO REMOVE HEARTBEAT MECHANISMS (for debugging) -------------------
  setInterval(() => {
    heartbeat.sendHeartbeats(routingTable, missedHeartbeats, removePeerFromRoutingTable);
  }, HEARTBEAT_INTERVAL);
  // ------------------------------------------------------------------------------
}

main();