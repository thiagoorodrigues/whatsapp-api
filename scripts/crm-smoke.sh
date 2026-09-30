#!/usr/bin/env bash
# CRM API smoke test against a running backend. Usage:
#   TOKEN=<jwt> API=http://localhost:3001 CONTACT_ID=<id> scripts/crm-smoke.sh
set -euo pipefail
API=${API:-http://localhost:3001}
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
call() { curl -s -o /tmp/crm-smoke.json -w "%{http_code}" -X "$1" "${H[@]}" "$API$2" ${3:+-d "$3"}; }
expect() { local got; got=$(call "$1" "$2" "${4:-}"); if [ "$got" != "$3" ]; then echo "FAIL $1 $2 -> $got (esperado $3)"; cat /tmp/crm-smoke.json; exit 1; fi; echo "ok   $1 $2 -> $got"; }
jqv() { node -e "const d=require('/tmp/crm-smoke.json');console.log($1)"; }

expect POST /crm/funnels 201 '{"name":"Smoke"}'
FUNNEL=$(jqv 'd.id'); OPEN1=$(jqv 'd.stages[0].id'); OPEN2=$(jqv 'd.stages[1].id')
WON=$(jqv 'd.stages.find(s=>s.kind==="won").id'); LOST=$(jqv 'd.stages.find(s=>s.kind==="lost").id')
expect GET /crm/funnels 200
expect POST /crm/deals 201 "{\"funnelId\":$FUNNEL,\"contactId\":$CONTACT_ID,\"value\":\"1200,50\"}"
DEAL=$(jqv 'd.id')
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$OPEN2}"
expect PUT /crm/deals/$DEAL/move 400 "{\"stageId\":$LOST}"
expect GET /crm/loss-reasons 200
REASON=$(jqv 'd[0].id')
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$LOST,\"lossReasonId\":$REASON}"
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$OPEN1}"
expect GET /crm/deals/$DEAL 200
jqv 'd.events.map(e=>e.type).join(",")'
expect GET "/crm/funnels/$FUNNEL/deals" 200
expect GET /crm/deals/999999 404
expect PUT /crm/funnels/$FUNNEL/stages/$WON 400 '{"archived":true}'
expect DELETE /crm/funnels/$FUNNEL/stages/$OPEN1 400
expect POST /crm/funnels 403 '{"name":"Passa do limite"}'
expect POST /crm/funnels/$FUNNEL/archive 200 '{"archived":true}'
echo "smoke ok (funil $FUNNEL arquivado)"
