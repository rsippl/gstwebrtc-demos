/* vim: set sts=4 sw=4 et :
 *
 * Demo Javascript app for negotiating and streaming a sendrecv webrtc stream
 * with a GStreamer app. Runs only in passive mode, i.e., responds to offers
 * with answers, exchanges ICE candidates, and streams.
 *
 * Author: Nirbheek Chauhan <nirbheek@centricular.com>
 */

// Set this to override the automatic detection in websocketServerConnect()
let ws_server;
let ws_port;
// Set this to use a specific peer id instead of a random one
// const default_peer_id=123;
let default_peer_id;
// Override with your own STUN servers if you want
const rtc_configuration = {iceServers: [{urls: "stun:stun.services.mozilla.com"},
                                      {urls: "stun:stun.l.google.com:19302"}]};

let connect_attempts = 0;
let peerConnection;
let sendChannel;
let ws_conn;

function resetState() {
    // This will call onServerClose()
    ws_conn.close();
}

function handleIncomingError(error) {
    setError("ERROR: " + error);
    resetState();
}

function getVideoElement() {
    return document.getElementById("stream");
}

function setStatus(text) {
    console.log(text);
    let span = document.getElementById("status");
    // Don't set the status if it already contains an error
    if (!span.classList.contains('error'))
        span.textContent = text;
}

function setError(text) {
    console.error(text);
    let span = document.getElementById("status");
    span.textContent = text;
    span.classList.add('error');
}

function resetVideo() {
    // Reset the video element and stop showing the last received frame
    let videoElement = getVideoElement();
    videoElement.pause();
    videoElement.src = "";
    videoElement.load();
}

// SDP offer received from peer, set remote description and create an answer
function onIncomingSDP(sdp) {
    peerConnection.setRemoteDescription(sdp).then(() => {
        setStatus("Remote SDP set");
        if (sdp.type !== "offer")
            return;
        setStatus("Got SDP offer, creating answer");
        peerConnection.createAnswer()
            .then(onLocalDescription).catch(setError);
    }).catch(setError);
}

// Local description was set, send it to peer
function onLocalDescription(desc) {
    console.log("Got local description: " + JSON.stringify(desc));
    peerConnection.setLocalDescription(desc).then(function() {
        setStatus("Sending SDP answer");
        let sdp = {'sdp': peerConnection.localDescription};
        ws_conn.send(JSON.stringify(sdp));
    });
}

// ICE candidate received from peer, add it to the peer connection
function onIncomingICE(ice) {
    let candidate = new RTCIceCandidate(ice);
    peerConnection.addIceCandidate(candidate).catch(setError);
}

function onServerMessage(event) {
    let data = event.data;
    console.log("Received " + data);
    if (data.startsWith("HELLO")) {
        setStatus("Registered with server, waiting for call");
        let tokens = data.split(" ");
        if (tokens.length > 1)
            document.getElementById("peer-id").textContent = tokens[1];
    } else {
        if (data.startsWith("ERROR")) {
            handleIncomingError(data);
            return;
        }
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            if (e instanceof SyntaxError) {
                handleIncomingError("Error parsing incoming JSON: " + data);
            } else {
                handleIncomingError("Unknown error parsing response: " + data);
            }
            return;
        }
        if (!peerConnection)
            createCall(msg);
        if (msg.sdp != null) {
            onIncomingSDP(msg.sdp);
        } else if (msg.ice != null) {
            onIncomingICE(msg.ice);
        } else {
            handleIncomingError("Unknown incoming JSON: " + msg);
        }
    }
}

function onServerClose(event) {
    setStatus('Disconnected from server');
    resetVideo();

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Reset after a second
    window.setTimeout(websocketServerConnect, 1000);
}

function onServerError(event) {
    setError("Unable to connect to server, did you add an exception for the certificate?");
    // Retry after 3 seconds
    window.setTimeout(websocketServerConnect, 3000);
}

function websocketServerConnect() {
    connect_attempts++;
    if (connect_attempts > 3) {
        setError("Too many connection attempts, aborting. Refresh page to try again");
        return;
    }
    // Clear errors in the status span
    let span = document.getElementById("status");
    span.classList.remove('error');
    span.textContent = '';

    ws_port = ws_port || '8443';
    if (window.location.protocol.startsWith ("file")) {
        ws_server = ws_server || "127.0.0.1";
    } else if (window.location.protocol.startsWith ("http")) {
        ws_server = ws_server || window.location.hostname;
    } else {
        throw new Error ("Don't know how to connect to the signalling server with uri" + window.location);
    }
    let ws_url = 'wss://' + ws_server + ':' + ws_port;
    setStatus("Connecting to server " + ws_url);
    ws_conn = new WebSocket(ws_url);
    /* When connected, immediately register with the server */
    ws_conn.addEventListener('open', (event) => {
        ws_conn.send('HELLO');
        setStatus("Registering with server");
    });
    ws_conn.addEventListener('error', onServerError);
    ws_conn.addEventListener('message', onServerMessage);
    ws_conn.addEventListener('close', onServerClose);
}

function onRemoteTrack(event) {
    if (getVideoElement().srcObject !== event.streams[0]) {
        console.log('Incoming stream');
        getVideoElement().srcObject = event.streams[0];
    }
}

const handleDataChannelOpen = (event) =>{
    console.log("dataChannel.OnOpen", event);
};

const handleDataChannelMessageReceived = (event) =>{
    console.log("dataChannel.OnMessage:", event, event.data.type);

    setStatus("Received data channel message");
    if (typeof event.data === 'string' || event.data instanceof String) {
        console.log('Incoming string message: ' + event.data);
        let textarea = document.getElementById("text");
        textarea.value = textarea.value + '\n' + event.data
    } else {
        console.log('Incoming data message');
    }
    sendChannel.send("Hi! (from browser)");
};

const handleDataChannelError = (error) =>{
    console.log("dataChannel.OnError:", error);
};

const handleDataChannelClose = (event) =>{
    console.log("dataChannel.OnClose", event);
};

function onDataChannel(event) {
    setStatus("Data channel created");
    let receiveChannel = event.channel;
    receiveChannel.onopen = handleDataChannelOpen;
    receiveChannel.onmessage = handleDataChannelMessageReceived;
    receiveChannel.onerror = handleDataChannelError;
    receiveChannel.onclose = handleDataChannelClose;
}

function createCall(msg) {
    // Reset connection attempts because we connected successfully
    connect_attempts = 0;

    console.log('Creating RTCPeerConnection');

    peerConnection = new RTCPeerConnection(rtc_configuration);
    sendChannel = peerConnection.createDataChannel('label', null);
    sendChannel.onopen = handleDataChannelOpen;
    sendChannel.onmessage = handleDataChannelMessageReceived;
    sendChannel.onerror = handleDataChannelError;
    sendChannel.onclose = handleDataChannelClose;
    peerConnection.ondatachannel = onDataChannel;
    peerConnection.ontrack = onRemoteTrack;

    if (!msg.sdp) {
        console.log("WARNING: First message wasn't an SDP message!?");
    }

    peerConnection.onicecandidate = (event) => {
        // We have a candidate, send it to the remote party with the
        // same uuid
        if (event.candidate == null) {
                console.log("ICE Candidate was null, done");
                return;
        }
        ws_conn.send(JSON.stringify({'ice': event.candidate}));
    };

    setStatus("Created peer connection for call, waiting for SDP");
}
