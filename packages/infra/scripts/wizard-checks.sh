#!/usr/bin/env bash
#
# Checks the AWS setup wizard (setup-aws-account.sh) sources, kept apart so
# test/wizard.test.ts can run them on their own (RP-273). No prompts here.

# clean_answer TEXT prints TEXT without terminal escape sequences (arrow and
# function keys typed at a prompt), control characters or surrounding spaces.
clean_answer() {
  local text
  # CSI (ESC [ … final byte), then SS3 (ESC O x), then any other ESC pair.
  text=$(printf '%s' "$1" | LC_ALL=C sed -E $'s/\e\\[[0-?]*[ -/]*[@-~]//g; s/\eO[ -~]//g; s/\e[@-_]?//g' \
    | LC_ALL=C tr -d '\000-\037\177')
  text="${text#"${text%%[![:space:]]*}"}"
  printf '%s' "${text%"${text##*[![:space:]]}"}"
}

# has_hidden_characters TEXT: true when TEXT holds a control character, such
# as an escape sequence saved by an earlier run.
has_hidden_characters() { [[ "$1" == *[[:cntrl:]]* ]]; }

# is_root_arn ARN: true for the account's root user, as sts get-caller-identity
# names it (arn:aws:iam::<account>:root).
is_root_arn() { [[ "$1" =~ ^arn:aws[a-z-]*:iam::[0-9]{12}:root$ ]]; }

# export_credentials PROFILE prints the profile's short-lived credentials as
# `export` lines for eval. Fails, printing nothing, when the sign-in has expired
# or the CLI hands over no access key, so empty credentials never reach the CDK.
export_credentials() {
  local exported
  exported=$(aws configure export-credentials --profile "$1" --format env 2>/dev/null) || return 1
  exported=${exported//$'\r'/}
  grep -qE '^(export )?AWS_ACCESS_KEY_ID=[^[:space:]]' <<< "$exported" || return 1
  printf '%s\n' "$exported"
}
