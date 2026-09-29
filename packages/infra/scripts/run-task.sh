#!/usr/bin/env bash
#
# Runs the one-off migration task (packages/infra/src/migrations-stack.ts)
# once, prints its log and fails if it does not exit 0. The deploy workflow
# runs it for the migrations, the demo seed and the app role check.
#
#   run-task.sh <migrations stack outputs.json> <what, for messages> [command…]
#
# With a command, it replaces the task's own (the migrations). Needs
# STACK_PREFIX and VERSION, as the deploy workflow sets them.
set -euo pipefail
outputs=$1 what=$2
shift 2

out() { jq -r --arg s "$STACK_PREFIX-Migrations" --arg k "$1" '.[$s][$k]' "$outputs"; }
overrides='{}'
if (( $# )); then overrides=$(jq -cn '{containerOverrides: [{name: "migrate", command: $ARGS.positional}]}' --args "$@"); fi

cluster=$(out Cluster)
task=$(aws ecs run-task --cluster "$cluster" --task-definition "$(out TaskDefinition)" \
  --launch-type FARGATE --started-by "deploy-${VERSION:0:7}" --overrides "$overrides" \
  --network-configuration "awsvpcConfiguration={subnets=[$(out Subnets)],securityGroups=[$(out SecurityGroup)],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "$what: task ${task##*/}"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"
# Streams are named <streamPrefix>/<container>/<task id> (src/task.ts).
aws logs get-log-events --log-group-name "$(out LogGroup)" --log-stream-name "migrate/migrate/${task##*/}" \
  --start-from-head --query 'events[].message' --output text || echo "(no log)"
read -r code reason < <(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].[containers[0].exitCode, stoppedReason]' --output text)
if [[ "$code" != "0" ]]; then
  echo "::error::$what failed (exit $code: $reason)"
  exit 1
fi
