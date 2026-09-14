#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 -c "import aiohttp" 2>/dev/null || pip3 install aiohttp
python3 -m nex.server
