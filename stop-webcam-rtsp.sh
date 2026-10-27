#!/bin/bash

pkill -f "ffmpeg -f avfoundation.*rtsp://localhost:8554/webcam"
pkill -f "mediamtx /opt/homebrew/etc/mediamtx/mediamtx.yml"
