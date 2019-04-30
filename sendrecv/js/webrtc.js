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
// The default constraints that will be attempted. Can be overriden by the user.
const default_constraints = {video: true, audio: true};

let connect_attempts = 0;
let peerConnection;
let sendChannel;
let ws_conn;
// Promise for local stream after constraints are approved by the user
let local_stream_promise;

function getRandomId() {
    return Math.floor(Math.random() * (9000 - 10) + 10).toString();
}

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
    // Release the webcam and mic
    if (local_stream_promise)
        local_stream_promise.then(stream => {
            if (stream) {
                stream.getTracks().forEach(function (track) { track.stop(); });
            }
        });

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
        setStatus("Got SDP offer");
        local_stream_promise.then((stream) => {
            setStatus("Got local stream, creating answer");
            peerConnection.createAnswer()
            .then(onLocalDescription).catch(setError);
        }).catch(setError);
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
    console.log("Received " + event.data);
    if (event.data === "HELLO") {
        setStatus("Registered with server, waiting for call");
    } else {
        if (event.data.startsWith("ERROR")) {
            handleIncomingError(event.data);
            return;
        }
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            if (e instanceof SyntaxError) {
                handleIncomingError("Error parsing incoming JSON: " + event.data);
            } else {
                handleIncomingError("Unknown error parsing response: " + event.data);
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

function getConstraintsTextArea() {
    return document.getElementById('constraints');
}

function getLocalStream() {
    let constraints;
    let constraintsTextArea = getConstraintsTextArea();
    try {
        constraints = JSON.parse(constraintsTextArea.value);
    } catch (e) {
        console.error(e);
        setError('ERROR parsing constraints: ' + e.message + ', using default constraints');
        constraints = default_constraints;
    }
    console.log(JSON.stringify(constraints));

    // Add local stream
    if (navigator.mediaDevices.getUserMedia) {
        return navigator.mediaDevices.getUserMedia(constraints);
    } else {
        errorUserMediaHandler();
    }
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
    // Populate constraints
    let constraintsTextArea = getConstraintsTextArea();
    if (constraintsTextArea.value === '')
        constraintsTextArea.value = JSON.stringify(default_constraints);
    // Fetch the peer id to use
    let peer_id = default_peer_id || getRandomId();
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
        document.getElementById("peer-id").textContent = peer_id;
        ws_conn.send('HELLO ' + peer_id);
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

function errorUserMediaHandler() {
    setError("Browser doesn't support getUserMedia!");
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
    /* Send our video/audio to the other peer */
    local_stream_promise = getLocalStream().then((stream) => {
        console.log('Adding local stream');
        peerConnection.addStream(stream);
        return stream;
    }).catch(setError);

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
