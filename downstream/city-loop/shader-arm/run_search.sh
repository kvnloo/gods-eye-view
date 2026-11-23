# usage (env): LABEL=<label> CANDS=<file under ~/arm> BEATS=district,build,growth PORT=4301 QUERYX=''
# Runs one vite + search.mjs; output in ~/arm/out/$LABEL. Detached-safe.
set -uo pipefail
APP=~/gev-src
OUT=~/arm/out/$LABEL
mkdir -p $OUT
cd $APP
( exec npx vite --host 127.0.0.1 --port $PORT --strictPort ) > $OUT/vite.log 2>&1 &
VP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:$PORT/ >/dev/null && break; sleep 1; done
curl -sf -o /dev/null http://127.0.0.1:$PORT/src/standalone/cozyShaderLook.js && echo look-served || echo look-NOT-served
timeout ${TMO:-3000} node ~/arm/search.mjs --app $APP --url http://127.0.0.1:$PORT --out $OUT --label $LABEL \
  --query "cityR1=all${QUERYX:-}" --cands ~/arm/$CANDS --beats ${BEATS:-district,build,growth} > $OUT/run.log 2>&1
echo "rc=$?" >> $OUT/run.log
kill $VP 2>/dev/null; pkill -P $VP 2>/dev/null
sed -i -E 's/(token|key|access_token)=[^& "]+/\1=REDACTED/Ig' $OUT/vite.log
echo done > $OUT/DONE
