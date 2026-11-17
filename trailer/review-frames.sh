#!/usr/bin/env bash
# מחלץ פריימים וגיליונות מהטריילר המורכב, בשביל ביקורת בעין (out/review/<aspect>/).
# שימוש (מתוך trailer/): bash review-frames.sh [16x9|9x16|both]
set -euo pipefail
cd "$(dirname "$0")"
which="${1:-both}"
[ "$which" = both ] && aspects="16x9 9x16" || aspects="$which"
for a in $aspects; do
  f="out/subathon-trailer-$a.mp4"
  d="out/review/$a"
  rm -rf "$d"; mkdir -p "$d"
  if [ "$a" = 16x9 ]; then w=960; tw=480; cols=5; rows=5; else w=540; tw=270; cols=9; rows=3; fi
  # כל פריים שישי, עם מספר הפריים בשם הקובץ
  ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "select='not(mod(n\,6))',scale=$w:-2" -vsync 0 -q:v 3 -start_number 0 "$d/t_%04d.jpg"
  i=0; for t in "$d"/t_*.jpg; do mv "$t" "$d/$(printf 'f_%04d.jpg' $((i*6)))"; i=$((i+1)); done
  # גיליונות: כל פריים שישי עם מספר הפריים צרוב בפינה
  ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "select='not(mod(n\,6))',scale=$tw:-2,drawtext=text='%{eif\:n*6\:d}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4,tile=${cols}x${rows}:padding=3:margin=3" -vsync 0 -q:v 3 "$d/sheet-%02d.jpg"
  echo "$a: $(ls "$d"/f_*.jpg | wc -l) frames, $(ls "$d"/sheet-*.jpg | wc -l) sheets -> $d"
done
