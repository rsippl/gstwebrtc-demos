# GStreamer WebRTC demos

All demos use the same signalling server in the `signalling/` directory

For the Python code, make sure you have GStreamer 1.14.2 or later. This means that if you're on Ubuntu
18.10 or older, you'll need to build from source, e.g. via gst-build.

## Documentation

Currently, the best way to understand the API is to read the examples. This post breaking down the API should help with that:

http://blog.nirbheek.in/2018/02/gstreamer-webrtc.html

## Examples

### sendrecv: Send and receive audio and video

* Serve the `js/` directory on the root of your website, or open https://webrtc.nirbheek.in
  - The JS code assumes the signalling server is on port 8443 of the same server serving the HTML

* Open the website in a browser and ensure that the status is "Registered with server, waiting for call", and note the `id` too.

#### Running the C version

* Build the sources in the `gst/` directory on your machine. Use `make` or

```console
$ gcc webrtc-sendrecv.c $(pkg-config --cflags --libs gstreamer-webrtc-1.0 gstreamer-sdp-1.0 libsoup-2.4 json-glib-1.0) -o webrtc-sendrecv
```

* Run `webrtc-sendrecv --peer-id=ID` with the `id` from the browser. You will see state changes and an SDP exchange.

#### Running the Python version

* python3 -m pip install --user websockets
* run `python3 sendrecv/gst/webrtc-sendrecv.py ID` with the `id` from the browser. You will see state changes and an SDP exchange.

> The python version requires at least version 1.14.2 of gstreamer and its plugins.

#### Running the Rust version

* Install a recent Rust toolchain, e.g. via [rustup](https://rustup.rs/).
* Run `cargo build` for building the executable.
* Run `cargo run -- --peer-id=ID` with the `id` from the browser. You will see state changes and an SDP exchange.

With all versions, you will see a bouncing ball + hear red noise in the browser, and your browser's webcam + mic in the gst app.

You can pass a --server argument to all versions, for example `--server=wss://127.0.0.1:8443`.

#### Running the Java version

`cd sendrecv/gst-java`\
`./gradlew build`\
`java -jar build/libs/gst-java.jar --peer-id=ID` with the `id` from the browser.

You can optionally specify the server URL too (it defaults to wss://webrtc.nirbheek.in:8443):

`java -jar build/libs/gst-java.jar --peer-id=1 --server=ws://localhost:8443`

### multiparty-sendrecv: Multiparty audio conference with N peers

* Build the sources in the `gst/` directory on your machine

```console
$ gcc mp-webrtc-sendrecv.c $(pkg-config --cflags --libs gstreamer-webrtc-1.0 gstreamer-sdp-1.0 libsoup-2.4 json-glib-1.0) -o mp-webrtc-sendrecv
```

* Run `mp-webrtc-sendrecv --room-id=ID` with `ID` as a room name. The peer will connect to the signalling server and setup a conference room.
* Run this as many times as you like, each will spawn a peer that sends red noise and outputs the red noise it receives from other peers.
  - To change what a peer sends, find the `audiotestsrc` element in the source and change the `wave` property.
  - You can, of course, also replace `audiotestsrc` itself with `autoaudiosrc` (any platform) or `pulsesink` (on linux).
* TODO: implement JS to do the same, derived from the JS for the `sendrecv` example.

### TODO: Selective Forwarding Unit (SFU) example

* Server routes media between peers
* Participant sends 1 stream, receives n-1 streams

### TODO: Multipoint Control Unit (MCU) example

* Server mixes media from all participants
* Participant sends 1 stream, receives 1 stream
