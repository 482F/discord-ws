#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${0}")"; pwd)"
DISCORD_WS="${SCRIPT_DIR}/discord-ws.js"
RESULT_TXT="${SCRIPT_DIR}/result/result-$(date +%Y-%m-%d--%H-%M-%S).txt"
SCREEN_NAME="discord-ws"

function attach() {
  screen -r "${SCREEN_NAME}"
}

if ! screen -ls "${SCREEN_NAME}" | grep -q "There is a screen on"; then
  screen -dmS "${SCREEN_NAME}" node "${DISCORD_WS}" | tee "${RESULT_TXT}"
fi
attach
