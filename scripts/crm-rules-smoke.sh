#!/usr/bin/env bash
# Automatic CRM rules against a running backend. Needs an admin token, a
# non-group ticket and a queue of the same company. FUNNEL_ID is optional
# (defaults to the first active funnel). The ticket's contact must have no
# deal in that funnel; the deal the rule creates is deleted at the end. Usage:
#   TOKEN=<jwt> API=http://localhost:3001 TICKET_ID=<id> QUEUE_ID=<id> [FUNNEL_ID=<id>] scripts/crm-rules-smoke.sh
set -euo pipefail
API=${API:-http://localhost:3001}
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
call() { curl -s -o /tmp/crm-rules.json -w "%{http_code}" -X "$1" "${H[@]}" "$API$2" ${3:+-d "$3"}; }
expect() { local got; got=$(call "$1" "$2" "${4:-}"); if [ "$got" != "$3" ]; then echo "FAIL $1 $2 -> $got (esperado $3)"; cat /tmp/crm-rules.json; exit 1; fi; echo "ok   $1 $2 -> $got"; }
jqv() { node -e "const d=require('/tmp/crm-rules.json');console.log($1)"; }

expect GET /crm/funnels 200
FUNNEL=${FUNNEL_ID:-$(jqv 'd.find(f=>!f.archived).id')}
STAGE=$(jqv "d.find(f=>f.id===$FUNNEL).stages.find(s=>s.kind==='open'&&!s.archived).id")
WON=$(jqv "d.find(f=>f.id===$FUNNEL).stages.find(s=>s.kind==='won').id")
LOST=$(jqv "d.find(f=>f.id===$FUNNEL).stages.find(s=>s.kind==='lost').id")
expect GET /crm/loss-reasons 200
REASON=$(jqv 'd.find(r=>r.active).id')
expect POST /crm/rules 400 "{\"funnelId\":$FUNNEL,\"stageId\":$STAGE}"
expect POST /crm/rules 400 "{\"funnelId\":$FUNNEL,\"stageId\":$WON}"
expect POST /crm/rules 400 "{\"funnelId\":$FUNNEL,\"stageId\":$STAGE,\"queueId\":999999}"
expect POST /crm/rules 201 "{\"funnelId\":$FUNNEL,\"stageId\":$STAGE,\"queueId\":$QUEUE_ID}"
RULE=$(jqv 'd.id')
expect GET /crm/rules 200

expect GET /tickets/$TICKET_ID 200
CONTACT=$(jqv 'd.contactId'); ORIGINAL_QUEUE=$(jqv 'd.queueId === null ? "null" : d.queueId')
# The contact must never have had a deal in this funnel (rules skip returning contacts).
expect PUT /tickets/$TICKET_ID 200 '{"queueId":null}'
expect PUT /tickets/$TICKET_ID 200 "{\"queueId\":$QUEUE_ID}"
sleep 2
expect GET /crm/contacts/$CONTACT/deals 200
COUNT=$(jqv "d.filter(x=>x.funnelId===$FUNNEL).length")
if [ "$COUNT" != "1" ]; then echo "FAIL esperado 1 negócio aberto no funil $FUNNEL, veio $COUNT"; exit 1; fi
echo "ok   regra criou o negócio ao entrar na fila"
# Entering the same queue again must not create a second deal.
expect PUT /tickets/$TICKET_ID 200 '{"queueId":null}'
expect PUT /tickets/$TICKET_ID 200 "{\"queueId\":$QUEUE_ID}"
sleep 2
expect GET /crm/contacts/$CONTACT/deals 200
COUNT=$(jqv "d.filter(x=>x.funnelId===$FUNNEL).length")
if [ "$COUNT" != "1" ]; then echo "FAIL segundo negócio criado ($COUNT)"; exit 1; fi
echo "ok   sem negócio duplicado"
DEAL=$(jqv "d.find(x=>x.funnelId===$FUNNEL).id")
# A contact whose deal was lost gets no automatic deal: people reopen by hand.
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$LOST,\"lossReasonId\":$REASON}"
expect PUT /tickets/$TICKET_ID 200 '{"queueId":null}'
expect PUT /tickets/$TICKET_ID 200 "{\"queueId\":$QUEUE_ID}"
sleep 2
expect GET /crm/contacts/$CONTACT/deals 200
COUNT=$(jqv "d.filter(x=>x.funnelId===$FUNNEL).length")
if [ "$COUNT" != "0" ]; then echo "FAIL regra recriou negócio de contato com negócio perdido ($COUNT)"; exit 1; fi
echo "ok   negócio perdido não é recriado"
expect PUT /crm/rules/$RULE 200 '{"active":false}'
expect DELETE /crm/rules/$RULE 204
expect DELETE /crm/deals/$DEAL 204
expect GET /crm/deals/$DEAL 404
expect PUT /tickets/$TICKET_ID 200 "{\"queueId\":$ORIGINAL_QUEUE}"
echo "smoke das regras ok"
