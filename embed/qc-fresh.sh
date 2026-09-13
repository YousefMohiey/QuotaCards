#!/bin/bash
# qc-fresh.sh — first boot setup for a fresh QuotaCards VPS (Ubuntu arm64).
# Installs Xray (VLESS TCP/443) + the restricted qc-agent for the app key.
# Run as ubuntu (passwordless sudo). Afterwards run qc-net.sh for game/WG.
set -e
cd /tmp
if ! command -v xray >/dev/null 2>&1 && [ ! -x /usr/local/bin/xray ]; then
  API=$(curl -sL https://api.github.com/repos/XTLS/Xray-core/releases/latest)
  URL=$(echo "$API" | grep -oE 'https://[^"]*Xray-linux-arm64-v8a.zip' | head -1)
  curl -sL -o xray.zip "$URL"
  sudo apt-get install -y -qq unzip >/dev/null 2>&1 || true
  rm -rf xray_dir && mkdir -p xray_dir && unzip -o -q xray.zip -d xray_dir
  sudo mkdir -p /usr/local/bin /usr/local/etc/xray
  sudo cp xray_dir/xray /usr/local/bin/xray
  sudo chmod +x /usr/local/bin/xray
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout server.key -out server.crt -days 3650 -subj "/CN=ea.com" 2>/dev/null
  sudo mv server.key server.crt /usr/local/etc/xray/
  sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
  sudo apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save >/dev/null 2>&1 || true
fi
sudo python3 - <<'PY'
import json, os
p = "/usr/local/etc/xray/config.json"
cfg = {"inbounds": [], "outbounds": [{"protocol": "freedom", "tag": "direct"}]}
if os.path.exists(p):
    try:
        cfg = json.load(open(p))
    except Exception:
        pass
if not cfg.get("inbounds"):
    cfg["inbounds"] = []
for ib in cfg.get("inbounds", []):
    if ib.get("protocol") == "vless":
        ib.setdefault("settings", {}).setdefault("clients", [])
        break
else:
    cfg["inbounds"].append({
        "port": 443, "protocol": "vless",
        "settings": {"clients": [], "decryption": "none"},
        "streamSettings": {
          "network": "tcp", "security": "tls",
          "tlsSettings": {"certificates": [{
            "certificateFile": "/usr/local/etc/xray/server.crt",
            "keyFile": "/usr/local/etc/xray/server.key"}]}}})
json.dump(cfg, open(p, "w"), indent=2)
PY
sudo tee /etc/systemd/system/xray.service >/dev/null <<'UNIT'
[Unit]
Description=Xray VLESS Proxy
After=network.target
[Service]
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=3
User=root
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable xray >/dev/null 2>&1 || true
sudo systemctl restart xray || true
# App key: restricted forced command (QC_EMBED_PUB replaced at deploy time).
mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
LINE='command="/usr/local/bin/qc-agent",no-agent-forwarding,no-X11-forwarding,no-pty QC_EMBED_PUB'
grep -qF 'qc-agent' ~/.ssh/authorized_keys 2>/dev/null || echo "$LINE" >> ~/.ssh/authorized_keys
echo FRESH_READY
