#!/bin/bash

/opt/homebrew/opt/mediamtx/bin/mediamtx /opt/homebrew/etc/mediamtx/mediamtx.yml &

sleep 1

ffmpeg -f avfoundation -framerate 30 -video_size 1280x720 -i 0 -pix_fmt yuv420p -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency -f rtsp rtsp://localhost:8554/webcam &
