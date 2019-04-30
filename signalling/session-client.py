#!/usr/bin/env python3
#
# Test client for simple 1-1 call signalling server
#
# Copyright (C) 2017 Centricular Ltd.
#
#  Author: Nirbheek Chauhan <nirbheek@centricular.com>
#

import argparse
import asyncio
import json
import ssl
import sys

import websockets

parser = argparse.ArgumentParser(formatter_class=argparse.ArgumentDefaultsHelpFormatter)
parser.add_argument('--url', default='wss://localhost:8443', help='URL to connect to')
parser.add_argument('--call', default=None, help='uid of peer to call')

options = parser.parse_args(sys.argv[1:])

SERVER_ADDR = options.url
CALLEE_ID = options.call

sslctx = False
if SERVER_ADDR.startswith(('wss://', 'https://')):
    sslctx = ssl.create_default_context()
    # FIXME
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE


def reply_sdp_ice(msg):
    # Here we'd parse the incoming JSON message for ICE and SDP candidates
    print("Got: " + msg)
    reply = json.dumps({'sdp': 'reply sdp'})
    print("Sent: " + reply)
    return reply


def send_sdp_ice():
    reply = json.dumps({'sdp': 'initial sdp'})
    print("Sent: " + reply)
    return reply


async def hello():
    async with websockets.connect(SERVER_ADDR, ssl=sslctx) as ws:
        await ws.send('HELLO')
        res = await ws.recv()
        res = res.split(maxsplit=1)
        assert (res[0] == 'HELLO')
        if len(res) > 1:
            uid = res[1]
            print("Got UID from server:", uid)

        # Initiate call if requested
        if CALLEE_ID:
            await ws.send('SESSION {}'.format(CALLEE_ID))

        # Receive messages
        sent_sdp = False
        while True:
            msg = await ws.recv()
            if msg.startswith('ERROR'):
                # On error, we bring down the webrtc pipeline, etc
                print('{!r}, exiting'.format(msg))
                return
            if sent_sdp:
                print('Got reply sdp: ' + msg)
                return  # Done
            if CALLEE_ID:
                if msg == 'SESSION_OK':
                    await ws.send(send_sdp_ice())
                    sent_sdp = True
                else:
                    print('Unknown reply: {!r}, exiting'.format(msg))
                    return
            else:
                await ws.send(reply_sdp_ice(msg))
                return  # Done


try:
    asyncio.get_event_loop().run_until_complete(hello())
except websockets.exceptions.InvalidHandshake:
    print('Invalid handshake: are you sure this is a websockets server?\n')
    raise
except ssl.SSLError:
    print('SSL Error: are you sure the server is using TLS?\n')
    raise
