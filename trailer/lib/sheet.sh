#!/bin/bash
# גיליון תמונות מקובץ וידאו, לבדיקה בעין: sheet.sh <video> <out.jpg> [every_n_frames=8] [cols=6] [thumb_width=420]
set -e
IN="$1"; OUT="$2"; STEP="${3:-8}"; COLS="${4:-6}"; W="${5:-420}"
N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$IN")
ROWS=$(( (N / STEP + COLS) / COLS ))
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error -i "$IN" -vf "select='not(mod(n\,$STEP))',scale=$W:-1,tile=${COLS}x${ROWS}" -frames:v 1 -q:v 3 "$OUT"
echo "$OUT ($N frames, every $STEP)"
